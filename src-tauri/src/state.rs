use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use notify::RecommendedWatcher;
use serde::Serialize;
use serde_json::json;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter};

use crate::control;
use crate::db::shells::ShellTab;
use crate::db::{CardPlace, Column, Db, MoveRequest, MoveStatus, MoveTo, RowView, Snapshot};
use crate::herdr::{self, Frame, Herdr, Notice, Terminal, View};
use crate::launch::{self, Agent, FathomServer, Launch, LaunchError, SignIn};
use crate::moves::{self, Placement};
use crate::settings::{self, AgentFilter, Settings, WindowChange};
use crate::shell_path;
use crate::shell_tabs::{self, LauncherFolders};
use crate::source::{Source, SourceKind};
use crate::tasks::Card;
use crate::updates::{self, CardUpdates};
use crate::watch::{self, StateChange};
use crate::workers::{self, Worker};

const REFRESH_DEBOUNCE: Duration = Duration::from_millis(250);
const STORE_POLL: Duration = REFRESH_DEBOUNCE;
const WORKERS_DEBOUNCE: Duration = Duration::from_millis(80);
const UPDATES_DEBOUNCE: Duration = WORKERS_DEBOUNCE;
const LAUNCH_LOG: &str = "launch.log";

pub const EVENT_BOARD: &str = "board://updated";
pub const EVENT_HERDR: &str = "herdr://status";
pub const EVENT_TERMINALS: &str = "herdr://terminals";
pub const EVENT_VIEW_ENDED: &str = "terminal://ended";
pub const EVENT_WORKERS: &str = "workers://updated";
pub const EVENT_SETTINGS: &str = "settings://updated";
pub const EVENT_HELPER: &str = "helper://updated";
pub const EVENT_UPDATES: &str = "updates://updated";
const IDLE: &str = "idle";
const BLOCKED: &str = "blocked";
const ENDED_STATES: [&str; 2] = ["finished", "lost"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardView {
    pub columns: Vec<Column>,
    pub rows: Vec<RowView>,
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

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HelperStatus {
    pub terminal: Option<String>,
    pub status: String,
    pub asking: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HelperCheck {
    pub claude: Option<String>,
    pub sign_in: Option<SignIn>,
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
    updates_tick: Sender<()>,
    published_workers: Mutex<Option<Vec<Worker>>>,
    published_updates: Mutex<Option<CardUpdates>>,
    published_helper: Mutex<HelperStatus>,
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

pub(crate) fn connection_of(settings: &Settings) -> herdr::Connection {
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
        let settings = settings::load(&db)?;
        let (refresh, requests) = mpsc::channel();
        let (workers_tick, worker_ticks) = mpsc::channel();
        let (updates_tick, update_ticks) = mpsc::channel();
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
            updates_tick,
            published_workers: Mutex::new(None),
            published_updates: Mutex::new(None),
            published_helper: Mutex::default(),
            watchers: Mutex::new(Vec::new()),
            started,
            launch_logged: AtomicBool::new(false),
            log_dir,
        });
        spawn_refresher(app.clone(), Arc::clone(&state), requests);
        spawn_worker_publisher(app.clone(), Arc::clone(&state), worker_ticks);
        spawn_updates_publisher(app.clone(), Arc::clone(&state), update_ticks);
        state.restart_watcher();
        state.watch_store(app.clone());
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
        let mut cards = snapshot
            .as_ref()
            .map(|s| s.cards.clone())
            .unwrap_or_default();
        db.number_cards(&home, &mut cards)?;
        Ok(BoardView {
            columns: db.columns()?,
            rows: db.rows()?,
            taken_at_ms: snapshot.as_ref().map(|s| s.taken_at_ms),
            cards,
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
                    rows: db.rows()?,
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
        let saved = settings::store(&self.db.lock().unwrap(), &next)?;
        self.adopt_settings(saved.clone());
        Ok(saved)
    }

    pub fn change_window(&self, change: &WindowChange) -> Result<Settings, String> {
        let saved = settings::change_window(&self.db.lock().unwrap(), change)?;
        self.adopt_settings(saved.clone());
        Ok(saved)
    }

    pub fn show_all_projects(&self) -> Result<Settings, String> {
        let saved = control::show_all_projects(&self.db.lock().unwrap())?;
        self.adopt_settings(saved.clone());
        Ok(saved)
    }

    pub fn clear_focus(&self) -> Result<Settings, String> {
        let saved = control::clear_focus(&self.db.lock().unwrap())?;
        self.adopt_settings(saved.clone());
        Ok(saved)
    }

    pub fn set_agent_filter(&self, filter: AgentFilter) -> Result<Settings, String> {
        let saved = control::set_agent_filter(&self.db.lock().unwrap(), filter)?;
        self.adopt_settings(saved.clone());
        Ok(saved)
    }

    fn adopt_settings(&self, next: Settings) -> bool {
        let previous = std::mem::replace(&mut *self.settings.lock().unwrap(), next.clone());
        if next.home != previous.home {
            self.restart_watcher();
            self.request_refresh();
            self.request_workers();
            self.request_updates();
        }
        if connection_of(&next) != connection_of(&previous) {
            self.herdr.set_connection(connection_of(&next));
        }
        next != previous
    }

    fn reload_settings(&self, app: &AppHandle) {
        let loaded = settings::load(&self.db.lock().unwrap());
        match loaded {
            Ok(next) => {
                if self.adopt_settings(next.clone()) {
                    let _ = app.emit(EVENT_SETTINGS, next);
                }
            }
            Err(error) => eprintln!("fathom: cannot reload the settings: {error}"),
        }
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
        let server = self.fathom_server()?;
        let shell = shell_path::login_shell().map(PathBuf::from);
        launch::open(
            &self.herdr,
            &Launch {
                agent,
                role: launch::CHAT_ROLE,
                task: None,
                prompt: None,
                cwd: &cwd,
                server: &server,
                shell: shell.as_deref(),
            },
            |program| shell_path::find_first(&[program]),
        )
    }

    fn fathom_server(&self) -> Result<FathomServer, LaunchError> {
        Ok(FathomServer {
            program: std::env::current_exe().map_err(|e| LaunchError::Failed {
                message: format!("cannot find Fathom's own program: {e}"),
            })?,
            db: self.db.lock().unwrap().path().to_path_buf(),
        })
    }

    fn remember_chat_agent(&self, agent: Agent) {
        let saved = settings::remember_chat_agent(&self.db.lock().unwrap(), agent);
        match saved {
            Ok(()) => self.settings.lock().unwrap().chat_agent = Some(agent),
            Err(error) => eprintln!("fathom: cannot remember the chat agent: {error}"),
        }
    }

    pub fn find_helper(&self) -> Result<Option<Terminal>, String> {
        self.herdr.find_by_label(&launch::helper_label())
    }

    pub fn helper_check(&self) -> HelperCheck {
        let claude = shell_path::find_first(&[launch::CLAUDE]);
        HelperCheck {
            sign_in: claude
                .as_deref()
                .map(|claude| launch::claude_sign_in(claude, shell_path::get())),
            claude: claude.map(|path| path.display().to_string()),
        }
    }

    pub fn open_helper(&self) -> Result<Terminal, LaunchError> {
        let claude =
            shell_path::find_first(&[launch::CLAUDE]).ok_or_else(|| LaunchError::Missing {
                tool: launch::CLAUDE.into(),
            })?;
        let server = self.fathom_server()?;
        let shell = shell_path::login_shell().map(PathBuf::from);
        let terminal = launch::open_helper(&self.herdr, &server, shell.as_deref(), &claude)?;
        let db = self.db.lock().unwrap();
        let remembered = settings::remember_helper_started(&db)
            .and_then(|()| settings::set_helper_asking(&db, false));
        match remembered {
            Ok(()) => self.settings.lock().unwrap().helper_started = true,
            Err(error) => eprintln!("fathom: cannot remember that Bosun started: {error}"),
        }
        drop(db);
        self.request_workers();
        Ok(terminal)
    }

    pub fn stop_helper(&self, terminal: &str) -> Result<(), String> {
        self.herdr.detach(&View::Helper);
        self.herdr.kill(terminal)?;
        let _ = self.herdr.run(&["rm", terminal]);
        self.request_workers();
        Ok(())
    }

    pub fn helper_status(&self) -> HelperStatus {
        let terminal = self.herdr.terminals().into_values().find(|t| {
            t.labels.get(launch::ROLE_KEY).map(String::as_str) == Some(launch::HELPER_ROLE)
                && !ENDED_STATES.contains(&t.state.as_str())
        });
        let Some(terminal) = terminal else {
            return HelperStatus::default();
        };
        let flagged = settings::helper_asking(&self.db.lock().unwrap()).unwrap_or(false);
        HelperStatus {
            asking: terminal.status == BLOCKED || flagged,
            terminal: Some(terminal.address),
            status: terminal.status,
        }
    }

    fn publish_helper(&self, app: &AppHandle) {
        let mut helper = self.helper_status();
        let mut published = self.published_helper.lock().unwrap();
        let stopped_asking = helper.status == IDLE && published.status != IDLE;
        if stopped_asking && helper.asking {
            let _ = settings::set_helper_asking(&self.db.lock().unwrap(), false);
            helper = self.helper_status();
        }
        if *published != helper {
            let _ = app.emit(EVENT_HELPER, &helper);
            *published = helper;
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
        let updates = self.updates_tick.clone();
        let state = watch::watch_state(&home, move |change| {
            let _ = match change {
                StateChange::Workers => workers.send(()),
                StateChange::Replies => refresh.send(()),
                StateChange::Updates => updates.send(()),
            };
        });
        for watcher in [task_list, state] {
            match watcher {
                Ok(watcher) => watchers.push(watcher),
                Err(error) => eprintln!("fathom: {error}"),
            }
        }
    }

    fn watch_store(self: &Arc<Self>, app: AppHandle) {
        let polled = Arc::downgrade(self);
        let changed = Arc::downgrade(self);
        watch::poll_store(
            STORE_POLL,
            move || {
                let state = polled.upgrade()?;
                let changed = state.db.lock().unwrap().changed_elsewhere();
                Some(changed.unwrap_or(false))
            },
            move || {
                let Some(state) = changed.upgrade() else {
                    return;
                };
                state.request_refresh();
                state.reload_settings(&app);
                state.request_workers();
                state.request_updates();
            },
        );
    }

    pub fn request_workers(&self) {
        let _ = self.workers_tick.send(());
    }

    pub fn request_updates(&self) {
        let _ = self.updates_tick.send(());
    }

    pub fn card_updates(&self) -> Result<CardUpdates, String> {
        updates::card_updates(&self.source(), &self.db)
    }

    pub fn mark_seen(&self, card_id: &str, mark: &str) -> Result<(), String> {
        let home = self.source().home();
        self.db.lock().unwrap().mark_seen(&home, card_id, mark)?;
        self.request_updates();
        Ok(())
    }

    pub fn workers(&self) -> Vec<Worker> {
        if !self.herdr_status.lock().unwrap().connected {
            return vec![];
        }
        let session = self.settings.lock().unwrap().hc_session.clone();
        workers::board_workers(&self.source(), &session, &self.herdr.terminals())
    }

    pub fn delete_column(&self, id: i64, move_to: Option<MoveTo>) -> Result<Layout, String> {
        let columns = control::delete_column(&self.db, &self.source(), id, move_to.as_ref())?;
        Ok(Layout {
            columns,
            overlay: self.overlay()?,
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

    pub fn shell_tabs(&self) -> Result<Vec<ShellTab>, String> {
        shell_tabs::restore(&self.herdr, &self.db.lock().unwrap())
    }

    pub fn open_shell(&self, folder: &Path) -> Result<ShellTab, LaunchError> {
        let shell = shell_path::user_shell();
        let terminal = launch::open_shell(&self.herdr, folder, &shell)?;
        let home = std::env::home_dir();
        let tab = shell_tabs::shell_tab(&terminal, &shell, folder, home.as_deref());
        self.db
            .lock()
            .unwrap()
            .add_shell_tab(&tab)
            .map_err(|message| LaunchError::Failed { message })?;
        Ok(tab)
    }

    pub fn attach_shell_tab(&self, terminal: &str) -> Result<ShellTab, String> {
        let terminal = self.herdr.get(terminal)?;
        let home = std::env::home_dir();
        let tab = shell_tabs::attached_tab(&terminal, home.as_deref());
        self.db.lock().unwrap().add_shell_tab(&tab)?;
        Ok(tab)
    }

    pub fn close_shell_tab(&self, terminal: &str) -> Result<(), String> {
        self.herdr.detach(&View::Shell(terminal.to_string()));
        self.db.lock().unwrap().remove_shell_tab(terminal)
    }

    pub fn attachable_terminals(&self) -> Result<Vec<Terminal>, String> {
        let chat_label = self.settings.lock().unwrap().terminal_label.clone();
        let session = self.settings.lock().unwrap().hc_session.clone();
        let workers = workers::board_workers(&self.source(), &session, &self.herdr.terminals());
        shell_tabs::attachable(&self.herdr, &chat_label, &workers)
    }

    pub fn launcher_folders(&self) -> Result<LauncherFolders, String> {
        let db = self.db.lock().unwrap();
        let columns = db.columns()?;
        let projects = match self.source() {
            Source::Firstmate { home } => shell_tabs::firstmate_folders(&home, &columns),
            Source::Backlog => shell_tabs::backlog_folders(&columns, &db.column_folders()?),
        };
        let home = std::env::home_dir().ok_or("cannot find the home folder")?;
        Ok(LauncherFolders {
            projects,
            home: home.display().to_string(),
        })
    }

    pub fn remember_column_folder(&self, column: i64, folder: &str) -> Result<(), String> {
        self.db.lock().unwrap().set_column_folder(column, folder)
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
            {
                let mut published = state.published_workers.lock().unwrap();
                if published.as_ref() != Some(&workers) {
                    let _ = app.emit(EVENT_WORKERS, &workers);
                    *published = Some(workers);
                }
            }
            state.publish_helper(&app);
        }
    });
}

fn spawn_updates_publisher(app: AppHandle, state: Arc<AppState>, ticks: Receiver<()>) {
    std::thread::spawn(move || {
        while ticks.recv().is_ok() {
            while ticks.recv_timeout(UPDATES_DEBOUNCE).is_ok() {}
            let updates = match state.card_updates() {
                Ok(updates) => updates,
                Err(error) => {
                    eprintln!("fathom: cannot read card updates: {error}");
                    continue;
                }
            };
            let mut published = state.published_updates.lock().unwrap();
            if published.as_ref() != Some(&updates) {
                let _ = app.emit(EVENT_UPDATES, &updates);
                *published = Some(updates);
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
