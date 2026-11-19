use rusqlite::{OptionalExtension, params};
use serde::Serialize;

use super::{Db, MoveRequest, MoveStatus, err};
use crate::tasks::{Card, Detail, Row};

pub const DEFAULT_ROW: Row = Row::Seabed;
const CARD_KIND: &str = "task";
const TASK_FIELDS: &str = "id, title, detail, project, row_key, created_ms, updated_ms";
const MS_PER_DAY: i64 = 86_400_000;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: i64,
    pub title: String,
    pub detail: String,
    pub project: String,
    pub row: Row,
    pub created_ms: i64,
    pub updated_ms: i64,
}

#[derive(Debug, Clone, Default)]
pub struct NewTask {
    pub title: String,
    pub detail: String,
    pub project: String,
    pub row: Option<Row>,
}

#[derive(Debug, Clone, Default)]
pub struct TaskChange {
    pub title: Option<String>,
    pub detail: Option<String>,
    pub project: Option<String>,
}

impl Task {
    pub fn card_id(&self) -> String {
        self.id.to_string()
    }

    pub fn card(&self) -> Card {
        let landed = self.row == Row::Landed;
        Card {
            id: self.card_id(),
            title: self.title.clone(),
            state: if landed { "done" } else { "open" }.into(),
            kind: CARD_KIND.into(),
            project: self.project.clone(),
            row: self.row,
            hold_kind: String::new(),
            hold_until: String::new(),
            hold_reason: String::new(),
            blocked_by: vec![],
            links: vec![],
            closed: if landed {
                date_of(self.updated_ms)
            } else {
                String::new()
            },
        }
    }

    pub fn detail_view(&self) -> Detail {
        Detail {
            card: self.card(),
            body: self.detail.clone(),
            created: date_of(self.created_ms),
            priority: String::new(),
            deps: vec![],
        }
    }
}

pub fn task_id(card_id: &str) -> Result<i64, String> {
    card_id
        .parse()
        .map_err(|_| format!("{card_id} is not a Fathom task id"))
}

fn required(field: &str, value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(format!("a task needs a {field}"));
    }
    Ok(value.to_string())
}

fn date_of(ms: i64) -> String {
    let days = ms.div_euclid(MS_PER_DAY);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!("{year:04}-{month:02}-{day:02}")
}

fn task_of(r: &rusqlite::Row) -> rusqlite::Result<(Task, String)> {
    Ok((
        Task {
            id: r.get(0)?,
            title: r.get(1)?,
            detail: r.get(2)?,
            project: r.get(3)?,
            row: DEFAULT_ROW,
            created_ms: r.get(5)?,
            updated_ms: r.get(6)?,
        },
        r.get(4)?,
    ))
}

fn with_row((task, row): (Task, String)) -> Task {
    Task {
        row: Row::from_key(&row).unwrap_or(DEFAULT_ROW),
        ..task
    }
}

impl Db {
    pub fn tasks(&self, project: Option<&str>, row: Option<Row>) -> Result<Vec<Task>, String> {
        let mut stmt = self
            .conn
            .prepare(&format!(
                "SELECT {TASK_FIELDS} FROM backlog_tasks
                 WHERE (?1 IS NULL OR project = ?1) AND (?2 IS NULL OR row_key = ?2)
                 ORDER BY id"
            ))
            .map_err(err)?;
        let rows = stmt
            .query_map(params![project, row.map(Row::key)], task_of)
            .map_err(err)?;
        rows.map(|r| r.map(with_row))
            .collect::<Result<_, _>>()
            .map_err(err)
    }

    pub fn task(&self, id: i64) -> Result<Task, String> {
        self.conn
            .query_row(
                &format!("SELECT {TASK_FIELDS} FROM backlog_tasks WHERE id = ?1"),
                params![id],
                task_of,
            )
            .optional()
            .map_err(err)?
            .map(with_row)
            .ok_or_else(|| format!("no task {id}"))
    }

    pub fn add_task(&self, new: &NewTask, now_ms: i64) -> Result<Task, String> {
        let title = required("title", &new.title)?;
        let project = required("project", &new.project)?;
        self.conn
            .execute(
                "INSERT INTO backlog_tasks (title, detail, project, row_key, created_ms, updated_ms)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
                params![
                    title,
                    new.detail.trim(),
                    project,
                    new.row.unwrap_or(DEFAULT_ROW).key(),
                    now_ms
                ],
            )
            .map_err(err)?;
        self.task(self.conn.last_insert_rowid())
    }

    pub fn update_task(&self, id: i64, change: &TaskChange, now_ms: i64) -> Result<Task, String> {
        let title = change
            .title
            .as_deref()
            .map(|t| required("title", t))
            .transpose()?;
        let project = change
            .project
            .as_deref()
            .map(|p| required("project", p))
            .transpose()?;
        let detail = change.detail.as_deref().map(str::trim);
        let changed = self
            .conn
            .execute(
                "UPDATE backlog_tasks SET title = COALESCE(?2, title), detail = COALESCE(?3, detail),
                 project = COALESCE(?4, project), updated_ms = ?5, reported_ms = ?5 WHERE id = ?1",
                params![id, title, detail, project, now_ms],
            )
            .map_err(err)?;
        if changed == 0 {
            return Err(format!("no task {id}"));
        }
        self.task(id)
    }

    pub fn move_task(&mut self, id: i64, row: Row, now_ms: i64) -> Result<Task, String> {
        let tx = self.conn.transaction().map_err(err)?;
        let changed = tx
            .execute(
                "UPDATE backlog_tasks SET row_key = ?2, updated_ms = ?3 WHERE id = ?1",
                params![id, row.key(), now_ms],
            )
            .map_err(err)?;
        if changed == 0 {
            return Err(format!("no task {id}"));
        }
        let answered = tx
            .execute(
                "UPDATE move_requests SET status = 'landed'
                 WHERE card_id = ?1 AND to_row = ?2 AND status = 'asked'",
                params![id.to_string(), row.key()],
            )
            .map_err(err)?;
        if answered == 0 {
            tx.execute(
                "UPDATE backlog_tasks SET reported_ms = ?2 WHERE id = ?1",
                params![id, now_ms],
            )
            .map_err(err)?;
        }
        tx.commit().map_err(err)?;
        self.task(id)
    }

    pub fn task_requests(&self) -> Result<Vec<MoveRequest>, String> {
        self.query_requests(
            "WHERE status = 'asked' AND card_id IN (SELECT CAST(id AS TEXT) FROM backlog_tasks)
             ORDER BY created_ms",
            [],
        )
    }

    fn task_request(&self, request_id: &str) -> Result<MoveRequest, String> {
        self.task_requests()?
            .into_iter()
            .find(|r| r.request_id == request_id)
            .ok_or_else(|| format!("no pending board request {request_id}"))
    }

    pub fn accept_request(&mut self, request_id: &str, now_ms: i64) -> Result<Task, String> {
        let request = self.task_request(request_id)?;
        self.move_task(task_id(&request.card_id)?, request.to_row, now_ms)
    }

    pub fn decline_request(&self, request_id: &str, reason: &str) -> Result<MoveRequest, String> {
        let reason = reason.trim();
        if reason.is_empty() {
            return Err("declining a request needs a short reason".into());
        }
        self.task_request(request_id)?;
        self.answer_request(request_id, reason)?;
        self.request(request_id)?
            .ok_or_else(|| format!("no board request {request_id}"))
    }

    pub fn ask_to_move(&mut self, request: MoveRequest) -> Result<MoveRequest, String> {
        let task = task_id(&request.card_id).and_then(|id| self.task(id))?;
        let status = if task.row == request.to_row {
            MoveStatus::Landed
        } else {
            MoveStatus::Asked
        };
        let request = MoveRequest { status, ..request };
        self.add_request(&request)?;
        Ok(request)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> (tempfile::TempDir, Db) {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path()).unwrap();
        (dir, db)
    }

    fn new_task(title: &str, project: &str) -> NewTask {
        NewTask {
            title: title.into(),
            project: project.into(),
            ..NewTask::default()
        }
    }

    fn ask(db: &mut Db, task: &Task, to_row: Row, now_ms: i64) -> MoveRequest {
        db.ask_to_move(MoveRequest {
            request_id: format!("fathom-move-{}-{now_ms}", task.id),
            card_id: task.card_id(),
            title: task.title.clone(),
            from_row: task.row,
            to_row,
            created_ms: now_ms,
            status: MoveStatus::Sending,
            note_id: None,
            answer: None,
            error: None,
        })
        .unwrap()
    }

    #[test]
    fn adds_lists_and_filters_tasks() {
        let (_dir, db) = store();
        let first = db
            .add_task(&new_task("  Chart the reef  ", "reef-map"), 1_000)
            .unwrap();
        assert_eq!(first.title, "Chart the reef");
        assert_eq!(first.row, DEFAULT_ROW);
        assert_eq!((first.created_ms, first.updated_ms), (1_000, 1_000));
        db.add_task(
            &NewTask {
                row: Some(Row::Shallows),
                detail: "Two buoys are missing.".into(),
                ..new_task("Count the buoys", "harbor-web")
            },
            2_000,
        )
        .unwrap();

        assert_eq!(db.tasks(None, None).unwrap().len(), 2);
        let harbor = db.tasks(Some("harbor-web"), None).unwrap();
        assert_eq!(harbor.len(), 1);
        assert_eq!(harbor[0].detail, "Two buoys are missing.");
        assert_eq!(db.tasks(None, Some(Row::Shallows)).unwrap(), harbor);
        assert!(
            db.tasks(Some("reef-map"), Some(Row::Shallows))
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn rejects_tasks_without_a_title_or_project() {
        let (_dir, db) = store();
        assert_eq!(
            db.add_task(&new_task(" ", "reef-map"), 1).unwrap_err(),
            "a task needs a title"
        );
        assert_eq!(
            db.add_task(&new_task("Chart the reef", ""), 1).unwrap_err(),
            "a task needs a project"
        );
    }

    #[test]
    fn updates_only_the_given_fields() {
        let (_dir, db) = store();
        let task = db
            .add_task(&new_task("Chart the reef", "reef-map"), 1)
            .unwrap();
        let changed = db
            .update_task(
                task.id,
                &TaskChange {
                    detail: Some("Use the new sonar.".into()),
                    ..TaskChange::default()
                },
                5,
            )
            .unwrap();
        assert_eq!(changed.title, "Chart the reef");
        assert_eq!(changed.detail, "Use the new sonar.");
        assert_eq!((changed.created_ms, changed.updated_ms), (1, 5));
        assert_eq!(
            db.update_task(99, &TaskChange::default(), 5).unwrap_err(),
            "no task 99"
        );
        assert_eq!(
            db.update_task(
                task.id,
                &TaskChange {
                    project: Some(" ".into()),
                    ..TaskChange::default()
                },
                5
            )
            .unwrap_err(),
            "a task needs a project"
        );
    }

    #[test]
    fn a_landed_task_becomes_a_done_card_closed_on_its_move_day() {
        let (_dir, mut db) = store();
        let task = db
            .add_task(&new_task("Chart the reef", "reef-map"), 1)
            .unwrap();
        assert_eq!(task.card().state, "open");
        assert_eq!(task.card().closed, "");
        let landed = db
            .move_task(task.id, Row::Landed, 1_763_424_000_000)
            .unwrap();
        let card = landed.card();
        assert_eq!(card.id, task.id.to_string());
        assert_eq!((card.state.as_str(), card.row), ("done", Row::Landed));
        assert_eq!(card.closed, "2025-11-18");
        assert_eq!(landed.detail_view().created, "1970-01-01");
    }

    #[test]
    fn moving_to_the_requested_row_lands_the_request() {
        let (_dir, mut db) = store();
        let task = db
            .add_task(&new_task("Chart the reef", "reef-map"), 1)
            .unwrap();
        let request = ask(&mut db, &task, Row::Shallows, 10);
        assert_eq!(db.task_requests().unwrap(), vec![request.clone()]);

        db.move_task(task.id, Row::Deep, 11).unwrap();
        assert_eq!(db.task_requests().unwrap().len(), 1);

        db.move_task(task.id, Row::Shallows, 12).unwrap();
        assert!(db.task_requests().unwrap().is_empty());
        let stored = db.request(&request.request_id).unwrap().unwrap();
        assert_eq!(stored.status, MoveStatus::Landed);
    }

    #[test]
    fn accepting_moves_the_task_and_declining_keeps_it_with_a_reason() {
        let (_dir, mut db) = store();
        let reef = db
            .add_task(&new_task("Chart the reef", "reef-map"), 1)
            .unwrap();
        let buoys = db
            .add_task(&new_task("Count the buoys", "reef-map"), 2)
            .unwrap();
        let first = ask(&mut db, &reef, Row::Surface, 10);
        let second = ask(&mut db, &buoys, Row::Landed, 11);

        let moved = db.accept_request(&first.request_id, 20).unwrap();
        assert_eq!(moved.row, Row::Surface);

        assert_eq!(
            db.decline_request(&second.request_id, "  ").unwrap_err(),
            "declining a request needs a short reason"
        );
        let declined = db
            .decline_request(&second.request_id, "Two buoys still need a count.")
            .unwrap();
        assert_eq!(declined.status, MoveStatus::Answered);
        assert_eq!(
            declined.answer.as_deref(),
            Some("Two buoys still need a count.")
        );
        assert_eq!(db.task(buoys.id).unwrap().row, DEFAULT_ROW);
        assert!(db.task_requests().unwrap().is_empty());
        assert_eq!(
            db.accept_request(&second.request_id, 30).unwrap_err(),
            format!("no pending board request {}", second.request_id)
        );
    }

    #[test]
    fn a_new_request_supersedes_the_open_one_for_the_same_task() {
        let (_dir, mut db) = store();
        let task = db
            .add_task(&new_task("Chart the reef", "reef-map"), 1)
            .unwrap();
        let first = ask(&mut db, &task, Row::Surface, 10);
        let second = ask(&mut db, &task, Row::Deep, 11);
        assert_eq!(db.task_requests().unwrap(), vec![second]);
        assert_eq!(
            db.request(&first.request_id).unwrap().unwrap().status,
            MoveStatus::Superseded
        );
    }

    #[test]
    fn requests_for_cards_outside_the_backlog_are_not_listed() {
        let (_dir, mut db) = store();
        let request = MoveRequest {
            request_id: "fathom-move-atl-12-1".into(),
            card_id: "atl-12".into(),
            title: "Not ours".into(),
            from_row: Row::Seabed,
            to_row: Row::Surface,
            created_ms: 1,
            status: MoveStatus::Asked,
            note_id: Some("n-1".into()),
            answer: None,
            error: None,
        };
        db.add_request(&request).unwrap();
        assert!(db.task_requests().unwrap().is_empty());
        assert_eq!(
            db.ask_to_move(request).unwrap_err(),
            "atl-12 is not a Fathom task id"
        );
    }

    #[test]
    fn dates_follow_the_civil_calendar() {
        assert_eq!(date_of(0), "1970-01-01");
        assert_eq!(date_of(951_782_400_000), "2000-02-29");
        assert_eq!(date_of(1_798_675_200_000), "2026-12-31");
    }
}
