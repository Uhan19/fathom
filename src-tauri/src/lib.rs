mod commands;
mod db;
mod export;
mod fonts;
mod herdr;
mod mcp;
mod moves;
mod requests;
mod shell_path;
mod source;
mod state;
mod tasks;
mod toon;
mod watch;
mod workers;

use std::ffi::OsString;
use std::path::PathBuf;
use std::time::Instant;

use tauri::{Manager, RunEvent};

const EXPORT_FLAG: &str = "--export";
const MAC_DATA_DIR: &str = "Library/Application Support";
const LINUX_DATA_DIR: &str = ".local/share";

pub fn run() {
    let started = Instant::now();
    let context = tauri::generate_context!();
    let identifier = context.config().identifier.clone();

    if let Some(code) = run_mcp_flag(&identifier).or_else(|| run_export_flag(&identifier)) {
        std::process::exit(code);
    }

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(move |app| {
            let data_dir = app.path().app_data_dir()?;
            let log_dir = app.path().app_log_dir()?;
            let db = db::Db::open(&data_dir)?;
            let state = state::AppState::start(app.handle(), db, log_dir, started)?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::cached_board,
            commands::read_board,
            commands::log_launch,
            commands::card_detail,
            commands::update_column,
            commands::set_column_name,
            commands::move_column,
            commands::add_column,
            commands::delete_column,
            commands::set_row_name,
            commands::place_card,
            commands::resend_request,
            commands::dismiss_request,
            commands::workers,
            commands::get_settings,
            commands::save_settings,
            commands::installed_fonts,
            commands::data_info,
            commands::export_data,
            commands::open_link,
            commands::herdr_status,
            commands::find_chat_terminal,
            commands::list_terminals,
            commands::attach_terminal,
            commands::resize_terminal,
            commands::terminal_input,
            commands::detach_terminal,
            commands::send_to_terminal,
        ])
        .build(context)
        .expect("error while building Fathom");

    app.run(|handle, event| {
        if let RunEvent::Exit = event
            && let Some(state) = handle.try_state::<std::sync::Arc<state::AppState>>()
        {
            state.herdr.detach_all();
            state.herdr.stop_events();
        }
    });
}

fn default_data_dir(identifier: &str) -> Result<PathBuf, String> {
    data_root(
        std::env::consts::OS,
        std::env::home_dir(),
        std::env::var_os("XDG_DATA_HOME"),
    )
    .map(|root| root.join(identifier))
    .ok_or_else(|| "cannot find the app data folder".to_string())
}

fn data_root(os: &str, home: Option<PathBuf>, xdg_data_home: Option<OsString>) -> Option<PathBuf> {
    match os {
        "macos" => home.map(|home| home.join(MAC_DATA_DIR)),
        "linux" => xdg_data_home
            .map(PathBuf::from)
            .filter(|dir| dir.is_absolute())
            .or_else(|| home.map(|home| home.join(LINUX_DATA_DIR))),
        _ => None,
    }
}

fn run_mcp_flag(identifier: &str) -> Option<i32> {
    let args: Vec<String> = std::env::args().collect();
    if !args.iter().any(|a| a == mcp::MCP_FLAG) {
        return None;
    }
    let result = default_data_dir(identifier)
        .and_then(|dir| mcp::store_path(&args, mcp::db_env(), dir.join(db::FILE_NAME)))
        .and_then(|store| mcp::serve_stdio(&store));
    match result {
        Ok(()) => Some(0),
        Err(error) => {
            eprintln!("fathom: {error}");
            Some(1)
        }
    }
}

fn run_export_flag(identifier: &str) -> Option<i32> {
    let args: Vec<String> = std::env::args().collect();
    let index = args.iter().position(|a| a == EXPORT_FLAG)?;
    let Some(target) = args.get(index + 1) else {
        eprintln!("usage: fathom {EXPORT_FLAG} <directory>");
        return Some(2);
    };
    let result = default_data_dir(identifier)
        .and_then(|dir| db::Db::open(&dir))
        .and_then(|db| export::export(&db, &PathBuf::from(target), state::now_ms()));
    match result {
        Ok(path) => {
            println!("{}", path.display());
            Some(0)
        }
        Err(error) => {
            eprintln!("fathom: export failed: {error}");
            Some(1)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn home() -> Option<PathBuf> {
        Some(PathBuf::from("/home/sailor"))
    }

    #[test]
    fn macos_keeps_data_under_application_support() {
        assert_eq!(
            data_root("macos", home(), Some("/xdg".into())),
            Some(PathBuf::from("/home/sailor/Library/Application Support"))
        );
    }

    #[test]
    fn linux_follows_xdg_data_home_like_tauri() {
        assert_eq!(
            data_root("linux", home(), Some("/xdg/data".into())),
            Some(PathBuf::from("/xdg/data"))
        );
        assert_eq!(
            data_root("linux", home(), None),
            Some(PathBuf::from("/home/sailor/.local/share"))
        );
        assert_eq!(
            data_root("linux", home(), Some("relative/data".into())),
            Some(PathBuf::from("/home/sailor/.local/share"))
        );
        assert_eq!(data_root("linux", None, None), None);
    }

    #[test]
    fn unsupported_systems_have_no_default_data_folder() {
        assert_eq!(data_root("windows", home(), None), None);
    }
}
