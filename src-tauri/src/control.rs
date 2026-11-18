use std::sync::Mutex;

use serde::Serialize;

use crate::db::{Column, Db, MoveTo, RowName};
use crate::moves;
use crate::settings::{self, Settings};
use crate::source::Source;
use crate::tasks::{Card, Row};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardLayout {
    pub columns: Vec<Column>,
    pub rows: Vec<RowName>,
    pub projects: Vec<String>,
    pub project_filter: Vec<String>,
}

pub fn board_layout(db: &Mutex<Db>, source: &Source) -> Result<BoardLayout, String> {
    let cards = layout_cards(db, source)?;
    let mut db = db.lock().unwrap();
    let columns = db.ensure_columns(&cards)?;
    Ok(BoardLayout {
        projects: projects(&columns),
        rows: db.row_names()?,
        project_filter: settings::load(&db)?.project_filter,
        columns,
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

pub fn rename_row(db: &Db, row: Row, name: &str) -> Result<Vec<RowName>, String> {
    db.set_row_name(row, name)?;
    db.row_names()
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
