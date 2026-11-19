pub mod backlog;

use std::cell::Cell;
use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::time::Duration;

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

use crate::tasks::{Card, Row};

pub const FILE_NAME: &str = "fathom.sqlite";
pub const DEFAULT_COLUMN_WIDTH: i64 = 240;
pub const COLUMN_WIDTHS: std::ops::RangeInclusive<i64> = 180..=640;

const MIGRATIONS: [&str; 4] = [
    include_str!("../migrations/0001_init.sql"),
    include_str!("../migrations/0002_card_moves.sql"),
    include_str!("../migrations/0003_column_ids.sql"),
    include_str!("../migrations/0004_backlog.sql"),
];
const BUSY_TIMEOUT: Duration = Duration::from_secs(5);
const COLUMN_FIELDS: &str = "id, project, name, position, width, collapsed";
const NEXT_POSITION: &str = "(SELECT COALESCE(MAX(position) + 1, 0) FROM columns)";
const NEW_COLUMN_NEEDS_A_NAME: &str = "a new column needs a name";
const OPEN_STATUSES: &str = "'sending', 'asked', 'failed', 'answered'";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Column {
    pub id: i64,
    pub project: Option<String>,
    pub name: String,
    pub position: i64,
    pub width: i64,
    pub collapsed: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RowName {
    pub row: Row,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub taken_at_ms: i64,
    pub home: String,
    pub cards: Vec<Card>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CardPlace {
    pub card_id: String,
    pub column: Option<i64>,
    pub row: Row,
    pub position: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MoveStatus {
    Sending,
    Asked,
    Failed,
    Answered,
    Landed,
    Superseded,
    Dismissed,
}

impl MoveStatus {
    const ALL: [MoveStatus; 7] = [
        MoveStatus::Sending,
        MoveStatus::Asked,
        MoveStatus::Failed,
        MoveStatus::Answered,
        MoveStatus::Landed,
        MoveStatus::Superseded,
        MoveStatus::Dismissed,
    ];

    pub fn key(self) -> &'static str {
        match self {
            MoveStatus::Sending => "sending",
            MoveStatus::Asked => "asked",
            MoveStatus::Failed => "failed",
            MoveStatus::Answered => "answered",
            MoveStatus::Landed => "landed",
            MoveStatus::Superseded => "superseded",
            MoveStatus::Dismissed => "dismissed",
        }
    }

    fn from_key(key: &str) -> MoveStatus {
        MoveStatus::ALL
            .into_iter()
            .find(|s| s.key() == key)
            .unwrap_or(MoveStatus::Failed)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveRequest {
    pub request_id: String,
    pub card_id: String,
    pub title: String,
    pub from_row: Row,
    pub to_row: Row,
    pub created_ms: i64,
    pub status: MoveStatus,
    pub note_id: Option<String>,
    pub answer: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum MoveTo {
    Column { id: i64 },
    NewColumn { name: String },
}

pub struct Db {
    conn: Connection,
    path: PathBuf,
    seen_version: Cell<i64>,
}

impl Db {
    pub fn open(dir: &Path) -> Result<Db, String> {
        Db::open_file(&dir.join(FILE_NAME))
    }

    pub fn open_file(path: &Path) -> Result<Db, String> {
        if let Some(dir) = path.parent().filter(|d| !d.as_os_str().is_empty()) {
            std::fs::create_dir_all(dir)
                .map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
        }
        let conn =
            Connection::open(path).map_err(|e| format!("cannot open {}: {e}", path.display()))?;
        conn.busy_timeout(BUSY_TIMEOUT).map_err(err)?;
        conn.pragma_update(None, "journal_mode", "WAL")
            .map_err(err)?;
        let mut db = Db {
            conn,
            path: path.to_path_buf(),
            seen_version: Cell::new(0),
        };
        db.migrate()?;
        db.seen_version.set(db.data_version()?);
        Ok(db)
    }

    fn data_version(&self) -> Result<i64, String> {
        self.conn
            .pragma_query_value(None, "data_version", |r| r.get(0))
            .map_err(err)
    }

    pub fn changed_elsewhere(&self) -> Result<bool, String> {
        let version = self.data_version()?;
        Ok(self.seen_version.replace(version) != version)
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn schema_version(&self) -> Result<usize, String> {
        let version: i64 = self
            .conn
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .map_err(err)?;
        Ok(version as usize)
    }

    fn migrate(&mut self) -> Result<(), String> {
        let current = self.schema_version()?;
        for (index, sql) in MIGRATIONS.iter().enumerate().skip(current) {
            let tx = self.conn.transaction().map_err(err)?;
            tx.execute_batch(sql)
                .map_err(|e| format!("migration {}: {e}", index + 1))?;
            tx.pragma_update(None, "user_version", (index + 1) as i64)
                .map_err(err)?;
            tx.commit().map_err(err)?;
        }
        Ok(())
    }

    pub fn columns(&self) -> Result<Vec<Column>, String> {
        self.query_columns(false)
    }

    pub fn deleted_columns(&self) -> Result<Vec<Column>, String> {
        self.query_columns(true)
    }

    fn query_columns(&self, deleted: bool) -> Result<Vec<Column>, String> {
        let mut stmt = self
            .conn
            .prepare(&format!(
                "SELECT {COLUMN_FIELDS} FROM columns WHERE deleted = ?1 ORDER BY position, id"
            ))
            .map_err(err)?;
        let rows = stmt
            .query_map(params![deleted], |r| {
                Ok(Column {
                    id: r.get(0)?,
                    project: r.get(1)?,
                    name: r.get(2)?,
                    position: r.get(3)?,
                    width: r.get(4)?,
                    collapsed: r.get(5)?,
                })
            })
            .map_err(err)?;
        rows.collect::<Result<_, _>>().map_err(err)
    }

    pub fn ensure_columns(&mut self, cards: &[Card]) -> Result<Vec<Column>, String> {
        let columns = self.columns()?;
        let places = self.places_by_card()?;
        let shown = ShownCards::new(cards, &columns, &places, &[]);
        let homeless: BTreeSet<&str> = cards
            .iter()
            .filter(|card| shown.column(card).is_none())
            .map(|card| card.project.as_str())
            .collect();
        if homeless.is_empty() {
            return Ok(columns);
        }
        let tx = self.conn.transaction().map_err(err)?;
        for project in homeless {
            let restored = tx
                .execute(
                    "UPDATE columns SET deleted = 0 WHERE project = ?1",
                    params![project],
                )
                .map_err(err)?;
            if restored == 0 {
                tx.execute(
                    &format!("INSERT INTO columns (project, name, position, width) VALUES (?1, ?1, {NEXT_POSITION}, ?2)"),
                    params![project, DEFAULT_COLUMN_WIDTH],
                )
                .map_err(err)?;
            }
        }
        tx.commit().map_err(err)?;
        self.columns()
    }

    pub fn add_column(&self, name: &str) -> Result<Vec<Column>, String> {
        let name = name.trim();
        if name.is_empty() {
            return Err(NEW_COLUMN_NEEDS_A_NAME.into());
        }
        self.conn
            .execute(
                &format!("INSERT INTO columns (project, name, position, width) VALUES (NULL, ?1, {NEXT_POSITION}, ?2)"),
                params![name, DEFAULT_COLUMN_WIDTH],
            )
            .map_err(err)?;
        self.columns()
    }

    pub fn delete_column(
        &mut self,
        id: i64,
        move_to: Option<&MoveTo>,
        cards: &[Card],
    ) -> Result<Vec<Column>, String> {
        let columns = self.columns()?;
        let Some(column) = columns.iter().find(|c| c.id == id) else {
            return Ok(columns);
        };
        let places = self.places_by_card()?;
        let requests = self.open_requests()?;
        let shown = ShownCards::new(cards, &columns, &places, &requests);
        let held = shown.ordered_in(id);
        let target = match move_to {
            _ if held.is_empty() => None,
            None => {
                return Err(format!(
                    "{} now holds {}; choose a column to move to",
                    column.name,
                    card_count(held.len())
                ));
            }
            Some(MoveTo::Column { id: target }) if *target == id => {
                return Err(format!("{} cannot take its own cards", column.name));
            }
            Some(MoveTo::Column { id: target }) if !columns.iter().any(|c| c.id == *target) => {
                return Err("the column to move the cards to is gone".into());
            }
            Some(MoveTo::NewColumn { name }) if name.trim().is_empty() => {
                return Err(NEW_COLUMN_NEEDS_A_NAME.into());
            }
            Some(target) => Some(target),
        };
        let tx = self.conn.transaction().map_err(err)?;
        if let Some(target) = target {
            let target = match target {
                MoveTo::Column { id } => *id,
                MoveTo::NewColumn { name } => {
                    tx.execute(
                        &format!("INSERT INTO columns (project, name, position, width) VALUES (NULL, ?1, {NEXT_POSITION}, ?2)"),
                        params![name.trim(), DEFAULT_COLUMN_WIDTH],
                    )
                    .map_err(err)?;
                    tx.last_insert_rowid()
                }
            };
            for row in Row::ALL {
                let start = shown.next_position(target, row);
                let in_row = held.iter().filter(|card| shown.row(card) == row);
                for (position, card) in (start..).zip(in_row) {
                    tx.execute(
                        "INSERT INTO card_places (card_id, column_id, row_key, position) VALUES (?1, ?2, ?3, ?4)
                         ON CONFLICT(card_id) DO UPDATE SET column_id = excluded.column_id, row_key = excluded.row_key, position = excluded.position",
                        params![card.id, target, row.key(), position],
                    )
                    .map_err(err)?;
                }
            }
        }
        tx.execute(
            "UPDATE card_places SET column_id = NULL WHERE column_id = ?1",
            params![id],
        )
        .map_err(err)?;
        tx.execute(
            "DELETE FROM columns WHERE id = ?1 AND project IS NULL",
            params![id],
        )
        .map_err(err)?;
        tx.execute("UPDATE columns SET deleted = 1 WHERE id = ?1", params![id])
            .map_err(err)?;
        tx.commit().map_err(err)?;
        self.columns()
    }

    pub fn update_column(
        &self,
        id: i64,
        width: Option<i64>,
        collapsed: Option<bool>,
    ) -> Result<(), String> {
        if let Some(width) = width.filter(|w| !COLUMN_WIDTHS.contains(w)) {
            return Err(format!(
                "a column width must be between {} and {} pixels, got {width}",
                COLUMN_WIDTHS.start(),
                COLUMN_WIDTHS.end()
            ));
        }
        self.conn
            .execute(
                "UPDATE columns SET width = COALESCE(?2, width), collapsed = COALESCE(?3, collapsed) WHERE id = ?1",
                params![id, width, collapsed],
            )
            .map_err(err)?;
        Ok(())
    }

    pub fn move_column(&mut self, id: i64, index: usize) -> Result<Vec<Column>, String> {
        let mut ids: Vec<i64> = self.columns()?.iter().map(|c| c.id).collect();
        let Some(from) = ids.iter().position(|c| *c == id) else {
            return self.columns();
        };
        ids.remove(from);
        ids.insert(index.min(ids.len()), id);
        let tx = self.conn.transaction().map_err(err)?;
        for (position, id) in ids.iter().enumerate() {
            tx.execute(
                "UPDATE columns SET position = ?2 WHERE id = ?1",
                params![id, position as i64],
            )
            .map_err(err)?;
        }
        tx.commit().map_err(err)?;
        self.columns()
    }

    pub fn set_column_name(&self, id: i64, name: &str) -> Result<(), String> {
        self.conn
            .execute(
                "UPDATE columns SET name = COALESCE(NULLIF(?2, ''), project, name) WHERE id = ?1",
                params![id, name.trim()],
            )
            .map_err(err)?;
        Ok(())
    }

    pub fn card_columns(&self, cards: &[Card]) -> Result<HashMap<String, i64>, String> {
        let columns = self.columns()?;
        let places = self.places_by_card()?;
        let shown = ShownCards::new(cards, &columns, &places, &[]);
        Ok(cards
            .iter()
            .filter_map(|card| Some((card.id.clone(), shown.column(card)?)))
            .collect())
    }

    fn places_by_card(&self) -> Result<HashMap<String, CardPlace>, String> {
        Ok(self
            .places()?
            .into_iter()
            .map(|p| (p.card_id.clone(), p))
            .collect())
    }

    pub fn row_names(&self) -> Result<Vec<RowName>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT row_key, name FROM row_names")
            .map_err(err)?;
        let stored: HashMap<String, String> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(err)?
            .collect::<Result<_, _>>()
            .map_err(err)?;
        Ok(Row::ALL
            .iter()
            .map(|row| RowName {
                row: *row,
                name: stored
                    .get(row.key())
                    .cloned()
                    .unwrap_or_else(|| row.default_name().to_string()),
            })
            .collect())
    }

    pub fn set_row_name(&self, row: Row, name: &str) -> Result<(), String> {
        let name = name.trim();
        if name.is_empty() || name == row.default_name() {
            self.conn
                .execute(
                    "DELETE FROM row_names WHERE row_key = ?1",
                    params![row.key()],
                )
                .map_err(err)?;
        } else {
            self.conn
                .execute(
                    "INSERT INTO row_names (row_key, name) VALUES (?1, ?2) ON CONFLICT(row_key) DO UPDATE SET name = excluded.name",
                    params![row.key(), name],
                )
                .map_err(err)?;
        }
        Ok(())
    }

    pub fn settings(&self) -> Result<HashMap<String, String>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT key, value FROM settings")
            .map_err(err)?;
        stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(err)?
            .collect::<Result<_, _>>()
            .map_err(err)
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![key, value],
            )
            .map_err(err)?;
        Ok(())
    }

    pub fn set_settings(&self, pairs: &[(&str, String)]) -> Result<(), String> {
        let tx = self.conn.unchecked_transaction().map_err(err)?;
        for (key, value) in pairs {
            tx.execute(
                "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![key, value],
            )
            .map_err(err)?;
        }
        tx.commit().map_err(err)
    }

    pub fn snapshot(&self) -> Result<Option<Snapshot>, String> {
        let row: Option<(i64, String, String)> = self
            .conn
            .query_row(
                "SELECT taken_at_ms, home, cards FROM snapshot WHERE id = 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()
            .map_err(err)?;
        Ok(row.and_then(|(taken_at_ms, home, cards)| {
            serde_json::from_str(&cards).ok().map(|cards| Snapshot {
                taken_at_ms,
                home,
                cards,
            })
        }))
    }

    pub fn save_snapshot(&self, snapshot: &Snapshot) -> Result<(), String> {
        let cards = serde_json::to_string(&snapshot.cards).map_err(err)?;
        self.conn
            .execute(
                "INSERT INTO snapshot (id, taken_at_ms, home, cards) VALUES (1, ?1, ?2, ?3)
                 ON CONFLICT(id) DO UPDATE SET taken_at_ms = excluded.taken_at_ms, home = excluded.home, cards = excluded.cards",
                params![snapshot.taken_at_ms, snapshot.home, cards],
            )
            .map_err(err)?;
        Ok(())
    }

    pub fn places(&self) -> Result<Vec<CardPlace>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT card_id, column_id, row_key, position FROM card_places ORDER BY row_key, position")
            .map_err(err)?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, Option<i64>>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, i64>(3)?,
                ))
            })
            .map_err(err)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(err)?;
        Ok(rows
            .into_iter()
            .filter_map(|(card_id, column, row, position)| {
                Some(CardPlace {
                    card_id,
                    column,
                    row: Row::from_key(&row)?,
                    position,
                })
            })
            .collect())
    }

    pub fn place_cards(
        &mut self,
        moved: &str,
        column: i64,
        row: Row,
        order: &[String],
    ) -> Result<(), String> {
        let tx = self.conn.transaction().map_err(err)?;
        for (position, card_id) in order.iter().enumerate() {
            tx.execute(
                "INSERT INTO card_places (card_id, column_id, row_key, position) VALUES (?1, NULL, ?2, ?3)
                 ON CONFLICT(card_id) DO UPDATE SET row_key = excluded.row_key, position = excluded.position",
                params![card_id, row.key(), position as i64],
            )
            .map_err(err)?;
        }
        tx.execute(
            "INSERT INTO card_places (card_id, column_id, row_key, position) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(card_id) DO UPDATE SET column_id = excluded.column_id",
            params![
                moved,
                column,
                row.key(),
                order
                    .iter()
                    .position(|id| id == moved)
                    .unwrap_or(order.len()) as i64
            ],
        )
        .map_err(err)?;
        tx.commit().map_err(err)
    }

    pub fn open_requests(&self) -> Result<Vec<MoveRequest>, String> {
        self.query_requests(
            &format!("WHERE status IN ({OPEN_STATUSES}) ORDER BY created_ms"),
            [],
        )
    }

    pub fn request(&self, request_id: &str) -> Result<Option<MoveRequest>, String> {
        Ok(self
            .query_requests("WHERE request_id = ?1", params![request_id])?
            .pop())
    }

    fn query_requests(
        &self,
        filter: &str,
        args: impl rusqlite::Params,
    ) -> Result<Vec<MoveRequest>, String> {
        let mut stmt = self
            .conn
            .prepare(&format!(
                "SELECT request_id, card_id, title, from_row, to_row, created_ms, status, note_id, answer, error FROM move_requests {filter}"
            ))
            .map_err(err)?;
        let rows = stmt
            .query_map(args, |r| {
                Ok((
                    (
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                    ),
                    (r.get::<_, String>(3)?, r.get::<_, String>(4)?),
                    r.get::<_, i64>(5)?,
                    r.get::<_, String>(6)?,
                    (
                        r.get::<_, Option<String>>(7)?,
                        r.get::<_, Option<String>>(8)?,
                        r.get::<_, Option<String>>(9)?,
                    ),
                ))
            })
            .map_err(err)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(err)?;
        Ok(rows
            .into_iter()
            .filter_map(
                |(
                    (request_id, card_id, title),
                    (from, to),
                    created_ms,
                    status,
                    (note_id, answer, error),
                )| {
                    Some(MoveRequest {
                        request_id,
                        card_id,
                        title,
                        from_row: Row::from_key(&from)?,
                        to_row: Row::from_key(&to)?,
                        created_ms,
                        status: MoveStatus::from_key(&status),
                        note_id,
                        answer,
                        error,
                    })
                },
            )
            .collect())
    }

    pub fn add_request(&mut self, request: &MoveRequest) -> Result<(), String> {
        let tx = self.conn.transaction().map_err(err)?;
        tx.execute(
            &format!(
                "UPDATE move_requests SET status = 'superseded' WHERE card_id = ?1 AND status IN ({OPEN_STATUSES})"
            ),
            params![request.card_id],
        )
        .map_err(err)?;
        tx.execute(
            "INSERT INTO move_requests (request_id, card_id, title, from_row, to_row, created_ms, status, note_id, answer, error)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                request.request_id,
                request.card_id,
                request.title,
                request.from_row.key(),
                request.to_row.key(),
                request.created_ms,
                request.status.key(),
                request.note_id,
                request.answer,
                request.error,
            ],
        )
        .map_err(err)?;
        tx.commit().map_err(err)
    }

    pub fn finish_send(
        &self,
        request_id: &str,
        outcome: &Result<String, String>,
    ) -> Result<(), String> {
        let (status, note_id, error) = match outcome {
            Ok(note_id) => (MoveStatus::Asked, Some(note_id.as_str()), None),
            Err(error) => (MoveStatus::Failed, None, Some(error.as_str())),
        };
        self.conn
            .execute(
                "UPDATE move_requests SET status = ?2, note_id = COALESCE(?3, note_id), error = ?4
                 WHERE request_id = ?1 AND status IN ('sending', 'failed')",
                params![request_id, status.key(), note_id, error],
            )
            .map_err(err)?;
        Ok(())
    }

    pub fn set_request_status(&self, request_id: &str, status: MoveStatus) -> Result<(), String> {
        self.conn
            .execute(
                "UPDATE move_requests SET status = ?2 WHERE request_id = ?1",
                params![request_id, status.key()],
            )
            .map_err(err)?;
        Ok(())
    }

    pub fn answer_request(&self, request_id: &str, answer: &str) -> Result<(), String> {
        self.conn
            .execute(
                "UPDATE move_requests SET status = 'answered', answer = ?2 WHERE request_id = ?1 AND status = 'asked'",
                params![request_id, answer],
            )
            .map_err(err)?;
        Ok(())
    }

    pub fn all_requests(&self) -> Result<Vec<MoveRequest>, String> {
        self.query_requests("ORDER BY created_ms", [])
    }

    pub fn data_size(&self) -> u64 {
        ["", "-wal", "-shm"]
            .iter()
            .filter_map(|suffix| {
                let mut name = self.path.as_os_str().to_owned();
                name.push(suffix);
                std::fs::metadata(PathBuf::from(name)).ok()
            })
            .map(|meta| meta.len())
            .sum()
    }
}

struct ShownCards<'a> {
    cards: &'a [Card],
    columns: &'a [Column],
    places: &'a HashMap<String, CardPlace>,
    requests: &'a [MoveRequest],
}

impl<'a> ShownCards<'a> {
    fn new(
        cards: &'a [Card],
        columns: &'a [Column],
        places: &'a HashMap<String, CardPlace>,
        requests: &'a [MoveRequest],
    ) -> Self {
        ShownCards {
            cards,
            columns,
            places,
            requests,
        }
    }

    fn column(&self, card: &Card) -> Option<i64> {
        let placed = self.places.get(&card.id).and_then(|p| p.column);
        placed
            .filter(|id| self.columns.iter().any(|c| c.id == *id))
            .or_else(|| {
                self.columns
                    .iter()
                    .find(|c| c.project.as_deref() == Some(card.project.as_str()))
                    .map(|c| c.id)
            })
    }

    fn row(&self, card: &Card) -> Row {
        match self.requests.iter().rev().find(|r| r.card_id == card.id) {
            Some(r) if r.status != MoveStatus::Answered => r.to_row,
            _ => card.row,
        }
    }

    fn position(&self, card: &Card, row: Row) -> i64 {
        self.places
            .get(&card.id)
            .filter(|p| p.row == row)
            .map_or(-1, |p| p.position)
    }

    fn ordered_in(&self, column: i64) -> Vec<&'a Card> {
        Row::ALL
            .into_iter()
            .flat_map(|row| {
                let mut here: Vec<&Card> = self
                    .cards
                    .iter()
                    .filter(|card| self.column(card) == Some(column) && self.row(card) == row)
                    .collect();
                if row == Row::Landed {
                    here.sort_by(|a, b| b.closed.cmp(&a.closed));
                }
                here.sort_by_key(|card| self.position(card, row));
                here
            })
            .collect()
    }

    fn next_position(&self, column: i64, row: Row) -> i64 {
        self.cards
            .iter()
            .filter(|card| self.column(card) == Some(column) && self.row(card) == row)
            .map(|card| self.position(card, row) + 1)
            .max()
            .unwrap_or(0)
    }
}

fn card_count(n: usize) -> String {
    if n == 1 {
        "1 card".into()
    } else {
        format!("{n} cards")
    }
}

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tasks::Card;

    fn card(id: &str, project: &str) -> Card {
        Card {
            id: id.into(),
            title: format!("Title of {id}"),
            state: "queued".into(),
            kind: "ship".into(),
            project: project.into(),
            row: Row::Seabed,
            hold_kind: String::new(),
            hold_until: String::new(),
            hold_reason: String::new(),
            blocked_by: vec![],
            links: vec![],
            closed: String::new(),
        }
    }

    #[test]
    fn migrations_run_once_and_set_the_version() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path()).unwrap();
        assert_eq!(db.schema_version().unwrap(), MIGRATIONS.len());
        drop(db);
        let db = Db::open(dir.path()).unwrap();
        assert_eq!(db.schema_version().unwrap(), MIGRATIONS.len());
    }

    #[test]
    fn the_backlog_migration_upgrades_a_version_three_store() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(FILE_NAME);
        {
            let conn = Connection::open(&path).unwrap();
            for sql in &MIGRATIONS[..3] {
                conn.execute_batch(sql).unwrap();
            }
            conn.pragma_update(None, "user_version", 3).unwrap();
            conn.execute(
                "INSERT INTO columns (project, name, position, width) VALUES ('reef-map', 'Reef', 0, 240)",
                [],
            )
            .unwrap();
        }
        let db = Db::open(dir.path()).unwrap();
        assert_eq!(db.schema_version().unwrap(), 4);
        assert_eq!(db.columns().unwrap()[0].name, "Reef");
        assert!(db.tasks(None, None).unwrap().is_empty());
    }

    #[test]
    fn notices_commits_from_other_connections_only() {
        let dir = tempfile::tempdir().unwrap();
        let app = Db::open(dir.path()).unwrap();
        assert!(!app.changed_elsewhere().unwrap());
        app.set_setting("home", "").unwrap();
        assert!(!app.changed_elsewhere().unwrap());

        let other = Db::open_file(&dir.path().join(FILE_NAME)).unwrap();
        other
            .add_task(
                &backlog::NewTask {
                    title: "Chart the reef".into(),
                    project: "reef-map".into(),
                    ..Default::default()
                },
                1,
            )
            .unwrap();
        assert!(app.changed_elsewhere().unwrap());
        assert!(!app.changed_elsewhere().unwrap());
    }

    fn projects(columns: &[Column]) -> Vec<Option<&str>> {
        columns.iter().map(|c| c.project.as_deref()).collect()
    }

    fn names(columns: &[Column]) -> Vec<&str> {
        columns.iter().map(|c| c.name.as_str()).collect()
    }

    #[test]
    fn columns_are_seeded_then_appended_in_order() {
        let dir = tempfile::tempdir().unwrap();
        let mut db = Db::open(dir.path()).unwrap();
        let seeded = db
            .ensure_columns(&[card("a", "reef"), card("b", "harbor"), card("c", "reef")])
            .unwrap();
        assert_eq!(projects(&seeded), [Some("harbor"), Some("reef")]);
        db.update_column(seeded[0].id, Some(320), Some(true))
            .unwrap();
        let grown = db
            .ensure_columns(&[card("d", "lagoon"), card("b", "harbor")])
            .unwrap();
        assert_eq!(
            projects(&grown),
            [Some("harbor"), Some("reef"), Some("lagoon")]
        );
        assert_eq!(grown[0].id, seeded[0].id);
        assert_eq!(grown[0].width, 320);
        assert!(grown[0].collapsed);
        assert_eq!(grown[2].width, DEFAULT_COLUMN_WIDTH);
    }

    #[test]
    fn column_names_override_the_project_and_reset_when_empty() {
        let dir = tempfile::tempdir().unwrap();
        let mut db = Db::open(dir.path()).unwrap();
        let harbor = db
            .ensure_columns(&[card("a", "harbor"), card("b", "reef")])
            .unwrap()[0]
            .id;
        db.update_column(harbor, Some(320), Some(false)).unwrap();
        db.set_column_name(harbor, "  Harbor web  ").unwrap();
        let renamed = db
            .ensure_columns(&[card("a", "harbor"), card("b", "reef")])
            .unwrap();
        assert_eq!(renamed[0].project.as_deref(), Some("harbor"));
        assert_eq!(renamed[0].name, "Harbor web");
        assert_eq!(renamed[0].width, 320);
        assert_eq!(renamed[1].name, "reef");
        db.set_column_name(harbor, " ").unwrap();
        assert_eq!(db.columns().unwrap()[0].name, "harbor");
    }

    #[test]
    fn added_columns_go_last_with_their_own_ids_and_keep_their_name() {
        let dir = tempfile::tempdir().unwrap();
        let mut db = Db::open(dir.path()).unwrap();
        db.ensure_columns(&[card("a", "harbor")]).unwrap();
        let added = db.add_column("  reef  ").unwrap();
        assert_eq!(names(&added), ["harbor", "reef"]);
        assert_eq!(added[1].project, None);
        assert_eq!(added[1].width, DEFAULT_COLUMN_WIDTH);
        assert!(db.add_column("   ").is_err());

        let custom = added[1].id;
        db.update_column(custom, Some(300), Some(true)).unwrap();
        db.set_column_name(custom, "This week").unwrap();
        db.set_column_name(custom, "  ").unwrap();
        let grown = db
            .ensure_columns(&[card("a", "harbor"), card("b", "reef")])
            .unwrap();
        assert_eq!(names(&grown), ["harbor", "This week", "reef"]);
        assert_eq!(projects(&grown), [Some("harbor"), None, Some("reef")]);
        assert_ne!(grown[2].id, custom);
        assert_eq!((grown[1].width, grown[1].collapsed), (300, true));
    }

    fn four_columns(db: &mut Db) -> Vec<Card> {
        let cards = vec![
            card("a", "atlas"),
            card("b", "harbor"),
            card("c", "keel"),
            card("d", "reef"),
        ];
        db.ensure_columns(&cards).unwrap();
        cards
    }

    fn moved(db: &mut Db, name: &str, index: usize) -> Vec<String> {
        let id = db
            .columns()
            .unwrap()
            .iter()
            .find(|c| c.name == name)
            .unwrap()
            .id;
        names(&db.move_column(id, index).unwrap())
            .into_iter()
            .map(String::from)
            .collect()
    }

    #[test]
    fn moving_a_column_reorders_the_board() {
        let dir = tempfile::tempdir().unwrap();
        let mut db = Db::open(dir.path()).unwrap();
        four_columns(&mut db);
        assert_eq!(
            moved(&mut db, "atlas", 3),
            ["harbor", "keel", "reef", "atlas"]
        );
        assert_eq!(
            moved(&mut db, "atlas", 0),
            ["atlas", "harbor", "keel", "reef"]
        );
        assert_eq!(
            moved(&mut db, "harbor", 2),
            ["atlas", "keel", "harbor", "reef"]
        );
        assert_eq!(
            moved(&mut db, "reef", 1),
            ["atlas", "reef", "keel", "harbor"]
        );
        assert_eq!(
            moved(&mut db, "keel", 99),
            ["atlas", "reef", "harbor", "keel"]
        );
        assert_eq!(
            names(&db.columns().unwrap()),
            ["atlas", "reef", "harbor", "keel"]
        );
    }

    #[test]
    fn a_moved_column_keeps_its_place_and_new_columns_still_go_last() {
        let dir = tempfile::tempdir().unwrap();
        let mut db = Db::open(dir.path()).unwrap();
        let mut cards = four_columns(&mut db);
        moved(&mut db, "reef", 0);
        assert_eq!(
            names(&db.ensure_columns(&cards).unwrap()),
            ["reef", "atlas", "harbor", "keel"]
        );
        cards.push(card("e", "lagoon"));
        assert_eq!(
            names(&db.ensure_columns(&cards).unwrap()),
            ["reef", "atlas", "harbor", "keel", "lagoon"]
        );
        assert_eq!(
            names(&db.add_column("Later").unwrap()),
            ["reef", "atlas", "harbor", "keel", "lagoon", "Later"]
        );
        let unknown = db.columns().unwrap().iter().map(|c| c.id).max().unwrap() + 1;
        assert_eq!(
            names(&db.move_column(unknown, 0).unwrap()),
            ["reef", "atlas", "harbor", "keel", "lagoon", "Later"]
        );
    }

    fn place_rows(db: &Db) -> Vec<(String, Option<i64>, Row, i64)> {
        let mut places: Vec<_> = db
            .places()
            .unwrap()
            .into_iter()
            .map(|p| (p.card_id, p.column, p.row, p.position))
            .collect();
        places.sort_by(|a, b| (a.2.key(), a.3).cmp(&(b.2.key(), b.3)));
        places
    }

    fn to_column(id: i64) -> MoveTo {
        MoveTo::Column { id }
    }

    fn to_new(name: &str) -> MoveTo {
        MoveTo::NewColumn { name: name.into() }
    }

    #[test]
    fn deleting_a_column_moves_its_cards_after_the_targets_own_in_their_order() {
        let dir = tempfile::tempdir().unwrap();
        let mut db = Db::open(dir.path()).unwrap();
        let cards = [
            card("a", "harbor"),
            card("b", "harbor"),
            card("c", "reef"),
            card("d", "reef"),
            card("e", "reef"),
            card("f", "reef"),
        ];
        let columns = db.ensure_columns(&cards).unwrap();
        let (harbor, reef) = (columns[0].id, columns[1].id);
        db.place_cards("b", harbor, Row::Seabed, &["b".into(), "a".into()])
            .unwrap();
        db.place_cards(
            "e",
            reef,
            Row::Seabed,
            &["e".into(), "c".into(), "d".into()],
        )
        .unwrap();
        db.add_request(&request("r1", "f", Row::Deep)).unwrap();

        let columns = db
            .delete_column(reef, Some(&to_column(harbor)), &cards)
            .unwrap();

        assert_eq!(names(&columns), ["harbor"]);
        assert_eq!(names(&db.deleted_columns().unwrap()), ["reef"]);
        assert_eq!(
            place_rows(&db),
            [
                ("f".into(), Some(harbor), Row::Deep, 0),
                ("b".into(), Some(harbor), Row::Seabed, 0),
                ("a".into(), None, Row::Seabed, 1),
                ("e".into(), Some(harbor), Row::Seabed, 2),
                ("c".into(), Some(harbor), Row::Seabed, 3),
                ("d".into(), Some(harbor), Row::Seabed, 4),
            ]
        );
    }

    #[test]
    fn deleting_a_column_can_move_its_cards_to_a_new_column() {
        let dir = tempfile::tempdir().unwrap();
        let mut db = Db::open(dir.path()).unwrap();
        let cards = [card("a", "harbor"), card("b", "reef"), card("c", "reef")];
        let reef = db.ensure_columns(&cards).unwrap()[1].id;

        let columns = db
            .delete_column(reef, Some(&to_new("  This week ")), &cards)
            .unwrap();

        assert_eq!(names(&columns), ["harbor", "This week"]);
        assert_eq!(projects(&columns), [Some("harbor"), None]);
        let week = columns[1].id;
        assert!(week > reef);
        assert_eq!(
            place_rows(&db),
            [
                ("b".into(), Some(week), Row::Seabed, 0),
                ("c".into(), Some(week), Row::Seabed, 1),
            ]
        );
    }

    #[test]
    fn a_card_that_arrived_after_the_dialog_opened_is_moved_too() {
        let dir = tempfile::tempdir().unwrap();
        let mut db = Db::open(dir.path()).unwrap();
        let in_dialog = [card("a", "harbor"), card("b", "reef")];
        let columns = db.ensure_columns(&in_dialog).unwrap();
        let (harbor, reef) = (columns[0].id, columns[1].id);
        let now = [card("a", "harbor"), card("b", "reef"), card("c", "reef")];

        db.delete_column(reef, Some(&to_column(harbor)), &now)
            .unwrap();

        assert_eq!(
            place_rows(&db),
            [
                ("b".into(), Some(harbor), Row::Seabed, 0),
                ("c".into(), Some(harbor), Row::Seabed, 1),
            ]
        );
    }

    #[test]
    fn a_card_that_arrived_after_an_empty_column_dialog_opened_stops_the_delete() {
        let dir = tempfile::tempdir().unwrap();
        let mut db = Db::open(dir.path()).unwrap();
        let in_dialog = [card("a", "harbor"), card("b", "reef")];
        let columns = db.ensure_columns(&in_dialog).unwrap();
        let (harbor, reef) = (columns[0].id, columns[1].id);
        db.place_cards("b", harbor, Row::Seabed, &["b".into()])
            .unwrap();
        let now = [card("a", "harbor"), card("b", "reef"), card("c", "reef")];

        let error = db.delete_column(reef, None, &now).unwrap_err();

        assert_eq!(error, "reef now holds 1 card; choose a column to move to");
        assert_eq!(names(&db.columns().unwrap()), ["harbor", "reef"]);
    }

    #[test]
    fn a_move_that_cannot_happen_changes_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let mut db = Db::open(dir.path()).unwrap();
        let cards = [card("a", "harbor"), card("b", "reef")];
        let reef = db.ensure_columns(&cards).unwrap()[1].id;
        db.place_cards("b", reef, Row::Seabed, &["b".into()])
            .unwrap();
        let before = (db.columns().unwrap(), place_rows(&db));

        for (move_to, error) in [
            (None, "reef now holds 1 card; choose a column to move to"),
            (Some(to_column(reef)), "reef cannot take its own cards"),
            (
                Some(to_column(99)),
                "the column to move the cards to is gone",
            ),
            (Some(to_new("  ")), "a new column needs a name"),
        ] {
            assert_eq!(
                db.delete_column(reef, move_to.as_ref(), &cards),
                Err(error.into())
            );
        }
        assert_eq!((db.columns().unwrap(), place_rows(&db)), before);

        db.conn
            .execute_batch(
                "CREATE TEMP TRIGGER refuse_delete BEFORE UPDATE OF deleted ON columns
                 BEGIN SELECT RAISE(ABORT, 'disk is full'); END;",
            )
            .unwrap();
        let error = db
            .delete_column(reef, Some(&to_new("Later")), &cards)
            .unwrap_err();
        assert_eq!(error, "disk is full");
        assert_eq!((db.columns().unwrap(), place_rows(&db)), before);
        assert!(db.deleted_columns().unwrap().is_empty());
    }

    #[test]
    fn an_empty_column_is_deleted_without_a_target() {
        let dir = tempfile::tempdir().unwrap();
        let mut db = Db::open(dir.path()).unwrap();
        let cards = [card("a", "harbor")];
        db.ensure_columns(&cards).unwrap();
        let later = db.add_column("Later").unwrap()[1].id;
        let columns = db
            .delete_column(later, Some(&to_new("Ignored")), &cards)
            .unwrap();
        assert_eq!(names(&columns), ["harbor"]);
    }

    #[test]
    fn a_deleted_project_column_stays_gone_until_a_card_has_nowhere_else_to_show() {
        let dir = tempfile::tempdir().unwrap();
        let mut db = Db::open(dir.path()).unwrap();
        let mut cards = vec![card("a", "harbor"), card("b", "reef")];
        db.ensure_columns(&cards).unwrap();
        let custom = db.add_column("Now").unwrap()[2].id;
        db.place_cards("b", custom, Row::Seabed, &["b".into()])
            .unwrap();
        let reef = db.columns().unwrap()[1].clone();
        db.set_column_name(reef.id, "Reef work").unwrap();
        db.update_column(reef.id, Some(400), None).unwrap();

        assert_eq!(
            names(&db.delete_column(reef.id, None, &cards).unwrap()),
            ["harbor", "Now"]
        );
        assert_eq!(
            names(&db.ensure_columns(&cards).unwrap()),
            ["harbor", "Now"]
        );
        assert_eq!(names(&db.deleted_columns().unwrap()), ["Reef work"]);

        cards.push(card("c", "reef"));
        let back = db.ensure_columns(&cards).unwrap();
        assert_eq!(names(&back), ["harbor", "Reef work", "Now"]);
        assert_eq!((back[1].id, back[1].width), (reef.id, 400));
        assert!(db.deleted_columns().unwrap().is_empty());
    }

    #[test]
    fn deleting_a_custom_column_removes_it_and_forgets_cards_placed_there() {
        let dir = tempfile::tempdir().unwrap();
        let mut db = Db::open(dir.path()).unwrap();
        let cards = [card("a", "harbor")];
        db.ensure_columns(&cards).unwrap();
        let custom = db.add_column("Later").unwrap()[1].id;
        db.place_cards("gone", custom, Row::Deep, &["gone".into(), "a".into()])
            .unwrap();
        db.delete_column(custom, None, &cards).unwrap();
        assert!(db.deleted_columns().unwrap().is_empty());
        let places: Vec<(String, Option<i64>)> = db
            .places()
            .unwrap()
            .into_iter()
            .map(|p| (p.card_id, p.column))
            .collect();
        assert_eq!(places, [("gone".into(), None), ("a".into(), None)]);
        let next = db.add_column("Later").unwrap()[1].id;
        assert!(next > custom);
    }

    #[test]
    fn upgrading_keys_columns_and_card_places_by_column_id() {
        let dir = tempfile::tempdir().unwrap();
        {
            let conn = Connection::open(dir.path().join(FILE_NAME)).unwrap();
            conn.execute_batch(&MIGRATIONS[..2].concat()).unwrap();
            conn.pragma_update(None, "user_version", 2).unwrap();
            conn.execute_batch(
                "INSERT INTO columns VALUES ('reef', 'Reef work', 0, 300, 1), ('harbor', 'harbor', 1, 240, 0);
                 INSERT INTO card_places VALUES ('a', 'harbor', 'deep', 0), ('b', NULL, 'deep', 1), ('c', 'lost', 'deep', 2);",
            )
            .unwrap();
        }
        let db = Db::open(dir.path()).unwrap();
        let columns = db.columns().unwrap();
        assert_eq!(names(&columns), ["Reef work", "harbor"]);
        assert_eq!(projects(&columns), [Some("reef"), Some("harbor")]);
        assert_eq!((columns[0].width, columns[0].collapsed), (300, true));
        let places: Vec<(String, Option<i64>)> = db
            .places()
            .unwrap()
            .into_iter()
            .map(|p| (p.card_id, p.column))
            .collect();
        assert_eq!(
            places,
            [
                ("a".into(), Some(columns[1].id)),
                ("b".into(), None),
                ("c".into(), None)
            ]
        );
    }

    #[test]
    fn row_names_default_and_override() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path()).unwrap();
        db.set_row_name(Row::Deep, "Parked").unwrap();
        let names = db.row_names().unwrap();
        assert_eq!(names[0].name, "Surface");
        assert_eq!(names[2].name, "Parked");
        db.set_row_name(Row::Deep, "  ").unwrap();
        assert_eq!(db.row_names().unwrap()[2].name, "Deep");
    }

    #[test]
    fn snapshot_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path()).unwrap();
        assert!(db.snapshot().unwrap().is_none());
        let snapshot = Snapshot {
            taken_at_ms: 42,
            home: "/fm".into(),
            cards: vec![card("a", "harbor")],
        };
        db.save_snapshot(&snapshot).unwrap();
        db.save_snapshot(&snapshot).unwrap();
        assert_eq!(db.snapshot().unwrap().unwrap(), snapshot);
        assert!(db.data_size() > 0);
    }

    fn request(id: &str, card: &str, to: Row) -> MoveRequest {
        MoveRequest {
            request_id: id.into(),
            card_id: card.into(),
            title: format!("Title of {card}"),
            from_row: Row::Seabed,
            to_row: to,
            created_ms: 7,
            status: MoveStatus::Sending,
            note_id: None,
            answer: None,
            error: None,
        }
    }

    #[test]
    fn placing_a_card_orders_its_cell_and_moves_only_that_card_across_columns() {
        let dir = tempfile::tempdir().unwrap();
        let mut db = Db::open(dir.path()).unwrap();
        db.place_cards("b", 2, Row::Seabed, &["a".into(), "b".into()])
            .unwrap();
        db.place_cards("c", 1, Row::Shallows, &["c".into(), "a".into(), "d".into()])
            .unwrap();
        let places: Vec<(String, Option<i64>, Row, i64)> = db
            .places()
            .unwrap()
            .into_iter()
            .map(|p| (p.card_id, p.column, p.row, p.position))
            .collect();
        assert_eq!(
            places,
            [
                ("b".into(), Some(2), Row::Seabed, 1),
                ("c".into(), Some(1), Row::Shallows, 0),
                ("a".into(), None, Row::Shallows, 1),
                ("d".into(), None, Row::Shallows, 2),
            ]
        );
    }

    #[test]
    fn a_new_request_supersedes_the_open_one_for_the_same_card() {
        let dir = tempfile::tempdir().unwrap();
        let mut db = Db::open(dir.path()).unwrap();
        db.add_request(&request("r1", "a", Row::Shallows)).unwrap();
        db.finish_send("r1", &Ok("n-1".into())).unwrap();
        db.add_request(&request("r2", "b", Row::Deep)).unwrap();
        db.finish_send("r2", &Err("no inbox".into())).unwrap();
        let open = db.open_requests().unwrap();
        assert_eq!(open[0].status, MoveStatus::Asked);
        assert_eq!(open[0].note_id.as_deref(), Some("n-1"));
        assert_eq!(open[1].status, MoveStatus::Failed);
        assert_eq!(open[1].error.as_deref(), Some("no inbox"));

        db.add_request(&request("r3", "a", Row::Surface)).unwrap();
        assert_eq!(
            db.request("r1").unwrap().unwrap().status,
            MoveStatus::Superseded
        );
        let ids: Vec<String> = db
            .open_requests()
            .unwrap()
            .into_iter()
            .map(|r| r.request_id)
            .collect();
        assert_eq!(ids, ["r2", "r3"]);
    }

    #[test]
    fn answers_only_apply_to_asked_requests_and_resends_keep_the_note() {
        let dir = tempfile::tempdir().unwrap();
        let mut db = Db::open(dir.path()).unwrap();
        db.add_request(&request("r1", "a", Row::Shallows)).unwrap();
        db.answer_request("r1", "too early").unwrap();
        assert_eq!(
            db.request("r1").unwrap().unwrap().status,
            MoveStatus::Sending
        );
        db.finish_send("r1", &Err("busy".into())).unwrap();
        db.finish_send("r1", &Ok("n-9".into())).unwrap();
        let sent = db.request("r1").unwrap().unwrap();
        assert_eq!(sent.status, MoveStatus::Asked);
        assert_eq!(sent.error, None);
        db.finish_send("r1", &Err("late".into())).unwrap();
        db.answer_request("r1", "Not until Friday.").unwrap();
        let answered = db.request("r1").unwrap().unwrap();
        assert_eq!(answered.status, MoveStatus::Answered);
        assert_eq!(answered.answer.as_deref(), Some("Not until Friday."));
        db.set_request_status("r1", MoveStatus::Dismissed).unwrap();
        assert!(db.open_requests().unwrap().is_empty());
        assert_eq!(db.all_requests().unwrap().len(), 1);
    }
}
