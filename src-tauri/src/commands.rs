use std::path::PathBuf;
use std::sync::Arc;

use serde::Serialize;
use tauri::State;
use tauri::ipc::{Channel, InvokeResponseBody};

use crate::control;
use crate::db::{Column, MoveTo};
use crate::export;
use crate::fonts;
use crate::herdr::{Terminal, View};
use crate::launch::{Agent, LaunchError};
use crate::moves::Placement;
use crate::settings::{Settings, WindowChange};
use crate::source::Source;
use crate::state::{
    AppState, AttachedSize, BoardView, HelperCheck, HelperStatus, HerdrStatus, Layout, Overlay,
    now_ms,
};
use crate::tasks::{Detail, Row};
use crate::workers::Worker;

type AppStateRef<'a> = State<'a, Arc<AppState>>;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataInfo {
    path: String,
    bytes: u64,
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn cached_board(state: AppStateRef) -> Result<BoardView, String> {
    state.cached_board()
}

#[tauri::command]
pub async fn read_board(state: AppStateRef<'_>) -> Result<BoardView, String> {
    let state = Arc::clone(&state);
    blocking(move || state.read_board()).await
}

#[tauri::command]
pub fn log_launch(state: AppStateRef, source: String, cards: usize) -> Option<u128> {
    state.log_launch(&source, cards)
}

#[tauri::command]
pub async fn card_detail(state: AppStateRef<'_>, id: String) -> Result<Detail, String> {
    let state = Arc::clone(&state);
    blocking(move || state.source().detail(&state.db, &id)).await
}

#[tauri::command]
pub fn update_column(
    state: AppStateRef,
    id: i64,
    width: Option<i64>,
    collapsed: Option<bool>,
) -> Result<(), String> {
    control::set_column_view(&state.db.lock().unwrap(), id, width, collapsed).map(|_| ())
}

#[tauri::command]
pub fn set_column_name(state: AppStateRef, id: i64, name: String) -> Result<(), String> {
    control::rename_column(&state.db.lock().unwrap(), id, &name).map(|_| ())
}

#[tauri::command]
pub fn move_column(state: AppStateRef, id: i64, index: usize) -> Result<Vec<Column>, String> {
    control::move_column(&mut state.db.lock().unwrap(), id, index)
}

#[tauri::command]
pub fn add_column(state: AppStateRef, name: String) -> Result<Vec<Column>, String> {
    control::add_column(&state.db.lock().unwrap(), &name)
}

#[tauri::command]
pub fn delete_column(
    state: AppStateRef,
    id: i64,
    move_to: Option<MoveTo>,
) -> Result<Layout, String> {
    state.delete_column(id, move_to)
}

#[tauri::command]
pub fn set_row_name(state: AppStateRef, row: Row, name: String) -> Result<(), String> {
    control::rename_row(&state.db.lock().unwrap(), row, &name).map(|_| ())
}

#[tauri::command]
pub async fn place_card(
    state: AppStateRef<'_>,
    placement: Placement,
    chat_terminal: Option<String>,
) -> Result<Overlay, String> {
    let state = Arc::clone(&state);
    blocking(move || state.place_card(placement, chat_terminal.as_deref())).await
}

#[tauri::command]
pub async fn resend_request(state: AppStateRef<'_>, request_id: String) -> Result<Overlay, String> {
    let state = Arc::clone(&state);
    blocking(move || state.resend_request(&request_id)).await
}

#[tauri::command]
pub fn dismiss_request(state: AppStateRef, request_id: String) -> Result<Overlay, String> {
    state.dismiss_request(&request_id)
}

#[tauri::command]
pub fn workers(state: AppStateRef) -> Vec<Worker> {
    state.workers()
}

#[tauri::command]
pub fn get_settings(state: AppStateRef) -> Settings {
    state.settings.lock().unwrap().clone()
}

#[tauri::command]
pub fn save_settings(state: AppStateRef, settings: Settings) -> Result<Settings, String> {
    state.save_settings(settings)
}

#[tauri::command]
pub fn change_window(state: AppStateRef, change: WindowChange) -> Result<Settings, String> {
    state.change_window(&change)
}

#[tauri::command]
pub fn show_all_projects(state: AppStateRef) -> Result<Settings, String> {
    state.show_all_projects()
}

#[tauri::command]
pub async fn installed_fonts() -> Result<Vec<String>, String> {
    blocking(|| Ok(fonts::installed_families())).await
}

#[tauri::command]
pub fn data_info(state: AppStateRef) -> DataInfo {
    let db = state.db.lock().unwrap();
    DataInfo {
        path: db.path().display().to_string(),
        bytes: db.data_size(),
    }
}

#[tauri::command]
pub fn export_data(state: AppStateRef, directory: String) -> Result<String, String> {
    let db = state.db.lock().unwrap();
    export::export(&db, &PathBuf::from(directory), now_ms()).map(|p| p.display().to_string())
}

#[tauri::command]
pub fn open_link(state: AppStateRef, target: String) -> Result<(), String> {
    if target.starts_with("https://") || target.starts_with("http://") {
        return tauri_plugin_opener::open_url(target, None::<&str>).map_err(|e| e.to_string());
    }
    let Source::Firstmate { home } = state.source() else {
        return Err(format!("cannot open {target} without a Firstmate home"));
    };
    let home = home
        .canonicalize()
        .map_err(|e| format!("cannot resolve the Firstmate home: {e}"))?;
    let path = home
        .join(&target)
        .canonicalize()
        .map_err(|e| format!("cannot open {target}: {e}"))?;
    if !path.starts_with(&home) {
        return Err(format!(
            "refusing to open {target} outside the Firstmate home"
        ));
    }
    tauri_plugin_opener::open_path(path, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn herdr_status(state: AppStateRef) -> HerdrStatus {
    state.herdr_status.lock().unwrap().clone()
}

#[tauri::command]
pub async fn find_chat_terminal(state: AppStateRef<'_>) -> Result<Option<Terminal>, String> {
    let state = Arc::clone(&state);
    blocking(move || state.find_chat_terminal()).await
}

#[tauri::command]
pub async fn open_chat_terminal(
    state: AppStateRef<'_>,
    agent: Agent,
) -> Result<Terminal, LaunchError> {
    let state = Arc::clone(&state);
    tauri::async_runtime::spawn_blocking(move || state.open_chat_terminal(agent))
        .await
        .map_err(|e| LaunchError::Failed {
            message: e.to_string(),
        })?
}

#[tauri::command]
pub async fn find_helper(state: AppStateRef<'_>) -> Result<Option<Terminal>, String> {
    let state = Arc::clone(&state);
    blocking(move || state.find_helper()).await
}

#[tauri::command]
pub async fn helper_check(state: AppStateRef<'_>) -> Result<HelperCheck, String> {
    let state = Arc::clone(&state);
    blocking(move || Ok(state.helper_check())).await
}

#[tauri::command]
pub fn helper_status(state: AppStateRef) -> HelperStatus {
    state.helper_status()
}

#[tauri::command]
pub async fn open_helper(state: AppStateRef<'_>) -> Result<Terminal, LaunchError> {
    let state = Arc::clone(&state);
    tauri::async_runtime::spawn_blocking(move || state.open_helper())
        .await
        .map_err(|e| LaunchError::Failed {
            message: e.to_string(),
        })?
}

#[tauri::command]
pub async fn stop_helper(state: AppStateRef<'_>, terminal: String) -> Result<(), String> {
    let state = Arc::clone(&state);
    blocking(move || state.stop_helper(&terminal)).await
}

#[tauri::command]
pub async fn list_terminals(state: AppStateRef<'_>) -> Result<Vec<Terminal>, String> {
    let state = Arc::clone(&state);
    blocking(move || state.herdr.list()).await
}

#[tauri::command]
pub fn attach_terminal(
    state: AppStateRef,
    view: View,
    terminal: String,
    cols: u16,
    rows: u16,
    output: Channel<InvokeResponseBody>,
) -> Result<AttachedSize, String> {
    state.attach_view(view, &terminal, cols, rows, output)
}

#[tauri::command]
pub fn resize_terminal(state: AppStateRef, view: View, cols: u16, rows: u16) -> Result<(), String> {
    state.herdr.resize(view, cols, rows)
}

#[tauri::command]
pub fn terminal_input(state: AppStateRef, view: View, data: String) -> Result<(), String> {
    state.herdr.write_input(view, data.as_bytes())
}

#[tauri::command]
pub fn detach_terminal(state: AppStateRef, view: View) {
    state.herdr.detach(view);
}

#[tauri::command]
pub async fn send_to_terminal(
    state: AppStateRef<'_>,
    terminal: String,
    text: String,
) -> Result<(), String> {
    let state = Arc::clone(&state);
    blocking(move || state.herdr.send(&terminal, &text)).await
}
