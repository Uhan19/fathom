use std::collections::{BTreeSet, HashMap};

use rusqlite::params;
use serde::{Deserialize, Serialize};

use super::{Db, err};

const NEXT_TAB_POSITION: &str = "(SELECT COALESCE(MAX(position) + 1, 0) FROM shell_tabs)";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellTab {
    pub terminal: String,
    pub name: String,
    pub folder: String,
}

impl Db {
    pub fn shell_tabs(&self) -> Result<Vec<ShellTab>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT terminal, name, folder FROM shell_tabs ORDER BY position")
            .map_err(err)?;
        stmt.query_map([], |r| {
            Ok(ShellTab {
                terminal: r.get(0)?,
                name: r.get(1)?,
                folder: r.get(2)?,
            })
        })
        .map_err(err)?
        .collect::<Result<_, _>>()
        .map_err(err)
    }

    pub fn add_shell_tab(&self, tab: &ShellTab) -> Result<(), String> {
        self.conn
            .execute(
                &format!(
                    "INSERT INTO shell_tabs (terminal, name, folder, position) VALUES (?1, ?2, ?3, {NEXT_TAB_POSITION})
                     ON CONFLICT(terminal) DO UPDATE SET name = excluded.name, folder = excluded.folder"
                ),
                params![tab.terminal, tab.name, tab.folder],
            )
            .map_err(err)?;
        Ok(())
    }

    pub fn remove_shell_tab(&self, terminal: &str) -> Result<(), String> {
        self.conn
            .execute(
                "DELETE FROM shell_tabs WHERE terminal = ?1",
                params![terminal],
            )
            .map_err(err)?;
        Ok(())
    }

    pub fn keep_shell_tabs(&self, live: &BTreeSet<String>) -> Result<Vec<ShellTab>, String> {
        let (kept, gone): (Vec<ShellTab>, Vec<ShellTab>) = self
            .shell_tabs()?
            .into_iter()
            .partition(|tab| live.contains(&tab.terminal));
        for tab in gone {
            self.remove_shell_tab(&tab.terminal)?;
        }
        Ok(kept)
    }

    pub fn column_folders(&self) -> Result<HashMap<i64, String>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT column_id, folder FROM column_folders")
            .map_err(err)?;
        stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(err)?
            .collect::<Result<_, _>>()
            .map_err(err)
    }

    pub fn set_column_folder(&self, column: i64, folder: &str) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT INTO column_folders (column_id, folder) VALUES (?1, ?2)
                 ON CONFLICT(column_id) DO UPDATE SET folder = excluded.folder",
                params![column, folder],
            )
            .map_err(err)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{FILE_NAME, MIGRATIONS};
    use rusqlite::Connection;

    fn tab(terminal: &str, name: &str, folder: &str) -> ShellTab {
        ShellTab {
            terminal: terminal.into(),
            name: name.into(),
            folder: folder.into(),
        }
    }

    #[test]
    fn the_shell_tab_migration_upgrades_a_version_four_store() {
        let dir = tempfile::tempdir().unwrap();
        {
            let conn = Connection::open(dir.path().join(FILE_NAME)).unwrap();
            conn.execute_batch(&MIGRATIONS[..4].concat()).unwrap();
            conn.pragma_update(None, "user_version", 4).unwrap();
            conn.execute(
                "INSERT INTO columns (project, name, position, width) VALUES ('reef-map', 'Reef', 0, 240)",
                [],
            )
            .unwrap();
        }
        let db = Db::open(dir.path()).unwrap();
        assert_eq!(db.schema_version().unwrap(), MIGRATIONS.len());
        assert_eq!(db.columns().unwrap()[0].name, "Reef");
        assert!(db.shell_tabs().unwrap().is_empty());
        assert!(db.column_folders().unwrap().is_empty());
    }

    #[test]
    fn shell_tabs_keep_their_order_across_a_restart() {
        let dir = tempfile::tempdir().unwrap();
        {
            let db = Db::open(dir.path()).unwrap();
            db.add_shell_tab(&tab("t3", "zsh · reef", "/work/reef"))
                .unwrap();
            db.add_shell_tab(&tab("t1", "zsh · ~", "/home/demo"))
                .unwrap();
            db.add_shell_tab(&tab("t7", "codex · harbor", "/work/harbor"))
                .unwrap();
            db.add_shell_tab(&tab("t3", "bash · reef", "/work/reef"))
                .unwrap();
            db.remove_shell_tab("t1").unwrap();
        }
        let db = Db::open(dir.path()).unwrap();
        assert_eq!(
            db.shell_tabs().unwrap(),
            [
                tab("t3", "bash · reef", "/work/reef"),
                tab("t7", "codex · harbor", "/work/harbor")
            ]
        );
    }

    #[test]
    fn tabs_of_gone_terminals_are_dropped_for_good() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path()).unwrap();
        for terminal in ["t1", "t2", "t3"] {
            db.add_shell_tab(&tab(terminal, "zsh · reef", "/work/reef"))
                .unwrap();
        }
        let live: BTreeSet<String> = ["t1".to_string(), "t3".into(), "t9".into()].into();
        let kept: Vec<String> = db
            .keep_shell_tabs(&live)
            .unwrap()
            .into_iter()
            .map(|t| t.terminal)
            .collect();
        assert_eq!(kept, ["t1", "t3"]);
        assert_eq!(db.shell_tabs().unwrap().len(), 2);
    }

    #[test]
    fn a_column_remembers_its_last_chosen_folder() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path()).unwrap();
        db.set_column_folder(4, "/work/reef").unwrap();
        db.set_column_folder(9, "/work/harbor").unwrap();
        db.set_column_folder(4, "/work/reef-2").unwrap();
        let folders = db.column_folders().unwrap();
        assert_eq!(folders.len(), 2);
        assert_eq!(folders[&4], "/work/reef-2");
        assert_eq!(folders[&9], "/work/harbor");
    }
}
