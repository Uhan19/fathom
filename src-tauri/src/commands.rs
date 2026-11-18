use std::path::PathBuf;
use std::sync::Arc;

use serde::Serialize;
use tauri::State;
use tauri::ipc::{Channel, InvokeResponseBody};

use crate::export;
use crate::fonts;
use crate::herdr::Terminal;
use crate::moves::Placement;
use crate::state::{AppState, BoardView, ChatSize, HerdrStatus, Overlay, Settings, now_ms};
use crate::tasks::{self, Detail, Row};
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
    let home = state.home();
    blocking(move || tasks::read_detail(&home, &id)).await
}

#[tauri::command]
pub fn update_column(
    state: AppStateRef,
    project: String,
    width: Option<i64>,
    collapsed: Option<bool>,
) -> Result<(), String> {
    state
        .db
        .lock()
        .unwrap()
        .update_column(&project, width, collapsed)
}

#[tauri::command]
pub fn set_row_name(state: AppStateRef, row: Row, name: String) -> Result<(), String> {
    state.db.lock().unwrap().set_row_name(row, &name)
}

#[tauri::command]
pub async fn place_card(state: AppStateRef<'_>, placement: Placement) -> Result<Overlay, String> {
    let state = Arc::clone(&state);
    blocking(move || state.place_card(placement)).await
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
    let home = state
        .home()
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
    blocking(move || {
        let label = state.settings.lock().unwrap().terminal_label.clone();
        state.herdr.find_by_label(&label)
    })
    .await
}

#[tauri::command]
pub async fn list_terminals(state: AppStateRef<'_>) -> Result<Vec<Terminal>, String> {
    let state = Arc::clone(&state);
    blocking(move || state.herdr.list()).await
}

#[tauri::command]
pub fn attach_chat(
    state: AppStateRef,
    terminal: String,
    cols: u16,
    rows: u16,
    output: Channel<InvokeResponseBody>,
) -> Result<ChatSize, String> {
    state.attach_chat(&terminal, cols, rows, output)
}

#[tauri::command]
pub fn resize_chat(state: AppStateRef, cols: u16, rows: u16) -> Result<(), String> {
    state.herdr.resize(cols, rows)
}

#[tauri::command]
pub fn chat_input(state: AppStateRef, data: String) -> Result<(), String> {
    state.herdr.write_input(data.as_bytes())
}

#[tauri::command]
pub fn detach_chat(state: AppStateRef) {
    state.herdr.detach();
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
