use std::sync::Mutex;

use serde::Serialize;

use crate::db::Db;
use crate::db::updates::Marks;
use crate::source::Source;
use crate::workers;

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CardUpdates {
    pub marks: Marks,
    pub seen: Marks,
}

pub fn card_updates(source: &Source, db: &Mutex<Db>) -> Result<CardUpdates, String> {
    let marks = match source {
        Source::Firstmate { home } => workers::read_status_marks(home)?,
        Source::Backlog => db.lock().unwrap().reported_marks()?,
    };
    let home = source.home();
    let db = db.lock().unwrap();
    db.baseline_updates(&home, &marks)?;
    let mut seen = db.seen_marks(&home)?;
    seen.retain(|card_id, _| marks.contains_key(card_id));
    Ok(CardUpdates { marks, seen })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::path::Path;

    fn append(path: &Path, line: &str) {
        let mut log = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .unwrap();
        writeln!(log, "{line}").unwrap();
    }

    fn unseen(updates: &CardUpdates) -> Vec<&str> {
        updates
            .marks
            .iter()
            .filter(|(id, mark)| updates.seen.get(*id) != Some(mark))
            .map(|(id, _)| id.as_str())
            .collect()
    }

    #[test]
    fn a_firstmate_status_line_after_the_first_launch_is_unseen_until_marked_seen() {
        let home = tempfile::tempdir().unwrap();
        let state = home.path().join("state");
        std::fs::create_dir_all(&state).unwrap();
        append(&state.join("atl-12.status"), "working [at=1]: setup done");
        append(&state.join("atl-13.status"), "done [at=2]: PR ready");
        let store = tempfile::tempdir().unwrap();
        let db = Mutex::new(Db::open(store.path()).unwrap());
        let source = Source::of(&home.path().display().to_string());

        let first = card_updates(&source, &db).unwrap();
        assert_eq!(first.marks.len(), 2);
        assert!(unseen(&first).is_empty());

        append(&state.join("atl-12.status"), "blocked [at=3]: needs a key");
        append(&state.join("atl-14.status"), "working [at=4]: setup done");
        let next = card_updates(&source, &db).unwrap();
        assert_eq!(unseen(&next), ["atl-12", "atl-14"]);

        let home_key = source.home();
        db.lock()
            .unwrap()
            .mark_seen(&home_key, "atl-12", &next.marks["atl-12"])
            .unwrap();
        drop(db);
        let reopened = Mutex::new(Db::open(store.path()).unwrap());
        assert_eq!(
            unseen(&card_updates(&source, &reopened).unwrap()),
            ["atl-14"]
        );
    }

    #[test]
    fn an_unreadable_home_takes_no_baseline() {
        let home = tempfile::tempdir().unwrap();
        let store = tempfile::tempdir().unwrap();
        let db = Mutex::new(Db::open(store.path()).unwrap());
        let source = Source::of(&home.path().display().to_string());
        assert!(card_updates(&source, &db).is_err());

        let state = home.path().join("state");
        std::fs::create_dir_all(&state).unwrap();
        append(&state.join("atl-12.status"), "working [at=1]: setup done");
        assert!(unseen(&card_updates(&source, &db).unwrap()).is_empty());
    }

    #[test]
    fn backlog_reports_light_up_after_the_first_launch() {
        use crate::db::backlog::{NewTask, TaskChange};

        let store = tempfile::tempdir().unwrap();
        let db = Mutex::new(Db::open(store.path()).unwrap());
        let task = db
            .lock()
            .unwrap()
            .add_task(
                &NewTask {
                    title: "Chart the reef".into(),
                    project: "reef-map".into(),
                    ..NewTask::default()
                },
                1,
            )
            .unwrap();
        assert!(unseen(&card_updates(&Source::Backlog, &db).unwrap()).is_empty());

        let change = TaskChange {
            detail: Some("Found two wrecks.".into()),
            ..TaskChange::default()
        };
        db.lock()
            .unwrap()
            .update_task(task.id, &change, 20)
            .unwrap();
        assert_eq!(
            unseen(&card_updates(&Source::Backlog, &db).unwrap()),
            [task.card_id()]
        );
    }
}
