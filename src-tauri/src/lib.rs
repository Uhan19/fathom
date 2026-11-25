mod commands;
mod context;
mod control;
mod db;
mod export;
mod fonts;
mod herdr;
mod launch;
mod mcp;
mod metrics;
mod moves;
mod pulls;
mod requests;
mod settings;
mod shell_path;
mod shell_tabs;
mod snapshot;
mod source;
mod state;
mod tasks;
#[cfg(test)]
mod test_support;
mod theme_check;
mod theme_watch;
mod themes;
mod toon;
mod updates;
mod waits;
mod watch;
mod workers;

use std::ffi::OsString;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use tauri::{Manager, RunEvent};

const EXPORT_FLAG: &str = "--export";
const DEFAULT_THEME_FLAG: &str = "--default-theme";
const MAC_DATA_DIR: &str = "Library/Application Support";
const LINUX_DATA_DIR: &str = ".local/share";

pub fn run() {
    let started = Instant::now();
    let context = tauri::generate_context!();
    let identifier = context.config().identifier.clone();

    let args: Vec<String> = std::env::args().collect();
    if let Some(request) = theme_check::parse(&args) {
        let code = match request {
            Ok(request) => match store_dir(&identifier, &args) {
                Ok(dir) => theme_check::run_cli(context, request, &dir),
                Err(error) => {
                    eprintln!("fathom: {error}");
                    2
                }
            },
            Err(usage) => {
                eprintln!("{usage}");
                2
            }
        };
        std::process::exit(code);
    }

    if let Some(code) = run_helper_asking_flag(&identifier)
        .or_else(|| run_mcp_flag(&identifier))
        .or_else(|| run_export_flag(&identifier))
        .or_else(|| run_quota_record_flag(&identifier))
    {
        std::process::exit(code);
    }

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .register_asynchronous_uri_scheme_protocol(
            themes::scheme::SCHEME,
            |ctx, request, responder| {
                let app = ctx.app_handle().clone();
                let path = request.uri().path().to_string();
                std::thread::spawn(move || {
                    let state = app.try_state::<std::sync::Arc<state::AppState>>();
                    let asset = themes::scheme::serve(&path, |id| {
                        let state = state.as_ref()?;
                        state.themes.active(id)?;
                        Some(state.themes.good_copy(id))
                    });
                    responder.respond(asset.into_response());
                });
            },
        )
        .setup(move |app| {
            let data_dir = app.path().app_data_dir()?;
            let log_dir = app.path().app_log_dir()?;
            let db = db::Db::open(&data_dir)?;
            apply_launch_flags(&db, &std::env::args().collect::<Vec<_>>())?;
            let state = state::AppState::start(app.handle(), db, log_dir, started)?;
            app.manage(metrics::Metrics::start(
                app.handle().clone(),
                Arc::clone(&state),
                data_dir.clone(),
            ));
            app.manage(state);
            app.manage(std::sync::Arc::new(pulls::PrCache::default()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::cached_board,
            commands::read_board,
            commands::log_launch,
            commands::card_detail,
            commands::card_context,
            commands::card_files,
            commands::card_images,
            commands::file_preview,
            commands::open_file,
            commands::reveal_file,
            commands::pr_status,
            commands::update_column,
            commands::set_column_name,
            commands::move_column,
            commands::add_column,
            commands::delete_column,
            commands::set_row_name,
            commands::set_rows_collapsed,
            commands::place_card,
            commands::resend_request,
            commands::dismiss_request,
            commands::card_updates,
            commands::mark_seen,
            commands::workers,
            commands::get_settings,
            commands::save_settings,
            commands::change_window,
            commands::show_all_projects,
            commands::clear_focus,
            commands::set_agent_filter,
            commands::installed_fonts,
            commands::data_info,
            commands::export_data,
            commands::open_link,
            commands::herdr_status,
            commands::find_chat_terminal,
            commands::open_chat_terminal,
            commands::find_helper,
            commands::helper_check,
            commands::helper_status,
            commands::open_helper,
            commands::stop_helper,
            commands::list_terminals,
            commands::attach_terminal,
            commands::resize_terminal,
            commands::terminal_input,
            commands::detach_terminal,
            commands::send_to_terminal,
            commands::shell_tabs,
            commands::open_shell,
            commands::attach_shell_tab,
            commands::close_shell_tab,
            commands::attachable_terminals,
            commands::launcher_folders,
            commands::remember_column_folder,
            commands::active_theme,
            commands::list_themes,
            commands::duplicate_nautical,
            commands::reveal_themes_folder,
            commands::set_metrics_demand,
            commands::memory_sample,
            commands::token_report,
            commands::quota_report,
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

fn wants_default_theme(args: &[String]) -> bool {
    args.iter().any(|a| a == DEFAULT_THEME_FLAG)
}

fn apply_launch_flags(db: &db::Db, args: &[String]) -> Result<(), String> {
    if !wants_default_theme(args) {
        return Ok(());
    }
    settings::update(db, |s| {
        s.theme_id = themes::NAUTICAL.to_string();
        Ok(())
    })
    .map(|_| ())
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

fn store_dir(identifier: &str, args: &[String]) -> Result<PathBuf, String> {
    let default = default_data_dir(identifier)?.join(db::FILE_NAME);
    let store = mcp::store_path(args, mcp::db_env(), default)?;
    store
        .parent()
        .map(PathBuf::from)
        .ok_or_else(|| format!("{} has no folder", store.display()))
}

fn run_mcp_flag(identifier: &str) -> Option<i32> {
    let args: Vec<String> = std::env::args().collect();
    if !args.iter().any(|a| a == mcp::MCP_FLAG) {
        return None;
    }
    let result = default_data_dir(identifier)
        .and_then(|dir| mcp::store_path(&args, mcp::db_env(), dir.join(db::FILE_NAME)))
        .and_then(|store| mcp::serve_stdio(&store, mcp::wants_helper(&args)));
    exit_code(result)
}

fn run_quota_record_flag(identifier: &str) -> Option<i32> {
    std::env::args()
        .any(|a| a == metrics::quota::RECORD_FLAG)
        .then(|| metrics::quota::run_record(default_data_dir(identifier), state::now_ms()))
}

fn run_helper_asking_flag(identifier: &str) -> Option<i32> {
    let args: Vec<String> = std::env::args().collect();
    let asking = mcp::helper_asking(&args)?;
    let result = asking.and_then(|asking| {
        default_data_dir(identifier)
            .and_then(|dir| mcp::store_path(&args, mcp::db_env(), dir.join(db::FILE_NAME)))
            .and_then(|store| mcp::record_helper_asking(&store, asking))
    });
    exit_code(result)
}

fn exit_code(result: Result<(), String>) -> Option<i32> {
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
    fn the_default_theme_flag_starts_with_nautical_even_under_a_hostile_theme() {
        let args = |words: &[&str]| words.iter().map(|w| w.to_string()).collect::<Vec<_>>();
        for hostile in ["hostile-hidden", "hostile-white", "hostile-cover"] {
            let dir = tempfile::tempdir().unwrap();
            let db = db::Db::open(&dir.path().join("data")).unwrap();
            let themes = themes::Themes::new(dir.path().join("themes"), &dir.path().join("data"));
            let folder = themes.root.join(hostile);
            std::fs::create_dir_all(&folder).unwrap();
            let fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../fixtures/themes")
                .join(hostile);
            for file in [themes::MANIFEST_FILE, themes::STYLE_FILE] {
                std::fs::copy(fixture.join(file), folder.join(file)).unwrap();
            }
            let hash = themes::folder_hash(&folder).unwrap();
            let checked = themes.snapshot(hostile, &folder).unwrap();
            themes
                .store_result(hostile, &checked.dir, &hash, vec![], 1)
                .unwrap();
            settings::update(&db, |s| {
                s.theme_id = hostile.into();
                Ok(())
            })
            .unwrap();
            assert!(themes.active(hostile).is_some(), "{hostile}");

            apply_launch_flags(&db, &args(&["fathom"])).unwrap();
            assert_eq!(settings::load(&db).unwrap().theme_id, hostile);
            apply_launch_flags(&db, &args(&["fathom", "--default-theme"])).unwrap();
            let theme_id = settings::load(&db).unwrap().theme_id;
            assert_eq!(theme_id, themes::NAUTICAL, "{hostile}");
            assert!(themes.active(&theme_id).is_none());
        }
    }

    #[test]
    fn unsupported_systems_have_no_default_data_folder() {
        assert_eq!(data_root("windows", home(), None), None);
    }
}
