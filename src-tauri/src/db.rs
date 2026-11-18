use std::collections::HashMap;
use std::path::{Path, PathBuf};

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

use crate::tasks::{Card, Row};

pub const FILE_NAME: &str = "fathom.sqlite";
pub const DEFAULT_COLUMN_WIDTH: i64 = 240;

const MIGRATIONS: [&str; 2] = [
    include_str!("../migrations/0001_init.sql"),
    include_str!("../migrations/0002_card_moves.sql"),
];
const OPEN_STATUSES: &str = "'sending', 'asked', 'failed', 'answered'";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Column {
    pub project: String,
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
    pub project: Option<String>,
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

pub struct Db {
    conn: Connection,
    path: PathBuf,
}

impl Db {
    pub fn open(dir: &Path) -> Result<Db, String> {
        std::fs::create_dir_all(dir)
            .map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
        let path = dir.join(FILE_NAME);
        let conn =
            Connection::open(&path).map_err(|e| format!("cannot open {}: {e}", path.display()))?;
        conn.pragma_update(None, "journal_mode", "WAL")
            .map_err(err)?;
        let mut db = Db { conn, path };
        db.migrate()?;
        Ok(db)
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
        let mut stmt = self
            .conn
            .prepare("SELECT project, name, position, width, collapsed FROM columns ORDER BY position, project")
            .map_err(err)?;
        let rows = stmt
            .query_map([], |r| {
                Ok(Column {
                    project: r.get(0)?,
                    name: r.get(1)?,
                    position: r.get(2)?,
                    width: r.get(3)?,
                    collapsed: r.get(4)?,
                })
            })
            .map_err(err)?;
        rows.collect::<Result<_, _>>().map_err(err)
    }

    pub fn ensure_columns(&mut self, projects: &[String]) -> Result<Vec<Column>, String> {
        let existing = self.columns()?;
        let first = existing.iter().map(|c| c.position + 1).max().unwrap_or(0);
        let mut missing: Vec<&String> = projects
            .iter()
            .filter(|p| !existing.iter().any(|c| &c.project == *p))
            .collect();
        missing.sort();
        missing.dedup();
        if missing.is_empty() {
            return Ok(existing);
        }
        let tx = self.conn.transaction().map_err(err)?;
        for (position, project) in (first..).zip(missing) {
            tx.execute(
                "INSERT INTO columns (project, name, position, width, collapsed) VALUES (?1, ?1, ?2, ?3, 0)",
                params![project, position, DEFAULT_COLUMN_WIDTH],
            )
            .map_err(err)?;
        }
        tx.commit().map_err(err)?;
        self.columns()
    }

    pub fn update_column(
        &self,
        project: &str,
        width: Option<i64>,
        collapsed: Option<bool>,
    ) -> Result<(), String> {
        self.conn
            .execute(
                "UPDATE columns SET width = COALESCE(?2, width), collapsed = COALESCE(?3, collapsed) WHERE project = ?1",
                params![project, width, collapsed],
            )
            .map_err(err)?;
        Ok(())
    }

    pub fn set_column_name(&self, project: &str, name: &str) -> Result<(), String> {
        let name = match name.trim() {
            "" => project,
            trimmed => trimmed,
        };
        self.conn
            .execute(
                "UPDATE columns SET name = ?2 WHERE project = ?1",
                params![project, name],
            )
            .map_err(err)?;
        Ok(())
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
            .prepare("SELECT card_id, project, row_key, position FROM card_places ORDER BY row_key, position")
            .map_err(err)?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, Option<String>>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, i64>(3)?,
                ))
            })
            .map_err(err)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(err)?;
        Ok(rows
            .into_iter()
            .filter_map(|(card_id, project, row, position)| {
                Some(CardPlace {
                    card_id,
                    project,
                    row: Row::from_key(&row)?,
                    position,
                })
            })
            .collect())
    }

    pub fn place_cards(
        &mut self,
        moved: &str,
        project: &str,
        row: Row,
        order: &[String],
    ) -> Result<(), String> {
        let tx = self.conn.transaction().map_err(err)?;
        for (position, card_id) in order.iter().enumerate() {
            tx.execute(
                "INSERT INTO card_places (card_id, project, row_key, position) VALUES (?1, NULL, ?2, ?3)
                 ON CONFLICT(card_id) DO UPDATE SET row_key = excluded.row_key, position = excluded.position",
                params![card_id, row.key(), position as i64],
            )
            .map_err(err)?;
        }
        tx.execute(
            "INSERT INTO card_places (card_id, project, row_key, position) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(card_id) DO UPDATE SET project = excluded.project",
            params![
                moved,
                project,
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
    fn columns_are_seeded_then_appended_in_order() {
        let dir = tempfile::tempdir().unwrap();
        let mut db = Db::open(dir.path()).unwrap();
        let seeded = db
            .ensure_columns(&["reef".into(), "harbor".into(), "reef".into()])
            .unwrap();
        assert_eq!(
            seeded
                .iter()
                .map(|c| c.project.as_str())
                .collect::<Vec<_>>(),
            ["harbor", "reef"]
        );
        db.update_column("harbor", Some(320), Some(true)).unwrap();
        let grown = db
            .ensure_columns(&["lagoon".into(), "harbor".into()])
            .unwrap();
        assert_eq!(
            grown.iter().map(|c| c.project.as_str()).collect::<Vec<_>>(),
            ["harbor", "reef", "lagoon"]
        );
        assert_eq!(grown[0].width, 320);
        assert!(grown[0].collapsed);
        assert_eq!(grown[2].width, DEFAULT_COLUMN_WIDTH);
    }

    #[test]
    fn column_names_override_the_project_and_reset_when_empty() {
        let dir = tempfile::tempdir().unwrap();
        let mut db = Db::open(dir.path()).unwrap();
        db.ensure_columns(&["harbor".into(), "reef".into()])
            .unwrap();
        db.update_column("harbor", Some(320), Some(false)).unwrap();
        db.set_column_name("harbor", "  Harbor web  ").unwrap();
        let renamed = db
            .ensure_columns(&["harbor".into(), "reef".into()])
            .unwrap();
        assert_eq!(renamed[0].project, "harbor");
        assert_eq!(renamed[0].name, "Harbor web");
        assert_eq!(renamed[0].width, 320);
        assert_eq!(renamed[1].name, "reef");
        db.set_column_name("harbor", " ").unwrap();
        assert_eq!(db.columns().unwrap()[0].name, "harbor");
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
        db.place_cards("b", "reef", Row::Seabed, &["a".into(), "b".into()])
            .unwrap();
        db.place_cards(
            "c",
            "harbor",
            Row::Shallows,
            &["c".into(), "a".into(), "d".into()],
        )
        .unwrap();
        let places: Vec<(String, Option<String>, Row, i64)> = db
            .places()
            .unwrap()
            .into_iter()
            .map(|p| (p.card_id, p.project, p.row, p.position))
            .collect();
        assert_eq!(
            places,
            [
                ("b".into(), Some("reef".into()), Row::Seabed, 1),
                ("c".into(), Some("harbor".into()), Row::Shallows, 0),
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
