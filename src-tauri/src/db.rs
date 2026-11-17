use std::collections::HashMap;
use std::path::{Path, PathBuf};

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

use crate::tasks::{Card, Row};

pub const FILE_NAME: &str = "fathom.sqlite";
pub const DEFAULT_COLUMN_WIDTH: i64 = 280;

const MIGRATIONS: [&str; 1] = [include_str!("../migrations/0001_init.sql")];

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
}
