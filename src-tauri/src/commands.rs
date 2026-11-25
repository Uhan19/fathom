use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::Serialize;
use tauri::State;
use tauri::ipc::{Channel, InvokeResponseBody};

use crate::context::{self, CardContext, FileEntry, Places, Preview};
use crate::control;
use crate::db::shells::ShellTab;
use crate::db::{Column, MoveTo};
use crate::export;
use crate::fonts;
use crate::herdr::{Terminal, View};
use crate::launch::{Agent, LaunchError};
use crate::metrics::memory::MemorySample;
use crate::metrics::quota::QuotaReport;
use crate::metrics::tokens::TokenReport;
use crate::metrics::{Demand, Metrics};
use crate::moves::Placement;
use crate::pulls::{PrCache, PrStatus};
use crate::requests::StopOutcome;
use crate::settings::{AgentFilter, Settings, WindowChange};
use crate::shell_tabs::LauncherFolders;
use crate::source::Source;
use crate::state::{
    AppState, AttachedSize, BoardView, HelperCheck, HelperStatus, HerdrStatus, Layout, Overlay,
    now_ms,
};
use crate::tasks::{Detail, Row};
use crate::themes::{self, Manifest, Summary};
use crate::updates::CardUpdates;
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
pub async fn card_context(state: AppStateRef<'_>, id: String) -> Result<CardContext, String> {
    let state = Arc::clone(&state);
    blocking(move || context::card_context(&state.source(), &id)).await
}

#[tauri::command]
pub async fn card_files(
    state: AppStateRef<'_>,
    id: String,
    mentioned: Vec<String>,
) -> Result<Vec<FileEntry>, String> {
    let state = Arc::clone(&state);
    blocking(move || {
        let Source::Firstmate { home } = state.source() else {
            return Ok(vec![]);
        };
        let user_home = std::env::home_dir();
        let places = Places {
            home: &home,
            user_home: user_home.as_deref(),
        };
        context::card_files(&places, &id, &mentioned)
    })
    .await
}

#[tauri::command]
pub async fn card_images(state: AppStateRef<'_>, id: String) -> Result<Vec<FileEntry>, String> {
    let state = Arc::clone(&state);
    blocking(move || {
        let Source::Firstmate { home } = state.source() else {
            return Ok(vec![]);
        };
        let user_home = std::env::home_dir();
        let places = Places {
            home: &home,
            user_home: user_home.as_deref(),
        };
        context::card_images(&places, &id)
    })
    .await
}

fn local_file(path: &str) -> Result<std::path::PathBuf, String> {
    context::existing_path(path, std::env::home_dir().as_deref())
}

#[tauri::command]
pub async fn file_preview(path: String) -> Result<Preview, String> {
    blocking(move || context::preview(&local_file(&path)?)).await
}

#[tauri::command]
pub fn open_file(path: String) -> Result<(), String> {
    tauri_plugin_opener::open_path(local_file(&path)?, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reveal_file(path: String) -> Result<(), String> {
    tauri_plugin_opener::reveal_item_in_dir(local_file(&path)?).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn pr_status(pulls: State<'_, Arc<PrCache>>, url: String) -> Result<PrStatus, String> {
    let pulls = Arc::clone(&pulls);
    blocking(move || Ok(pulls.status(&url))).await
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
pub fn set_rows_collapsed(
    state: AppStateRef,
    rows: Vec<Row>,
    collapsed: bool,
) -> Result<(), String> {
    control::set_row_view(&state.db.lock().unwrap(), &rows, collapsed).map(|_| ())
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
pub async fn card_updates(state: AppStateRef<'_>) -> Result<CardUpdates, String> {
    let state = Arc::clone(&state);
    blocking(move || state.card_updates()).await
}

#[tauri::command]
pub fn mark_seen(state: AppStateRef, card_id: String, mark: String) -> Result<(), String> {
    state.mark_seen(&card_id, &mark)
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
pub fn clear_focus(state: AppStateRef) -> Result<Settings, String> {
    state.clear_focus()
}

#[tauri::command]
pub fn set_agent_filter(state: AppStateRef, filter: AgentFilter) -> Result<Settings, String> {
    state.set_agent_filter(filter)
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
    state.herdr.resize(&view, cols, rows)
}

#[tauri::command]
pub fn terminal_input(state: AppStateRef, view: View, data: String) -> Result<(), String> {
    state.herdr.write_input(&view, data.as_bytes())
}

#[tauri::command]
pub fn detach_terminal(state: AppStateRef, view: View) {
    state.herdr.detach(&view);
}

#[tauri::command]
pub async fn shell_tabs(state: AppStateRef<'_>) -> Result<Vec<ShellTab>, String> {
    let state = Arc::clone(&state);
    blocking(move || state.shell_tabs()).await
}

#[tauri::command]
pub async fn open_shell(state: AppStateRef<'_>, folder: String) -> Result<ShellTab, LaunchError> {
    let state = Arc::clone(&state);
    tauri::async_runtime::spawn_blocking(move || state.open_shell(Path::new(&folder)))
        .await
        .map_err(|e| LaunchError::Failed {
            message: e.to_string(),
        })?
}

#[tauri::command]
pub async fn attach_shell_tab(
    state: AppStateRef<'_>,
    terminal: String,
) -> Result<ShellTab, String> {
    let state = Arc::clone(&state);
    blocking(move || state.attach_shell_tab(&terminal)).await
}

#[tauri::command]
pub fn close_shell_tab(state: AppStateRef, terminal: String) -> Result<(), String> {
    state.close_shell_tab(&terminal)
}

#[tauri::command]
pub async fn attachable_terminals(state: AppStateRef<'_>) -> Result<Vec<Terminal>, String> {
    let state = Arc::clone(&state);
    blocking(move || state.attachable_terminals()).await
}

#[tauri::command]
pub async fn launcher_folders(state: AppStateRef<'_>) -> Result<LauncherFolders, String> {
    let state = Arc::clone(&state);
    blocking(move || state.launcher_folders()).await
}

#[tauri::command]
pub fn remember_column_folder(
    state: AppStateRef,
    column: i64,
    folder: String,
) -> Result<(), String> {
    state.remember_column_folder(column, &folder)
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveTheme {
    id: String,
    version: String,
    base: String,
    manifest: Manifest,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeList {
    folder: String,
    themes: Vec<Summary>,
}

#[tauri::command]
pub fn active_theme(state: AppStateRef, id: Option<String>) -> Option<ActiveTheme> {
    let id = id.unwrap_or_else(|| state.settings.lock().unwrap().theme_id.clone());
    state.themes.active(&id).map(|active| ActiveTheme {
        base: themes::scheme::base(&active.id, &active.version),
        id: active.id,
        version: active.version,
        manifest: active.manifest,
    })
}

#[tauri::command]
pub fn list_themes(state: AppStateRef) -> ThemeList {
    ThemeList {
        folder: state.themes.root.display().to_string(),
        themes: state.themes.list(),
    }
}

#[tauri::command]
pub fn duplicate_nautical(state: AppStateRef, name: String) -> Result<String, String> {
    themes::duplicate_nautical(&state.themes, &name)
}

#[tauri::command]
pub fn reveal_themes_folder(state: AppStateRef) -> Result<(), String> {
    state.themes.write_guide()?;
    tauri_plugin_opener::open_path(&state.themes.root, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_metrics_demand(metrics: State<'_, Arc<Metrics>>, demand: Demand) {
    metrics.set_demand(demand);
}

#[tauri::command]
pub async fn memory_sample(
    state: AppStateRef<'_>,
    metrics: State<'_, Arc<Metrics>>,
) -> Result<MemorySample, String> {
    let state = Arc::clone(&state);
    let metrics = Arc::clone(&metrics);
    blocking(move || metrics.memory(&state)).await
}

#[tauri::command]
pub fn token_report(metrics: State<'_, Arc<Metrics>>) -> Option<TokenReport> {
    metrics.tokens()
}

#[tauri::command]
pub async fn stop_worker(
    state: AppStateRef<'_>,
    task_id: String,
    title: String,
) -> Result<StopOutcome, String> {
    let state = Arc::clone(&state);
    blocking(move || state.stop_worker(&task_id, &title)).await
}

#[tauri::command]
pub fn quota_report(metrics: State<'_, Arc<Metrics>>) -> QuotaReport {
    metrics.quota()
}
