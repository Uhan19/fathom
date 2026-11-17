use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use notify::RecommendedWatcher;
use serde::{Deserialize, Serialize};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter};

use crate::db::{Column, Db, RowName, Snapshot};
use crate::herdr::{self, Herdr, Notice};
use crate::tasks::{self, Card};
use crate::watch;

pub const DEFAULT_LABEL: &str = "firstmate.role=primary";
const DEFAULT_HOME_RELATIVE: &str = "Documents/firstmate";
const REFRESH_DEBOUNCE: Duration = Duration::from_millis(250);
const LAUNCH_LOG: &str = "launch.log";

pub const EVENT_BOARD: &str = "board://updated";
pub const EVENT_HERDR: &str = "herdr://status";
pub const EVENT_TERMINALS: &str = "herdr://terminals";
pub const EVENT_CHAT_SIZE: &str = "chat://size";
pub const EVENT_CHAT_ENDED: &str = "chat://ended";

const KEY_HOME: &str = "home";
const KEY_LABEL: &str = "terminalLabel";
const KEY_SESSION: &str = "hcSession";
const KEY_SOCKET: &str = "hcSocket";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub home: String,
    pub terminal_label: String,
    pub hc_session: String,
    pub hc_socket: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardView {
    pub columns: Vec<Column>,
    pub row_names: Vec<RowName>,
    pub cards: Vec<Card>,
    pub taken_at_ms: Option<i64>,
    pub home: String,
    pub from_cache: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HerdrStatus {
    pub connected: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSize {
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
    watcher: Mutex<Option<RecommendedWatcher>>,
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
        .map(|h| h.join(DEFAULT_HOME_RELATIVE).display().to_string())
        .unwrap_or_default()
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
    Ok(Settings {
        home: get(KEY_HOME, default_home()),
        terminal_label: get(KEY_LABEL, DEFAULT_LABEL.to_string()),
        hc_session: get(KEY_SESSION, String::new()),
        hc_socket: get(KEY_SOCKET, String::new()),
    })
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
        let herdr_status = Arc::new(Mutex::new(HerdrStatus {
            connected: false,
            message: "connecting".into(),
        }));
        let notify_app = app.clone();
        let notify_refresh = refresh.clone();
        let notify_status = Arc::clone(&herdr_status);
        let herdr = Herdr::new(
            connection_of(&settings),
            Arc::new(move |notice| {
                on_herdr_notice(&notify_app, &notify_refresh, &notify_status, notice)
            }),
        );
        let state = Arc::new(AppState {
            db: Mutex::new(db),
            herdr,
            herdr_status,
            settings: Mutex::new(settings),
            refresh,
            watcher: Mutex::new(None),
            started,
            launch_logged: AtomicBool::new(false),
            log_dir,
        });
        spawn_refresher(app.clone(), Arc::clone(&state), requests);
        state.restart_watcher();
        state.herdr.start_events();
        Ok(state)
    }

    pub fn home(&self) -> PathBuf {
        PathBuf::from(&self.settings.lock().unwrap().home)
    }

    pub fn request_refresh(&self) {
        let _ = self.refresh.send(());
    }

    pub fn cached_board(&self) -> Result<BoardView, String> {
        let home = self.home().display().to_string();
        let db = self.db.lock().unwrap();
        let snapshot = db.snapshot()?.filter(|s| s.home == home);
        Ok(BoardView {
            columns: db.columns()?,
            row_names: db.row_names()?,
            taken_at_ms: snapshot.as_ref().map(|s| s.taken_at_ms),
            cards: snapshot.map(|s| s.cards).unwrap_or_default(),
            home,
            from_cache: true,
            error: None,
        })
    }

    pub fn read_board(&self) -> Result<BoardView, String> {
        let home = self.home();
        match tasks::read_board(&home) {
            Ok(cards) => {
                let mut db = self.db.lock().unwrap();
                let projects: Vec<String> = cards.iter().map(|c| c.project.clone()).collect();
                let columns = db.ensure_columns(&projects)?;
                let snapshot = Snapshot {
                    taken_at_ms: now_ms(),
                    home: home.display().to_string(),
                    cards,
                };
                db.save_snapshot(&snapshot)?;
                Ok(BoardView {
                    columns,
                    row_names: db.row_names()?,
                    cards: snapshot.cards,
                    taken_at_ms: Some(snapshot.taken_at_ms),
                    home: snapshot.home,
                    from_cache: false,
                    error: None,
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
        }
        let saved = load_settings(&self.db.lock().unwrap())?;
        *self.settings.lock().unwrap() = saved.clone();
        if saved.home != previous.home {
            self.restart_watcher();
            self.request_refresh();
        }
        if connection_of(&saved) != connection_of(&previous) {
            self.herdr.set_connection(connection_of(&saved));
        }
        Ok(saved)
    }

    pub fn restart_watcher(&self) {
        let refresh = self.refresh.clone();
        let watcher = watch::watch_task_list(&self.home(), move || {
            let _ = refresh.send(());
        });
        if let Err(error) = &watcher {
            eprintln!("fathom: {error}");
        }
        *self.watcher.lock().unwrap() = watcher.ok();
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

    pub fn attach_chat(
        &self,
        terminal: &str,
        channel: Channel<InvokeResponseBody>,
    ) -> Result<ChatSize, String> {
        let (cols, rows) = self.herdr.attach(
            terminal,
            Box::new(move |bytes| {
                let _ = channel.send(InvokeResponseBody::Raw(bytes.to_vec()));
            }),
        )?;
        Ok(ChatSize {
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
        Notice::EventsDown(message) => publish(HerdrStatus {
            connected: false,
            message,
        }),
        Notice::Activity => {
            let _ = refresh.send(());
        }
        Notice::TerminalsChanged => {
            let _ = app.emit(EVENT_TERMINALS, ());
        }
        Notice::Resized {
            terminal,
            cols,
            rows,
        } => {
            let _ = app.emit(
                EVENT_CHAT_SIZE,
                ChatSize {
                    terminal,
                    cols,
                    rows,
                },
            );
        }
        Notice::AttachEnded { terminal } => {
            let _ = app.emit(EVENT_CHAT_ENDED, terminal);
        }
    }
}
