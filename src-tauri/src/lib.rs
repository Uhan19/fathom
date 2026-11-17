mod commands;
mod db;
mod export;
mod herdr;
mod shell_path;
mod state;
mod tasks;
mod toon;
mod watch;

use std::path::PathBuf;
use std::time::Instant;

use tauri::{Manager, RunEvent};

const EXPORT_FLAG: &str = "--export";

pub fn run() {
    let started = Instant::now();
    let context = tauri::generate_context!();
    let identifier = context.config().identifier.clone();

    if let Some(code) = run_export_flag(&identifier) {
        std::process::exit(code);
    }

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
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
            commands::set_row_name,
            commands::get_settings,
            commands::save_settings,
            commands::data_info,
            commands::export_data,
            commands::open_link,
            commands::herdr_status,
            commands::find_chat_terminal,
            commands::list_terminals,
            commands::attach_chat,
            commands::chat_input,
            commands::detach_chat,
            commands::send_to_terminal,
        ])
        .build(context)
        .expect("error while building Fathom");

    app.run(|handle, event| {
        if let RunEvent::Exit = event
            && let Some(state) = handle.try_state::<std::sync::Arc<state::AppState>>()
        {
            state.herdr.detach();
            state.herdr.stop_events();
        }
    });
}

fn run_export_flag(identifier: &str) -> Option<i32> {
    let args: Vec<String> = std::env::args().collect();
    let index = args.iter().position(|a| a == EXPORT_FLAG)?;
    let Some(target) = args.get(index + 1) else {
        eprintln!("usage: fathom {EXPORT_FLAG} <directory>");
        return Some(2);
    };
    let data_dir = std::env::home_dir()
        .map(|home| home.join("Library/Application Support").join(identifier))
        .unwrap_or_default();
    let result = db::Db::open(&data_dir)
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
