use std::collections::BTreeMap;

use rusqlite::{OptionalExtension, params};

use super::{Db, err};

pub type Marks = BTreeMap<String, String>;

impl Db {
    pub fn reported_marks(&self) -> Result<Marks, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, reported_ms FROM backlog_tasks WHERE reported_ms IS NOT NULL")
            .map_err(err)?;
        stmt.query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?.to_string(),
                r.get::<_, i64>(1)?.to_string(),
            ))
        })
        .map_err(err)?
        .collect::<Result<_, _>>()
        .map_err(err)
    }

    pub fn baseline_updates(&self, home: &str, marks: &Marks) -> Result<(), String> {
        let tx = self.conn.unchecked_transaction().map_err(err)?;
        let known = tx
            .query_row(
                "SELECT 1 FROM update_baselines WHERE home = ?1",
                params![home],
                |_| Ok(()),
            )
            .optional()
            .map_err(err)?
            .is_some();
        if known {
            return Ok(());
        }
        for (card_id, mark) in marks {
            tx.execute(
                "INSERT INTO seen_updates (home, card_id, mark) VALUES (?1, ?2, ?3)
                 ON CONFLICT(home, card_id) DO UPDATE SET mark = excluded.mark",
                params![home, card_id, mark],
            )
            .map_err(err)?;
        }
        tx.execute(
            "INSERT INTO update_baselines (home) VALUES (?1)",
            params![home],
        )
        .map_err(err)?;
        tx.commit().map_err(err)
    }

    pub fn seen_marks(&self, home: &str) -> Result<Marks, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT card_id, mark FROM seen_updates WHERE home = ?1")
            .map_err(err)?;
        stmt.query_map(params![home], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(err)?
            .collect::<Result<_, _>>()
            .map_err(err)
    }

    pub fn mark_seen(&self, home: &str, card_id: &str, mark: &str) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT INTO seen_updates (home, card_id, mark) VALUES (?1, ?2, ?3)
                 ON CONFLICT(home, card_id) DO UPDATE SET mark = excluded.mark",
                params![home, card_id, mark],
            )
            .map_err(err)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::backlog::{NewTask, TaskChange};
    use crate::db::{FILE_NAME, MIGRATIONS, MoveRequest, MoveStatus};
    use crate::tasks::Row;
    use rusqlite::Connection;

    const HOME: &str = "/work/firstmate";

    fn marks(pairs: &[(&str, &str)]) -> Marks {
        pairs
            .iter()
            .map(|(id, mark)| (id.to_string(), mark.to_string()))
            .collect()
    }

    #[test]
    fn the_first_look_at_a_home_takes_its_history_as_seen_once() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path()).unwrap();
        let history = marks(&[("atl-12", "3 done"), ("atl-13", "1 working")]);
        db.baseline_updates(HOME, &history).unwrap();
        assert_eq!(db.seen_marks(HOME).unwrap(), history);

        let later = marks(&[("atl-12", "4 working"), ("atl-14", "1 working")]);
        db.baseline_updates(HOME, &later).unwrap();
        assert_eq!(db.seen_marks(HOME).unwrap(), history);
        assert!(db.seen_marks("/work/other-home").unwrap().is_empty());
    }

    #[test]
    fn an_empty_first_look_still_counts_as_the_baseline() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path()).unwrap();
        db.baseline_updates("", &Marks::new()).unwrap();
        db.baseline_updates("", &marks(&[("7", "1000")])).unwrap();
        assert!(db.seen_marks("").unwrap().is_empty());
    }

    #[test]
    fn seen_marks_survive_a_restart_and_stay_per_home() {
        let dir = tempfile::tempdir().unwrap();
        {
            let db = Db::open(dir.path()).unwrap();
            db.mark_seen(HOME, "atl-12", "2 blocked").unwrap();
            db.mark_seen(HOME, "atl-12", "3 working").unwrap();
            db.mark_seen("", "7", "1000").unwrap();
        }
        let db = Db::open(dir.path()).unwrap();
        assert_eq!(
            db.seen_marks(HOME).unwrap(),
            marks(&[("atl-12", "3 working")])
        );
        assert_eq!(db.seen_marks("").unwrap(), marks(&[("7", "1000")]));
    }

    #[test]
    fn only_an_agents_change_or_move_reports_on_a_backlog_task() {
        let dir = tempfile::tempdir().unwrap();
        let mut db = Db::open(dir.path()).unwrap();
        let new = |title: &str| NewTask {
            title: title.into(),
            project: "reef-map".into(),
            ..NewTask::default()
        };
        let edited = db.add_task(&new("Chart the reef"), 1).unwrap();
        let moved = db.add_task(&new("Count the buoys"), 2).unwrap();
        let asked = db.add_task(&new("Paint the hull"), 3).unwrap();
        assert!(db.reported_marks().unwrap().is_empty());

        let change = TaskChange {
            detail: Some("Found two wrecks.".into()),
            ..TaskChange::default()
        };
        db.update_task(edited.id, &change, 10).unwrap();
        db.move_task(moved.id, Row::Shallows, 11).unwrap();
        db.ask_to_move(MoveRequest {
            request_id: "fathom-move-3-5".into(),
            card_id: asked.card_id(),
            title: asked.title.clone(),
            from_row: asked.row,
            to_row: Row::Surface,
            created_ms: 5,
            status: MoveStatus::Sending,
            note_id: None,
            answer: None,
            error: None,
        })
        .unwrap();
        db.accept_request("fathom-move-3-5", 12).unwrap();
        assert_eq!(
            db.reported_marks().unwrap(),
            marks(&[("1", "10"), ("2", "11")])
        );
    }

    #[test]
    fn the_card_updates_migration_upgrades_a_version_six_store() {
        let dir = tempfile::tempdir().unwrap();
        {
            let conn = Connection::open(dir.path().join(FILE_NAME)).unwrap();
            conn.execute_batch(&MIGRATIONS[..6].concat()).unwrap();
            conn.pragma_update(None, "user_version", 6).unwrap();
            conn.execute(
                "INSERT INTO backlog_tasks (title, project, row_key, created_ms, updated_ms)
                 VALUES ('Chart the reef', 'reef-map', 'seabed', 1, 9)",
                [],
            )
            .unwrap();
        }
        let db = Db::open(dir.path()).unwrap();
        assert_eq!(db.schema_version().unwrap(), MIGRATIONS.len());
        assert_eq!(db.tasks(None, None).unwrap()[0].updated_ms, 9);
        assert!(db.reported_marks().unwrap().is_empty());
        assert!(db.seen_marks("").unwrap().is_empty());
    }
}
