use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;

use crate::db::backlog::{self, Task};
use crate::db::{Db, MoveRequest, MoveStatus};
use crate::moves::{self, Placement};
use crate::requests;
use crate::tasks::{self, Card, Detail};
use crate::waits::{self, Waits};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SourceKind {
    Firstmate,
    Fathom,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Source {
    Firstmate { home: PathBuf },
    Backlog,
}

pub fn nudge_line(waiting: usize) -> String {
    match waiting {
        1 => "1 board request waiting".into(),
        n => format!("{n} board requests waiting"),
    }
}

impl Source {
    pub fn of(home: &str) -> Source {
        match home.trim() {
            "" => Source::Backlog,
            home => Source::Firstmate {
                home: PathBuf::from(home),
            },
        }
    }

    pub fn kind(&self) -> SourceKind {
        match self {
            Source::Firstmate { .. } => SourceKind::Firstmate,
            Source::Backlog => SourceKind::Fathom,
        }
    }

    pub fn home(&self) -> String {
        match self {
            Source::Firstmate { home } => home.display().to_string(),
            Source::Backlog => String::new(),
        }
    }

    pub fn waits(&self) -> Waits {
        match self {
            Source::Firstmate { home } => waits::read(home),
            Source::Backlog => Waits::default(),
        }
    }

    pub fn read_cards(&self, db: &Mutex<Db>) -> Result<Vec<Card>, String> {
        let mut cards = match self {
            Source::Firstmate { home } => tasks::read_board(home)?,
            Source::Backlog => db
                .lock()
                .unwrap()
                .tasks(None, None)?
                .iter()
                .map(Task::card)
                .collect(),
        };
        db.lock().unwrap().number_cards(&self.home(), &mut cards)?;
        if let Source::Firstmate { home } = self {
            moves::reconcile(db, home, &cards)?;
        }
        Ok(cards)
    }

    pub fn detail(&self, db: &Mutex<Db>, id: &str) -> Result<Detail, String> {
        let mut detail = match self {
            Source::Firstmate { home } => tasks::read_detail(home, id)?,
            Source::Backlog => db
                .lock()
                .unwrap()
                .task(backlog::task_id(id)?)?
                .detail_view(),
        };
        db.lock()
            .unwrap()
            .number_cards(&self.home(), std::slice::from_mut(&mut detail.card))?;
        Ok(detail)
    }

    pub fn place(
        &self,
        db: &Mutex<Db>,
        placement: Placement,
        now_ms: i64,
        chat: Option<&str>,
        send: impl FnOnce(&str, &str) -> Result<(), String>,
    ) -> Result<(), String> {
        match self {
            Source::Firstmate { home } => moves::place(db, home, placement, now_ms),
            Source::Backlog => {
                let waiting = ask_agent(db, placement, now_ms)?;
                if let (Some(terminal), true) = (chat, waiting > 0)
                    && let Err(error) = send(terminal, &nudge_line(waiting))
                {
                    eprintln!("fathom: cannot nudge the chat terminal: {error}");
                }
                Ok(())
            }
        }
    }
}

fn ask_agent(db: &Mutex<Db>, placement: Placement, now_ms: i64) -> Result<usize, String> {
    let mut db = db.lock().unwrap();
    db.place_cards(
        &placement.card_id,
        placement.column,
        placement.to_row,
        &placement.order,
    )?;
    if placement.from_row == placement.to_row {
        return Ok(0);
    }
    let request = db.ask_to_move(MoveRequest {
        request_id: requests::request_id(&placement.card_id, now_ms),
        card_id: placement.card_id,
        title: placement.title,
        from_row: placement.from_row,
        to_row: placement.to_row,
        created_ms: now_ms,
        status: MoveStatus::Asked,
        note_id: None,
        answer: None,
        error: None,
    })?;
    if request.status != MoveStatus::Asked {
        return Ok(0);
    }
    Ok(db.task_requests()?.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::backlog::NewTask;
    use crate::tasks::Row;
    use std::cell::RefCell;

    fn backlog() -> (tempfile::TempDir, Mutex<Db>, Task) {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path()).unwrap();
        let task = db
            .add_task(
                &NewTask {
                    title: "Chart the reef".into(),
                    project: "reef-map".into(),
                    ..NewTask::default()
                },
                1,
            )
            .unwrap();
        (dir, Mutex::new(db), task)
    }

    fn drag(task: &Task, to_row: Row) -> Placement {
        Placement {
            card_id: task.card_id(),
            title: task.title.clone(),
            column: 1,
            from_row: task.row,
            to_row,
            order: vec![task.card_id()],
        }
    }

    fn place(
        db: &Mutex<Db>,
        placement: Placement,
        now_ms: i64,
        chat: Option<&str>,
    ) -> Vec<(String, String)> {
        let sent = RefCell::new(vec![]);
        Source::Backlog
            .place(db, placement, now_ms, chat, |terminal, line| {
                sent.borrow_mut()
                    .push((terminal.to_string(), line.to_string()));
                Ok(())
            })
            .unwrap();
        sent.into_inner()
    }

    #[test]
    fn an_empty_home_means_the_own_backlog() {
        assert_eq!(Source::of("  "), Source::Backlog);
        assert_eq!(Source::of("").kind(), SourceKind::Fathom);
        let firstmate = Source::of("/work/firstmate");
        assert_eq!(firstmate.kind(), SourceKind::Firstmate);
        assert_eq!(firstmate.home(), "/work/firstmate");
    }

    #[test]
    fn reads_backlog_tasks_as_cards_with_their_detail() {
        let (_dir, db, task) = backlog();
        let cards = Source::Backlog.read_cards(&db).unwrap();
        assert_eq!(cards, vec![task.card()]);
        let detail = Source::Backlog.detail(&db, &task.card_id()).unwrap();
        assert_eq!(detail.card.title, "Chart the reef");
        assert_eq!(detail.card.number, Some(1));
        assert!(Source::Backlog.detail(&db, "atl-12").is_err());
    }

    const FAKE_TASKS: &str = r#"#!/bin/sh
case "$1" in
  list) printf 'tasks[2]{id,state,kind,repo,title}:\n  chart-reef,queued,ship,reef-map,Chart the reef\n  count-buoys,queued,ship,reef-map,Count the buoys\n' ;;
  show) printf 'task:\n  id: %s\n  state: queued\n  kind: ship\n  repo: reef-map\n  title: Chart the reef\n' "$2" ;;
esac
"#;

    #[test]
    fn a_firstmate_detail_carries_the_same_number_as_its_card() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path().join("home");
        std::fs::create_dir_all(home.join("bin")).unwrap();
        crate::test_support::write_script(&home.join("bin/fm-tasks-axi.sh"), FAKE_TASKS);
        let db = Mutex::new(Db::open(dir.path()).unwrap());
        let source = Source::of(&home.display().to_string());

        let detail = source.detail(&db, "count-buoys").unwrap();
        assert_eq!(detail.card.number, Some(1));
        let cards = source.read_cards(&db).unwrap();
        let numbers: Vec<(&str, Option<i64>)> =
            cards.iter().map(|c| (c.id.as_str(), c.number)).collect();
        assert_eq!(numbers, [("chart-reef", Some(2)), ("count-buoys", Some(1))]);
    }

    #[test]
    fn a_row_drag_stores_a_request_keeps_the_task_and_nudges_the_chat() {
        let (_dir, db, task) = backlog();
        let sent = place(&db, drag(&task, Row::Shallows), 1_000, Some("w1:t1"));
        assert_eq!(
            sent,
            [("w1:t1".to_string(), "1 board request waiting".to_string())]
        );

        let db = db.lock().unwrap();
        assert_eq!(db.task(task.id).unwrap().row, Row::Seabed);
        let requests = db.task_requests().unwrap();
        assert_eq!(requests.len(), 1);
        assert_eq!(
            requests[0].request_id,
            format!("fathom-move-{}-1000", task.id)
        );
        assert_eq!(requests[0].status, MoveStatus::Asked);
        assert_eq!(db.open_requests().unwrap(), requests);
        assert_eq!(db.places().unwrap()[0].row, Row::Shallows);
    }

    #[test]
    fn the_nudge_counts_every_waiting_request_and_waits_without_a_chat() {
        let (_dir, db, task) = backlog();
        let other = db
            .lock()
            .unwrap()
            .add_task(
                &NewTask {
                    title: "Count the buoys".into(),
                    project: "reef-map".into(),
                    ..NewTask::default()
                },
                2,
            )
            .unwrap();
        assert!(place(&db, drag(&task, Row::Surface), 10, None).is_empty());
        let sent = place(&db, drag(&other, Row::Deep), 11, Some("w1:t1"));
        assert_eq!(sent[0].1, "2 board requests waiting");
        assert_eq!(db.lock().unwrap().task_requests().unwrap().len(), 2);
    }

    #[test]
    fn reordering_within_a_row_or_dragging_back_home_does_not_nudge() {
        let (_dir, db, task) = backlog();
        assert!(place(&db, drag(&task, Row::Seabed), 10, Some("w1:t1")).is_empty());
        place(&db, drag(&task, Row::Surface), 11, Some("w1:t1"));
        let back = Placement {
            from_row: Row::Surface,
            ..drag(&task, Row::Seabed)
        };
        assert!(place(&db, back, 12, Some("w1:t1")).is_empty());
        let db = db.lock().unwrap();
        assert!(db.task_requests().unwrap().is_empty());
        assert!(db.open_requests().unwrap().is_empty());
    }

    #[test]
    fn a_failed_nudge_still_keeps_the_request() {
        let (_dir, db, task) = backlog();
        Source::Backlog
            .place(&db, drag(&task, Row::Surface), 10, Some("w1:t1"), |_, _| {
                Err("herdr-core is not running".into())
            })
            .unwrap();
        assert_eq!(db.lock().unwrap().task_requests().unwrap().len(), 1);
    }
}
