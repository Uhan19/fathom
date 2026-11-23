use std::collections::HashMap;

use rusqlite::{OptionalExtension, params};
use serde::Serialize;

use super::{Db, err};
use crate::tasks::Card;

pub const BACKLOG_HOME: &str = "";

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskNumber {
    pub number: i64,
    pub home: String,
    pub card_id: String,
}

pub fn home_key(home: &str) -> &str {
    match home.trim_end_matches('/') {
        "" if !home.is_empty() => "/",
        trimmed => trimmed,
    }
}

impl Db {
    pub fn number_cards(&self, home: &str, cards: &mut [Card]) -> Result<(), String> {
        let home = home_key(home);
        let mut known = self.numbers_in(home)?;
        if cards.iter().any(|card| !known.contains_key(&card.id)) {
            let tx = self.conn.unchecked_transaction().map_err(err)?;
            for card in cards.iter().filter(|card| !known.contains_key(&card.id)) {
                tx.execute(
                    "INSERT OR IGNORE INTO task_numbers (home, card_id) VALUES (?1, ?2)",
                    params![home, card.id],
                )
                .map_err(err)?;
            }
            tx.commit().map_err(err)?;
            known = self.numbers_in(home)?;
        }
        for card in cards.iter_mut() {
            card.number = known.get(&card.id).copied();
        }
        Ok(())
    }

    fn numbers_in(&self, home: &str) -> Result<HashMap<String, i64>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT card_id, number FROM task_numbers WHERE home = ?1")
            .map_err(err)?;
        stmt.query_map(params![home], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(err)?
            .collect::<Result<_, _>>()
            .map_err(err)
    }

    pub fn task_number(&self, number: i64) -> Result<Option<TaskNumber>, String> {
        self.conn
            .query_row(
                "SELECT number, home, card_id FROM task_numbers WHERE number = ?1",
                params![number],
                task_number_of,
            )
            .optional()
            .map_err(err)
    }

    pub fn number_named(&self, home: &str, card_id: &str) -> Result<Option<i64>, String> {
        self.conn
            .query_row(
                "SELECT number FROM task_numbers WHERE home = ?1 AND card_id = ?2",
                params![home_key(home), card_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)
    }

    pub fn task_numbers(&self) -> Result<Vec<TaskNumber>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT number, home, card_id FROM task_numbers ORDER BY number")
            .map_err(err)?;
        stmt.query_map([], task_number_of)
            .map_err(err)?
            .collect::<Result<_, _>>()
            .map_err(err)
    }
}

fn task_number_of(r: &rusqlite::Row) -> rusqlite::Result<TaskNumber> {
    Ok(TaskNumber {
        number: r.get(0)?,
        home: r.get(1)?,
        card_id: r.get(2)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::backlog::NewTask;
    use crate::db::{FILE_NAME, MIGRATIONS};
    use crate::tasks::Row;
    use rusqlite::Connection;

    const HOME: &str = "/work/firstmate";
    const OTHER_HOME: &str = "/work/other-firstmate";

    fn card(id: &str) -> Card {
        Card {
            id: id.into(),
            title: format!("Task {id}"),
            state: "queued".into(),
            kind: "ship".into(),
            project: "reef-map".into(),
            row: Row::Seabed,
            hold_kind: String::new(),
            hold_until: String::new(),
            hold_reason: String::new(),
            blocked_by: vec![],
            links: vec![],
            closed: String::new(),
            number: None,
        }
    }

    fn numbered(db: &Db, home: &str, ids: &[&str]) -> Vec<Option<i64>> {
        let mut cards: Vec<Card> = ids.iter().map(|id| card(id)).collect();
        db.number_cards(home, &mut cards).unwrap();
        cards.iter().map(|c| c.number).collect()
    }

    fn task(db: &Db, title: &str) -> crate::db::backlog::Task {
        db.add_task(
            &NewTask {
                title: title.into(),
                project: "reef-map".into(),
                ..NewTask::default()
            },
            1,
        )
        .unwrap()
    }

    #[test]
    fn cards_are_numbered_in_the_order_they_are_first_seen() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path()).unwrap();
        assert_eq!(
            numbered(&db, HOME, &["chart-reef", "count-buoys"]),
            [Some(1), Some(2)]
        );
        assert_eq!(
            numbered(&db, HOME, &["trim-sails", "count-buoys", "chart-reef"]),
            [Some(3), Some(2), Some(1)]
        );
    }

    #[test]
    fn numbers_survive_a_restart() {
        let dir = tempfile::tempdir().unwrap();
        let first = {
            let db = Db::open(dir.path()).unwrap();
            numbered(&db, HOME, &["chart-reef", "count-buoys"])
        };
        let db = Db::open(dir.path()).unwrap();
        assert_eq!(
            numbered(&db, HOME, &["count-buoys", "chart-reef"]),
            [first[1], first[0]]
        );
        assert_eq!(numbered(&db, HOME, &["paint-hull"]), [Some(3)]);
    }

    #[test]
    fn one_number_space_covers_every_home_and_the_backlog() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path()).unwrap();
        let reef = task(&db, "Chart the reef");
        assert_eq!(reef.number, Some(1));
        assert_eq!(numbered(&db, HOME, &["chart-reef"]), [Some(2)]);
        assert_eq!(numbered(&db, OTHER_HOME, &["chart-reef"]), [Some(3)]);
        assert_eq!(task(&db, "Count the buoys").number, Some(4));
        assert_eq!(
            numbered(&db, &format!("{HOME}/"), &["chart-reef"]),
            [Some(2)]
        );

        let all = db.task_numbers().unwrap();
        let numbers: Vec<i64> = all.iter().map(|n| n.number).collect();
        assert_eq!(numbers, [1, 2, 3, 4]);
        assert_eq!(all[0].home, BACKLOG_HOME);
        assert_eq!(all[0].card_id, reef.card_id());
        assert_eq!(db.task_number(3).unwrap().unwrap().home, OTHER_HOME);
        assert_eq!(db.number_named(HOME, "chart-reef").unwrap(), Some(2));
        assert_eq!(db.number_named(HOME, "trim-sails").unwrap(), None);
    }

    #[test]
    fn a_number_is_never_reused_after_its_task_is_gone() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path()).unwrap();
        assert_eq!(
            numbered(&db, HOME, &["chart-reef", "count-buoys"]),
            [Some(1), Some(2)]
        );
        db.conn
            .execute("DELETE FROM task_numbers WHERE number = 2", [])
            .unwrap();
        drop(db);
        let db = Db::open(dir.path()).unwrap();
        assert_eq!(numbered(&db, HOME, &["paint-hull"]), [Some(3)]);
        assert_eq!(numbered(&db, HOME, &["count-buoys"]), [Some(4)]);
    }

    #[test]
    fn the_migration_numbers_existing_backlog_tasks_in_creation_order() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(FILE_NAME);
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(&MIGRATIONS[..7].concat()).unwrap();
            conn.pragma_update(None, "user_version", 7).unwrap();
            for (title, created) in [("Chart the reef", 10), ("Count the buoys", 20)] {
                conn.execute(
                    "INSERT INTO backlog_tasks (title, project, row_key, created_ms, updated_ms)
                     VALUES (?1, 'reef-map', 'seabed', ?2, ?2)",
                    params![title, created],
                )
                .unwrap();
            }
        }
        let db = Db::open(dir.path()).unwrap();
        let numbers: Vec<(String, Option<i64>)> = db
            .tasks(None, None)
            .unwrap()
            .into_iter()
            .map(|t| (t.title, t.number))
            .collect();
        assert_eq!(
            numbers,
            [
                ("Chart the reef".to_string(), Some(1)),
                ("Count the buoys".to_string(), Some(2)),
            ]
        );
        assert_eq!(task(&db, "Paint the hull").number, Some(3));
    }
}
