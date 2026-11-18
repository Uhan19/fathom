use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use notify::RecommendedWatcher;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter};

use crate::db::{CardPlace, Column, Db, MoveRequest, MoveStatus, MoveTo, RowName, Snapshot};
use crate::herdr::{self, Frame, Herdr, Notice, Terminal, View};
use crate::launch::{self, Agent, FathomServer, Launch, LaunchError};
use crate::moves::{self, Placement};
use crate::shell_path;
use crate::source::{Source, SourceKind};
use crate::tasks::Card;
use crate::watch::{self, StateChange};
use crate::workers::{self, Worker};

pub const FIRSTMATE_LABEL: &str = "firstmate.role=primary";
const DEFAULT_HOME_RELATIVE: &str = "Documents/firstmate";
const FIRSTMATE_MARKER: &str = "bin/fm-tasks-axi.sh";
const REFRESH_DEBOUNCE: Duration = Duration::from_millis(250);
const STORE_POLL: Duration = REFRESH_DEBOUNCE;
const WORKERS_DEBOUNCE: Duration = Duration::from_millis(80);
const LAUNCH_LOG: &str = "launch.log";

pub const EVENT_BOARD: &str = "board://updated";
pub const EVENT_HERDR: &str = "herdr://status";
pub const EVENT_TERMINALS: &str = "herdr://terminals";
pub const EVENT_VIEW_ENDED: &str = "terminal://ended";
pub const EVENT_WORKERS: &str = "workers://updated";

const KEY_HOME: &str = "home";
const KEY_LABEL: &str = "terminalLabel";
const KEY_SESSION: &str = "hcSession";
const KEY_SOCKET: &str = "hcSocket";
const KEY_CHAT_FONT: &str = "chatFont";
const KEY_CHAT_FONT_SIZE: &str = "chatFontSize";
const KEY_BOARD_FONT: &str = "boardFont";
const KEY_BOARD_FONT_SIZE: &str = "boardFontSize";
const KEY_CHAT_ADDED_FONTS: &str = "chatAddedFonts";
const KEY_BOARD_ADDED_FONTS: &str = "boardAddedFonts";
const KEY_AGENT_FOLDER: &str = "agentFolder";
const KEY_CHAT_AGENT: &str = "chatAgent";
const DEFAULT_CHAT_FONT: &str = "sf-mono";
const DEFAULT_CHAT_FONT_SIZE: u16 = 13;
const DEFAULT_BOARD_FONT: &str = "default";
const DEFAULT_BOARD_FONT_SIZE: u16 = 14;
const FONT_SIZES: std::ops::RangeInclusive<u16> = 9..=28;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub home: String,
    pub terminal_label: String,
    pub hc_session: String,
    pub hc_socket: String,
    pub chat_font: String,
    pub chat_font_size: u16,
    pub board_font: String,
    pub board_font_size: u16,
    pub chat_added_fonts: Vec<String>,
    pub board_added_fonts: Vec<String>,
    pub agent_folder: String,
    #[serde(default)]
    pub chat_agent: Option<Agent>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardView {
    pub columns: Vec<Column>,
    pub row_names: Vec<RowName>,
    pub cards: Vec<Card>,
    pub taken_at_ms: Option<i64>,
    pub home: String,
    pub source: SourceKind,
    pub from_cache: bool,
    pub error: Option<String>,
    #[serde(flatten)]
    pub overlay: Overlay,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Overlay {
    pub places: Vec<CardPlace>,
    pub requests: Vec<MoveRequest>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Layout {
    pub columns: Vec<Column>,
    pub overlay: Overlay,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HerdrStatus {
    pub connected: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachedSize {
    pub terminal: String,
    pub cols: u16,
    pub rows: u16,
}

pub struct AppState {
    pub db: Mutex<Db>,
    pub herdr: Herdr,
    pub herdr_status: Arc<Mutex<HerdrStatus>>,
    pub settings: Mutex<Settings>,
    refresh: Sender<()>,
    workers_tick: Sender<()>,
    published_workers: Mutex<Option<Vec<Worker>>>,
    watchers: Mutex<Vec<RecommendedWatcher>>,
    started: Instant,
    launch_logged: AtomicBool,
    log_dir: PathBuf,
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn default_home() -> String {
    std::env::home_dir()
        .map(|h| h.join(DEFAULT_HOME_RELATIVE))
        .filter(|home| home.join(FIRSTMATE_MARKER).is_file())
        .map(|home| home.display().to_string())
        .unwrap_or_default()
}

fn user_home() -> String {
    std::env::home_dir()
        .map(|home| home.display().to_string())
        .unwrap_or_default()
}

fn default_label(home: &str) -> String {
    match Source::of(home) {
        Source::Firstmate { .. } => FIRSTMATE_LABEL.to_string(),
        Source::Backlog => launch::chat_label(),
    }
}

fn chosen_label(stored: Option<&String>, home: &str) -> String {
    let built_in = [FIRSTMATE_LABEL.to_string(), launch::chat_label()];
    stored
        .map(|label| label.trim().to_string())
        .filter(|label| !label.is_empty() && !built_in.contains(label))
        .unwrap_or_else(|| default_label(home))
}

pub fn load_settings(db: &Db) -> Result<Settings, String> {
    let stored = db.settings()?;
    let get = |key: &str, fallback: String| {
        stored
            .get(key)
            .filter(|v| !v.trim().is_empty())
            .cloned()
            .unwrap_or(fallback)
    };
    let size = |key: &str, fallback: u16| {
        stored
            .get(key)
            .and_then(|v| v.trim().parse::<u16>().ok())
            .filter(|v| FONT_SIZES.contains(v))
            .unwrap_or(fallback)
    };
    let families = |key: &str| {
        stored
            .get(key)
            .and_then(|v| serde_json::from_str::<Vec<String>>(v).ok())
            .map(clean_families)
            .unwrap_or_default()
    };
    let home = stored
        .get(KEY_HOME)
        .map(|home| home.trim().to_string())
        .unwrap_or_else(default_home);
    Ok(Settings {
        terminal_label: chosen_label(stored.get(KEY_LABEL), &home),
        home,
        hc_session: get(KEY_SESSION, String::new()),
        hc_socket: get(KEY_SOCKET, String::new()),
        chat_font: get(KEY_CHAT_FONT, DEFAULT_CHAT_FONT.to_string()),
        chat_font_size: size(KEY_CHAT_FONT_SIZE, DEFAULT_CHAT_FONT_SIZE),
        board_font: get(KEY_BOARD_FONT, DEFAULT_BOARD_FONT.to_string()),
        board_font_size: size(KEY_BOARD_FONT_SIZE, DEFAULT_BOARD_FONT_SIZE),
        chat_added_fonts: families(KEY_CHAT_ADDED_FONTS),
        board_added_fonts: families(KEY_BOARD_ADDED_FONTS),
        agent_folder: get(KEY_AGENT_FOLDER, user_home()),
        chat_agent: stored
            .get(KEY_CHAT_AGENT)
            .and_then(|key| serde_json::from_value(json!(key)).ok()),
    })
}

fn clean_families(families: Vec<String>) -> Vec<String> {
    let mut seen = Vec::<String>::new();
    for family in families {
        let family = family.trim();
        if !family.is_empty() && !seen.iter().any(|f| f == family) {
            seen.push(family.to_string());
        }
    }
    seen
}

fn families_json(families: &[String]) -> String {
    serde_json::to_string(&clean_families(families.to_vec())).unwrap_or_else(|_| "[]".into())
}

fn connection_of(settings: &Settings) -> herdr::Connection {
    herdr::Connection {
        session: settings.hc_session.clone(),
        socket: settings.hc_socket.clone(),
    }
}

impl AppState {
    pub fn start(
        app: &AppHandle,
        db: Db,
        log_dir: PathBuf,
        started: Instant,
    ) -> Result<Arc<AppState>, String> {
        let settings = load_settings(&db)?;
        let (refresh, requests) = mpsc::channel();
        let (workers_tick, worker_ticks) = mpsc::channel();
        let herdr_status = Arc::new(Mutex::new(HerdrStatus {
            connected: false,
            message: "connecting".into(),
        }));
        let notify_app = app.clone();
        let notify_refresh = refresh.clone();
        let notify_workers = workers_tick.clone();
        let notify_status = Arc::clone(&herdr_status);
        let herdr = Herdr::new(
            connection_of(&settings),
            Arc::new(move |notice| {
                on_herdr_notice(
                    &notify_app,
                    &notify_refresh,
                    &notify_workers,
                    &notify_status,
                    notice,
                )
            }),
        );
        let state = Arc::new(AppState {
            db: Mutex::new(db),
            herdr,
            herdr_status,
            settings: Mutex::new(settings),
            refresh,
            workers_tick,
            published_workers: Mutex::new(None),
            watchers: Mutex::new(Vec::new()),
            started,
            launch_logged: AtomicBool::new(false),
            log_dir,
        });
        spawn_refresher(app.clone(), Arc::clone(&state), requests);
        spawn_worker_publisher(app.clone(), Arc::clone(&state), worker_ticks);
        state.restart_watcher();
        state.watch_store();
        state.herdr.start_events();
        Ok(state)
    }

    pub fn source(&self) -> Source {
        Source::of(&self.settings.lock().unwrap().home)
    }

    pub fn request_refresh(&self) {
        let _ = self.refresh.send(());
    }

    pub fn cached_board(&self) -> Result<BoardView, String> {
        let source = self.source();
        let home = source.home();
        let db = self.db.lock().unwrap();
        let snapshot = db.snapshot()?.filter(|s| s.home == home);
        Ok(BoardView {
            columns: db.columns()?,
            row_names: db.row_names()?,
            taken_at_ms: snapshot.as_ref().map(|s| s.taken_at_ms),
            cards: snapshot.map(|s| s.cards).unwrap_or_default(),
            home,
            source: source.kind(),
            from_cache: true,
            error: None,
            overlay: overlay_of(&db)?,
        })
    }

    pub fn overlay(&self) -> Result<Overlay, String> {
        overlay_of(&self.db.lock().unwrap())
    }

    pub fn read_board(&self) -> Result<BoardView, String> {
        let source = self.source();
        match source.read_cards(&self.db) {
            Ok(cards) => {
                let mut db = self.db.lock().unwrap();
                let columns = db.ensure_columns(&cards)?;
                let snapshot = Snapshot {
                    taken_at_ms: now_ms(),
                    home: source.home(),
                    cards,
                };
                db.save_snapshot(&snapshot)?;
                Ok(BoardView {
                    columns,
                    row_names: db.row_names()?,
                    cards: snapshot.cards,
                    taken_at_ms: Some(snapshot.taken_at_ms),
                    home: snapshot.home,
                    source: source.kind(),
                    from_cache: false,
                    error: None,
                    overlay: overlay_of(&db)?,
                })
            }
            Err(error) => {
                let mut view = self.cached_board()?;
                view.error = Some(error);
                Ok(view)
            }
        }
    }

    pub fn save_settings(&self, next: Settings) -> Result<Settings, String> {
        let previous = self.settings.lock().unwrap().clone();
        {
            let db = self.db.lock().unwrap();
            db.set_setting(KEY_HOME, next.home.trim())?;
            db.set_setting(KEY_LABEL, next.terminal_label.trim())?;
            db.set_setting(KEY_SESSION, next.hc_session.trim())?;
            db.set_setting(KEY_SOCKET, next.hc_socket.trim())?;
            db.set_setting(KEY_CHAT_FONT, next.chat_font.trim())?;
            db.set_setting(KEY_CHAT_FONT_SIZE, &next.chat_font_size.to_string())?;
            db.set_setting(KEY_BOARD_FONT, next.board_font.trim())?;
            db.set_setting(KEY_BOARD_FONT_SIZE, &next.board_font_size.to_string())?;
            db.set_setting(KEY_CHAT_ADDED_FONTS, &families_json(&next.chat_added_fonts))?;
            db.set_setting(
                KEY_BOARD_ADDED_FONTS,
                &families_json(&next.board_added_fonts),
            )?;
            db.set_setting(KEY_AGENT_FOLDER, next.agent_folder.trim())?;
        }
        let saved = load_settings(&self.db.lock().unwrap())?;
        *self.settings.lock().unwrap() = saved.clone();
        if saved.home != previous.home {
            self.restart_watcher();
            self.request_refresh();
            self.request_workers();
        }
        if connection_of(&saved) != connection_of(&previous) {
            self.herdr.set_connection(connection_of(&saved));
        }
        Ok(saved)
    }

    pub fn find_chat_terminal(&self) -> Result<Option<Terminal>, String> {
        let label = self.settings.lock().unwrap().terminal_label.clone();
        let chat = launch::chat_label();
        match self.herdr.find_by_label(&label)? {
            None if label != chat => self.herdr.find_by_label(&chat),
            found => Ok(found),
        }
    }

    pub fn open_chat_terminal(&self, agent: Agent) -> Result<Terminal, LaunchError> {
        let folder = self.settings.lock().unwrap().agent_folder.clone();
        let cwd = match (self.source(), agent) {
            (Source::Firstmate { home }, Agent::Firstmate) => home,
            (Source::Backlog, Agent::Firstmate) => {
                return Err(LaunchError::Failed {
                    message: "Firstmate needs a board on a Firstmate home".into(),
                });
            }
            _ => PathBuf::from(folder),
        };
        self.remember_chat_agent(agent);
        let server = FathomServer {
            program: std::env::current_exe().map_err(|e| LaunchError::Failed {
                message: format!("cannot find Fathom's own program: {e}"),
            })?,
            db: self.db.lock().unwrap().path().to_path_buf(),
        };
        launch::open(
            &self.herdr,
            &Launch {
                agent,
                role: launch::CHAT_ROLE,
                cwd: &cwd,
                server: &server,
            },
            shell_path::find,
        )
    }

    fn remember_chat_agent(&self, agent: Agent) {
        let saved = self
            .db
            .lock()
            .unwrap()
            .set_setting(KEY_CHAT_AGENT, agent.key());
        match saved {
            Ok(()) => self.settings.lock().unwrap().chat_agent = Some(agent),
            Err(error) => eprintln!("fathom: cannot remember the chat agent: {error}"),
        }
    }

    pub fn restart_watcher(&self) {
        let mut watchers = self.watchers.lock().unwrap();
        watchers.clear();
        let Source::Firstmate { home } = self.source() else {
            return;
        };
        let refresh = self.refresh.clone();
        let task_list = watch::watch_task_list(&home, move || {
            let _ = refresh.send(());
        });
        let refresh = self.refresh.clone();
        let workers = self.workers_tick.clone();
        let state = watch::watch_state(&home, move |change| {
            let _ = match change {
                StateChange::Workers => workers.send(()),
                StateChange::Replies => refresh.send(()),
            };
        });
        for watcher in [task_list, state] {
            match watcher {
                Ok(watcher) => watchers.push(watcher),
                Err(error) => eprintln!("fathom: {error}"),
            }
        }
    }

    fn watch_store(self: &Arc<Self>) {
        let state = Arc::downgrade(self);
        let refresh = self.refresh.clone();
        watch::poll_store(
            STORE_POLL,
            move || {
                let state = state.upgrade()?;
                let changed = state.db.lock().unwrap().changed_elsewhere();
                Some(changed.unwrap_or(false))
            },
            move || {
                let _ = refresh.send(());
            },
        );
    }

    pub fn request_workers(&self) {
        let _ = self.workers_tick.send(());
    }

    pub fn workers(&self) -> Vec<Worker> {
        if !self.herdr_status.lock().unwrap().connected {
            return vec![];
        }
        let Source::Firstmate { home } = self.source() else {
            return vec![];
        };
        let session = self.settings.lock().unwrap().hc_session.clone();
        workers::live_workers(
            &workers::read_bindings(&home),
            &session,
            &self.herdr.terminals(),
        )
    }

    pub fn add_column(&self, name: &str) -> Result<Vec<Column>, String> {
        self.db.lock().unwrap().add_column(name)
    }

    pub fn delete_column(&self, id: i64, move_to: Option<MoveTo>) -> Result<Layout, String> {
        let cards = match self.source() {
            Source::Firstmate { home } => moves::cached_cards(&self.db, &home)?,
            backlog => backlog.read_cards(&self.db)?,
        };
        let mut db = self.db.lock().unwrap();
        let columns = db.delete_column(id, move_to.as_ref(), &cards)?;
        Ok(Layout {
            columns,
            overlay: overlay_of(&db)?,
        })
    }

    pub fn place_card(
        &self,
        placement: Placement,
        chat_terminal: Option<&str>,
    ) -> Result<Overlay, String> {
        self.source().place(
            &self.db,
            placement,
            now_ms(),
            chat_terminal,
            |terminal, line| self.herdr.send(terminal, line),
        )?;
        self.overlay()
    }

    pub fn resend_request(&self, request_id: &str) -> Result<Overlay, String> {
        if let Source::Firstmate { home } = self.source() {
            moves::resend(&self.db, &home, request_id)?;
        }
        self.overlay()
    }

    pub fn dismiss_request(&self, request_id: &str) -> Result<Overlay, String> {
        self.db
            .lock()
            .unwrap()
            .set_request_status(request_id, MoveStatus::Dismissed)?;
        self.overlay()
    }

    pub fn log_launch(&self, source: &str, cards: usize) -> Option<u128> {
        if self.launch_logged.swap(true, Ordering::SeqCst) {
            return None;
        }
        let elapsed = self.started.elapsed().as_millis();
        let line = format!(
            "{} launch-to-populated-board {elapsed} ms source={source} cards={cards}\n",
            now_ms()
        );
        eprint!("fathom: {line}");
        append(&self.log_dir.join(LAUNCH_LOG), &line);
        Some(elapsed)
    }

    pub fn attach_view(
        &self,
        view: View,
        terminal: &str,
        cols: u16,
        rows: u16,
        channel: Channel<InvokeResponseBody>,
    ) -> Result<AttachedSize, String> {
        self.herdr.attach(
            view,
            terminal,
            cols,
            rows,
            Box::new(move |frame| {
                let body = match frame {
                    Frame::Bytes(bytes) => InvokeResponseBody::Raw(bytes.to_vec()),
                    Frame::Size { cols, rows } => {
                        InvokeResponseBody::Json(json!({ "cols": cols, "rows": rows }).to_string())
                    }
                };
                let _ = channel.send(body);
            }),
        )?;
        Ok(AttachedSize {
            terminal: terminal.to_string(),
            cols,
            rows,
        })
    }
}

fn append(path: &Path, line: &str) {
    use std::io::Write;
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        let _ = file.write_all(line.as_bytes());
    }
}

fn overlay_of(db: &Db) -> Result<Overlay, String> {
    Ok(Overlay {
        places: db.places()?,
        requests: db.open_requests()?,
    })
}

fn spawn_worker_publisher(app: AppHandle, state: Arc<AppState>, ticks: Receiver<()>) {
    std::thread::spawn(move || {
        while ticks.recv().is_ok() {
            while ticks.recv_timeout(WORKERS_DEBOUNCE).is_ok() {}
            let workers = state.workers();
            let mut published = state.published_workers.lock().unwrap();
            if published.as_ref() != Some(&workers) {
                let _ = app.emit(EVENT_WORKERS, &workers);
                *published = Some(workers);
            }
        }
    });
}

fn spawn_refresher(app: AppHandle, state: Arc<AppState>, requests: Receiver<()>) {
    std::thread::spawn(move || {
        while requests.recv().is_ok() {
            while requests.recv_timeout(REFRESH_DEBOUNCE).is_ok() {}
            match state.read_board() {
                Ok(view) => {
                    let _ = app.emit(EVENT_BOARD, view);
                }
                Err(error) => eprintln!("fathom: board read failed: {error}"),
            }
        }
    });
}

fn on_herdr_notice(
    app: &AppHandle,
    refresh: &Sender<()>,
    workers: &Sender<()>,
    status: &Mutex<HerdrStatus>,
    notice: Notice,
) {
    let publish = |next: HerdrStatus| {
        *status.lock().unwrap() = next.clone();
        let _ = app.emit(EVENT_HERDR, next);
    };
    match notice {
        Notice::EventsUp => publish(HerdrStatus {
            connected: true,
            message: String::new(),
        }),
        Notice::EventsDown(message) => {
            publish(HerdrStatus {
                connected: false,
                message,
            });
            let _ = workers.send(());
        }
        Notice::WorkersChanged => {
            let _ = workers.send(());
        }
        Notice::Activity => {
            let _ = refresh.send(());
        }
        Notice::TerminalsChanged => {
            let _ = app.emit(EVENT_TERMINALS, ());
        }
        Notice::AttachEnded { view, terminal } => {
            let _ = app.emit(
                EVENT_VIEW_ENDED,
                json!({ "view": view, "terminal": terminal }),
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn font_settings_default_and_reject_sizes_out_of_range() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path()).unwrap();
        let fresh = load_settings(&db).unwrap();
        assert_eq!(fresh.chat_font, DEFAULT_CHAT_FONT);
        assert_eq!(fresh.chat_font_size, DEFAULT_CHAT_FONT_SIZE);
        assert_eq!(fresh.board_font, DEFAULT_BOARD_FONT);
        assert_eq!(fresh.board_font_size, DEFAULT_BOARD_FONT_SIZE);

        db.set_setting(KEY_CHAT_FONT, "menlo").unwrap();
        db.set_setting(KEY_CHAT_FONT_SIZE, "17").unwrap();
        db.set_setting(KEY_BOARD_FONT_SIZE, "400").unwrap();
        let stored = load_settings(&db).unwrap();
        assert_eq!(stored.chat_font, "menlo");
        assert_eq!(stored.chat_font_size, 17);
        assert_eq!(stored.board_font_size, DEFAULT_BOARD_FONT_SIZE);
    }

    #[test]
    fn the_chat_label_defaults_to_the_board_source() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path()).unwrap();
        db.set_setting(KEY_HOME, "").unwrap();
        assert_eq!(
            load_settings(&db).unwrap().terminal_label,
            "fathom.role=chat"
        );

        db.set_setting(KEY_LABEL, FIRSTMATE_LABEL).unwrap();
        assert_eq!(
            load_settings(&db).unwrap().terminal_label,
            "fathom.role=chat"
        );

        db.set_setting(KEY_HOME, "/somewhere/firstmate").unwrap();
        assert_eq!(load_settings(&db).unwrap().terminal_label, FIRSTMATE_LABEL);
        db.set_setting(KEY_LABEL, "fathom.role=chat").unwrap();
        assert_eq!(load_settings(&db).unwrap().terminal_label, FIRSTMATE_LABEL);

        db.set_setting(KEY_LABEL, " team.role=lead ").unwrap();
        assert_eq!(load_settings(&db).unwrap().terminal_label, "team.role=lead");
        db.set_setting(KEY_HOME, "").unwrap();
        assert_eq!(load_settings(&db).unwrap().terminal_label, "team.role=lead");
    }

    #[test]
    fn the_agent_folder_defaults_to_home_and_the_last_agent_is_remembered() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path()).unwrap();
        let fresh = load_settings(&db).unwrap();
        assert_eq!(fresh.agent_folder, user_home());
        assert_eq!(fresh.chat_agent, None);

        db.set_setting(KEY_AGENT_FOLDER, "/work/projects").unwrap();
        db.set_setting(KEY_CHAT_AGENT, "codex").unwrap();
        let stored = load_settings(&db).unwrap();
        assert_eq!(stored.agent_folder, "/work/projects");
        assert_eq!(stored.chat_agent, Some(Agent::Codex));

        db.set_setting(KEY_CHAT_AGENT, "nonsense").unwrap();
        assert_eq!(load_settings(&db).unwrap().chat_agent, None);
    }

    #[test]
    fn added_fonts_are_trimmed_deduplicated_and_survive_bad_json() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path()).unwrap();
        assert!(load_settings(&db).unwrap().chat_added_fonts.is_empty());

        let list = vec![
            " Fira Code ".to_string(),
            "Fira Code".into(),
            String::new(),
            "Iosevka".into(),
        ];
        db.set_setting(KEY_CHAT_ADDED_FONTS, &families_json(&list))
            .unwrap();
        db.set_setting(KEY_BOARD_ADDED_FONTS, "not json").unwrap();
        let stored = load_settings(&db).unwrap();
        assert_eq!(stored.chat_added_fonts, ["Fira Code", "Iosevka"]);
        assert!(stored.board_added_fonts.is_empty());
    }
}
