use std::collections::HashMap;
use std::sync::Mutex;

use serde::Serialize;

use crate::db::backlog::Task;
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

#[derive(Debug, Clone, Serialize)]
#[serde(untagged)]
pub enum TaskRecord {
    Backlog(Task),
    Firstmate(Card),
}

impl TaskRecord {
    fn card_id(&self) -> String {
        match self {
            TaskRecord::Backlog(task) => task.card_id(),
            TaskRecord::Firstmate(card) => card.id.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardTask {
    #[serde(flatten)]
    pub task: TaskRecord,
    pub column: Option<i64>,
    pub column_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent: Option<AgentState>,
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
    let records: Vec<TaskRecord> = match source {
        Source::Backlog => db
            .tasks(project, row)?
            .into_iter()
            .map(TaskRecord::Backlog)
            .collect(),
        Source::Firstmate { .. } => cards
            .into_iter()
            .filter(|card| project.is_none_or(|p| card.project == p))
            .filter(|card| row.is_none_or(|r| card.row == r))
            .map(TaskRecord::Firstmate)
            .collect(),
    };
    Ok(records
        .into_iter()
        .map(|task| {
            let id = task.card_id();
            let column = placed.get(&id).copied();
            BoardTask {
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
