use std::collections::HashMap;
use std::fmt;
use std::sync::Mutex;

use serde::Serialize;
use serde_json::{Map, Value, json};

use crate::db::backlog::{self, Task};
use crate::db::numbers::BACKLOG_HOME;
use crate::db::{Column, Db, MoveTo, RowView};
use crate::moves;
use crate::settings::{self, AgentFilter, Settings};
use crate::source::Source;
use crate::tasks::{Card, Row};
use crate::workers::AgentState;

pub type Agents = Result<HashMap<String, AgentState>, String>;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardLayout {
    pub columns: Vec<ColumnView>,
    pub rows: Vec<RowView>,
    pub projects: Vec<String>,
    pub project_filter: Vec<String>,
    pub agent_filter: AgentFilter,
    pub focus: Vec<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnView {
    #[serde(flatten)]
    pub column: Column,
    pub tasks: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tasks_with_agent: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tasks_with_active_agent: Option<usize>,
}

pub type TaskView = Map<String, Value>;

const INNER_FIELDS: [&str; 2] = ["id", "number"];

#[derive(Debug, Clone, PartialEq)]
pub enum TaskRef {
    Number(i64),
    Name(String),
}

impl TaskRef {
    pub fn parse(text: &str) -> Result<TaskRef, String> {
        let text = text.trim();
        if let Some(digits) = text.strip_prefix('#') {
            return digits
                .trim()
                .parse()
                .map(TaskRef::Number)
                .map_err(|_| format!("{text} is not a task number"));
        }
        match text.parse() {
            Ok(number) => Ok(TaskRef::Number(number)),
            Err(_) if text.is_empty() => Err("name a task by its number or name".into()),
            Err(_) => Ok(TaskRef::Name(text.to_string())),
        }
    }
}

impl fmt::Display for TaskRef {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            TaskRef::Number(number) => write!(f, "#{number}"),
            TaskRef::Name(name) => f.write_str(name),
        }
    }
}

pub fn backlog_task_id(db: &Db, task: &TaskRef) -> Result<i64, String> {
    let number = match task {
        TaskRef::Number(number) => *number,
        TaskRef::Name(name) => {
            return Err(format!(
                "Fathom's own tasks have no name; give the task's number instead of {name}"
            ));
        }
    };
    match db.task_number(number)? {
        Some(found) if found.home == BACKLOG_HOME => backlog::task_id(&found.card_id),
        Some(found) => Err(format!(
            "#{number} is the Firstmate task {}, which Fathom cannot change",
            found.card_id
        )),
        None => Err(format!("no task #{number}")),
    }
}

pub fn backlog_view(task: &Task) -> TaskView {
    view_of(task, task.number, None)
}

fn firstmate_view(card: &Card) -> TaskView {
    view_of(card, card.number, Some(&card.id))
}

fn view_of(fields: &impl Serialize, number: Option<i64>, name: Option<&str>) -> TaskView {
    let mut view = TaskView::new();
    view.insert("number".into(), json!(number));
    if let Some(name) = name {
        view.insert("name".into(), json!(name));
    }
    if let Ok(Value::Object(fields)) = serde_json::to_value(fields) {
        view.extend(
            fields
                .into_iter()
                .filter(|(key, _)| !INNER_FIELDS.contains(&key.as_str())),
        );
    }
    view
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardTask {
    #[serde(skip)]
    pub number: Option<i64>,
    #[serde(skip)]
    pub name: Option<String>,
    #[serde(flatten)]
    pub task: TaskView,
    pub column: Option<i64>,
    pub column_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent: Option<AgentState>,
}

impl BoardTask {
    fn is(&self, task: &TaskRef) -> bool {
        match task {
            TaskRef::Number(number) => self.number == Some(*number),
            TaskRef::Name(name) => self
                .name
                .as_deref()
                .is_some_and(|own| own.eq_ignore_ascii_case(name)),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Focused {
    pub focus: Vec<BoardTask>,
    pub unknown: Vec<String>,
}

fn agent_of(states: &HashMap<String, AgentState>, card_id: &str) -> AgentState {
    states.get(card_id).copied().unwrap_or(AgentState::NoAgent)
}

pub fn board_layout(
    db: &Mutex<Db>,
    source: &Source,
    agents: &Agents,
) -> Result<BoardLayout, String> {
    let cards = layout_cards(db, source)?;
    let mut db = db.lock().unwrap();
    let columns = db.ensure_columns(&cards)?;
    let placed = db.card_columns(&cards)?;
    let states = agents.as_ref().ok();
    let views = columns
        .iter()
        .map(|column| {
            let here: Vec<&Card> = cards
                .iter()
                .filter(|card| placed.get(&card.id) == Some(&column.id))
                .collect();
            let count = |wanted: fn(AgentState) -> bool| {
                states.map(|s| here.iter().filter(|c| wanted(agent_of(s, &c.id))).count())
            };
            ColumnView {
                column: column.clone(),
                tasks: here.len(),
                tasks_with_agent: count(AgentState::has_agent),
                tasks_with_active_agent: count(AgentState::is_active),
            }
        })
        .collect();
    let settings = settings::load(&db)?;
    Ok(BoardLayout {
        projects: projects(&columns),
        rows: db.rows()?,
        project_filter: settings.project_filter,
        agent_filter: settings.agent_filter,
        focus: settings.focus,
        columns: views,
        agent_error: agents.as_ref().err().cloned(),
    })
}

pub fn board_tasks(
    db: &Mutex<Db>,
    source: &Source,
    project: Option<&str>,
    row: Option<Row>,
    agents: &Agents,
) -> Result<Vec<BoardTask>, String> {
    let cards = layout_cards(db, source)?;
    let mut db = db.lock().unwrap();
    let columns = db.ensure_columns(&cards)?;
    let placed = db.card_columns(&cards)?;
    let records: Vec<(String, Option<i64>, Option<String>, TaskView)> = match source {
        Source::Backlog => db
            .tasks(project, row)?
            .iter()
            .map(|task| (task.card_id(), task.number, None, backlog_view(task)))
            .collect(),
        Source::Firstmate { .. } => cards
            .iter()
            .filter(|card| project.is_none_or(|p| card.project == p))
            .filter(|card| row.is_none_or(|r| card.row == r))
            .map(|card| {
                let view = firstmate_view(card);
                (card.id.clone(), card.number, Some(card.id.clone()), view)
            })
            .collect(),
    };
    Ok(records
        .into_iter()
        .map(|(id, number, name, task)| {
            let column = placed.get(&id).copied();
            BoardTask {
                number,
                name,
                column_name: columns
                    .iter()
                    .find(|c| Some(c.id) == column)
                    .map(|c| c.name.clone()),
                agent: agents.as_ref().ok().map(|states| agent_of(states, &id)),
                column,
                task,
            }
        })
        .collect())
}

pub fn focus_tasks(
    db: &Mutex<Db>,
    source: &Source,
    wanted: &[String],
    agents: &Agents,
) -> Result<Focused, String> {
    if wanted.iter().all(|entry| entry.trim().is_empty()) {
        return Err("name at least one task to focus on".into());
    }
    let tasks = board_tasks(db, source, None, None, agents)?;
    let mut focus: Vec<BoardTask> = Vec::new();
    let mut unknown = Vec::new();
    for entry in wanted.iter().filter(|entry| !entry.trim().is_empty()) {
        let found = TaskRef::parse(entry)
            .ok()
            .and_then(|task| tasks.iter().find(|t| t.is(&task)));
        match found {
            Some(task) if focus.iter().any(|f| f.number == task.number) => {}
            Some(task) => focus.push(task.clone()),
            None => unknown.push(entry.trim().to_string()),
        }
    }
    if focus.is_empty() {
        return Err(format!(
            "none of these tasks is on the board: {}",
            unknown.join(", ")
        ));
    }
    let numbers = focus.iter().filter_map(|task| task.number).collect();
    settings::update(&db.lock().unwrap(), |s| {
        s.focus = numbers;
        s.project_filter.clear();
        s.agent_filter = AgentFilter::All;
        Ok(())
    })?;
    Ok(Focused { focus, unknown })
}

pub fn clear_focus(db: &Db) -> Result<Settings, String> {
    settings::update(db, |s| {
        s.focus.clear();
        Ok(())
    })
}

fn projects(columns: &[Column]) -> Vec<String> {
    let mut projects: Vec<String> = columns.iter().filter_map(|c| c.project.clone()).collect();
    projects.sort_by_key(|p| p.to_lowercase());
    projects.dedup();
    projects
}

fn existing(db: &Db, id: i64) -> Result<Column, String> {
    db.columns()?
        .into_iter()
        .find(|c| c.id == id)
        .ok_or_else(|| format!("there is no column {id}"))
}

pub fn rename_column(db: &Db, id: i64, name: &str) -> Result<Column, String> {
    existing(db, id)?;
    db.set_column_name(id, name)?;
    existing(db, id)
}

pub fn move_column(db: &mut Db, id: i64, index: usize) -> Result<Vec<Column>, String> {
    existing(db, id)?;
    db.move_column(id, index)
}

pub fn set_column_view(
    db: &Db,
    id: i64,
    width: Option<i64>,
    collapsed: Option<bool>,
) -> Result<Column, String> {
    existing(db, id)?;
    db.update_column(id, width, collapsed)?;
    existing(db, id)
}

pub fn add_column(db: &Db, name: &str) -> Result<Vec<Column>, String> {
    db.add_column(name)
}

pub fn delete_column(
    db: &Mutex<Db>,
    source: &Source,
    id: i64,
    move_to: Option<&MoveTo>,
) -> Result<Vec<Column>, String> {
    existing(&db.lock().unwrap(), id)?;
    let cards = layout_cards(db, source)?;
    db.lock().unwrap().delete_column(id, move_to, &cards)
}

fn layout_cards(db: &Mutex<Db>, source: &Source) -> Result<Vec<Card>, String> {
    match source {
        Source::Firstmate { home } => moves::cached_cards(db, home),
        backlog => backlog.read_cards(db),
    }
}

pub fn rename_row(db: &Db, row: Row, name: &str) -> Result<Vec<RowView>, String> {
    db.set_row_name(row, name)?;
    db.rows()
}

pub fn set_row_view(db: &Db, rows: &[Row], collapsed: bool) -> Result<Vec<RowView>, String> {
    if rows.is_empty() {
        return Err("name at least one row".into());
    }
    db.set_rows_collapsed(rows, collapsed)?;
    db.rows()
}

pub fn set_agent_filter(db: &Db, filter: AgentFilter) -> Result<Settings, String> {
    settings::update(db, |s| {
        s.agent_filter = filter;
        Ok(())
    })
}

pub fn show_projects(db: &Db, wanted: &[String]) -> Result<Settings, String> {
    let columns = db.columns()?;
    let known = projects(&columns);
    let mut chosen = Vec::new();
    for name in wanted {
        let name = name.trim();
        let found = columns
            .iter()
            .filter(|c| c.project.is_some())
            .find(|c| {
                c.project
                    .as_deref()
                    .is_some_and(|p| p.eq_ignore_ascii_case(name))
                    || c.name.eq_ignore_ascii_case(name)
            })
            .and_then(|c| c.project.clone())
            .ok_or_else(|| {
                format!(
                    "there is no project \"{name}\"; the projects are {}",
                    known.join(", ")
                )
            })?;
        chosen.push(found);
    }
    if chosen.is_empty() {
        return Err("name at least one project to show".into());
    }
    settings::update(db, |s| {
        s.project_filter = chosen;
        Ok(())
    })
}

pub fn show_all_projects(db: &Db) -> Result<Settings, String> {
    settings::update(db, |s| {
        s.project_filter.clear();
        Ok(())
    })
}
