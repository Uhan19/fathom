use std::collections::HashMap;
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

use crate::db::{CardPlace, Column, Db, MoveRequest, MoveStatus, RowName, Snapshot};
use crate::herdr::{self, Frame, Herdr, Notice};
use crate::requests;
use crate::tasks::{self, Card, Row};
use crate::watch::{self, StateChange};
use crate::workers::{self, Worker};

pub const DEFAULT_LABEL: &str = "firstmate.role=primary";
const DEFAULT_HOME_RELATIVE: &str = "Documents/firstmate";
const REFRESH_DEBOUNCE: Duration = Duration::from_millis(250);
const WORKERS_DEBOUNCE: Duration = Duration::from_millis(80);
const LAUNCH_LOG: &str = "launch.log";

pub const EVENT_BOARD: &str = "board://updated";
pub const EVENT_HERDR: &str = "herdr://status";
pub const EVENT_TERMINALS: &str = "herdr://terminals";
pub const EVENT_CHAT_ENDED: &str = "chat://ended";
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
    #[serde(flatten)]
    pub overlay: Overlay,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Overlay {
    pub places: Vec<CardPlace>,
    pub requests: Vec<MoveRequest>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Placement {
    pub card_id: String,
    pub title: String,
    pub project: String,
    pub from_row: Row,
    pub to_row: Row,
    pub order: Vec<String>,
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
    Ok(Settings {
        home: get(KEY_HOME, default_home()),
        terminal_label: get(KEY_LABEL, DEFAULT_LABEL.to_string()),
        hc_session: get(KEY_SESSION, String::new()),
        hc_socket: get(KEY_SOCKET, String::new()),
        chat_font: get(KEY_CHAT_FONT, DEFAULT_CHAT_FONT.to_string()),
        chat_font_size: size(KEY_CHAT_FONT_SIZE, DEFAULT_CHAT_FONT_SIZE),
        board_font: get(KEY_BOARD_FONT, DEFAULT_BOARD_FONT.to_string()),
        board_font_size: size(KEY_BOARD_FONT_SIZE, DEFAULT_BOARD_FONT_SIZE),
        chat_added_fonts: families(KEY_CHAT_ADDED_FONTS),
        board_added_fonts: families(KEY_BOARD_ADDED_FONTS),
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
            overlay: overlay_of(&db)?,
        })
    }

    pub fn overlay(&self) -> Result<Overlay, String> {
        overlay_of(&self.db.lock().unwrap())
    }

    pub fn read_board(&self) -> Result<BoardView, String> {
        let home = self.home();
        match tasks::read_board(&home) {
            Ok(cards) => {
                self.reconcile_requests(&home, &cards)?;
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

    pub fn restart_watcher(&self) {
        let home = self.home();
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
        let mut watchers = self.watchers.lock().unwrap();
        watchers.clear();
        for watcher in [task_list, state] {
            match watcher {
                Ok(watcher) => watchers.push(watcher),
                Err(error) => eprintln!("fathom: {error}"),
            }
        }
    }

    pub fn request_workers(&self) {
        let _ = self.workers_tick.send(());
    }

    pub fn workers(&self) -> Vec<Worker> {
        if !self.herdr_status.lock().unwrap().connected {
            return vec![];
        }
        let session = self.settings.lock().unwrap().hc_session.clone();
        workers::live_workers(
            &workers::read_bindings(&self.home()),
            &session,
            &self.herdr.terminals(),
        )
    }

    pub fn place_card(&self, placement: Placement) -> Result<Overlay, String> {
        let request = {
            let mut db = self.db.lock().unwrap();
            db.place_cards(
                &placement.card_id,
                &placement.project,
                placement.to_row,
                &placement.order,
            )?;
            if placement.from_row == placement.to_row {
                None
            } else {
                let created_ms = now_ms();
                let request = MoveRequest {
                    request_id: requests::request_id(&placement.card_id, created_ms),
                    card_id: placement.card_id,
                    title: placement.title,
                    from_row: placement.from_row,
                    to_row: placement.to_row,
                    created_ms,
                    status: MoveStatus::Sending,
                    note_id: None,
                    answer: None,
                    error: None,
                };
                db.add_request(&request)?;
                Some(request)
            }
        };
        if let Some(request) = request {
            self.send_request(&request)?;
        }
        self.overlay()
    }

    pub fn resend_request(&self, request_id: &str) -> Result<Overlay, String> {
        let request = self.db.lock().unwrap().request(request_id)?;
        match request {
            Some(request) if request.status == MoveStatus::Failed => self.send_request(&request)?,
            Some(_) => {}
            None => return Err(format!("no move request {request_id}")),
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

    fn send_request(&self, request: &MoveRequest) -> Result<(), String> {
        let body = requests::move_body(
            &request.card_id,
            &request.title,
            request.from_row,
            request.to_row,
        );
        let outcome = requests::send_note(&self.home(), &request.request_id, &body);
        self.db
            .lock()
            .unwrap()
            .finish_send(&request.request_id, &outcome)
    }

    fn reconcile_requests(&self, home: &Path, cards: &[Card]) -> Result<(), String> {
        let waiting: Vec<MoveRequest> = self
            .db
            .lock()
            .unwrap()
            .open_requests()?
            .into_iter()
            .filter(|r| matches!(r.status, MoveStatus::Asked | MoveStatus::Failed))
            .collect();
        if waiting.is_empty() {
            return Ok(());
        }
        let replies: HashMap<String, String> = if waiting.iter().any(|r| r.note_id.is_some()) {
            requests::replies(home).unwrap_or_else(|error| {
                eprintln!("fathom: cannot read Firstmate's replies: {error}");
                HashMap::new()
            })
        } else {
            HashMap::new()
        };
        let db = self.db.lock().unwrap();
        for request in waiting {
            match settle(&request, &replies, cards) {
                Some(Settlement::Answered(answer)) => {
                    db.answer_request(&request.request_id, &answer)?
                }
                Some(Settlement::Landed) => {
                    db.set_request_status(&request.request_id, MoveStatus::Landed)?
                }
                None => {}
            }
        }
        Ok(())
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
        cols: u16,
        rows: u16,
        channel: Channel<InvokeResponseBody>,
    ) -> Result<ChatSize, String> {
        self.herdr.attach(
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

#[derive(Debug, PartialEq)]
enum Settlement {
    Answered(String),
    Landed,
}

fn settle(
    request: &MoveRequest,
    replies: &HashMap<String, String>,
    cards: &[Card],
) -> Option<Settlement> {
    let answer = request.note_id.as_ref().and_then(|id| replies.get(id));
    if let Some(answer) = answer.filter(|_| request.status == MoveStatus::Asked) {
        return Some(Settlement::Answered(answer.clone()));
    }
    cards
        .iter()
        .any(|c| c.id == request.card_id && c.row == request.to_row)
        .then_some(Settlement::Landed)
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
        Notice::AttachEnded { terminal } => {
            let _ = app.emit(EVENT_CHAT_ENDED, terminal);
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

    fn card(id: &str, row: Row) -> Card {
        Card {
            id: id.into(),
            title: id.into(),
            state: String::new(),
            kind: String::new(),
            project: "reef".into(),
            row,
            hold_kind: String::new(),
            hold_until: String::new(),
            hold_reason: String::new(),
            blocked_by: vec![],
            links: vec![],
            closed: String::new(),
        }
    }

    fn asked(card_id: &str, to: Row, status: MoveStatus) -> MoveRequest {
        MoveRequest {
            request_id: format!("r-{card_id}"),
            card_id: card_id.into(),
            title: card_id.into(),
            from_row: Row::Seabed,
            to_row: to,
            created_ms: 1,
            status,
            note_id: (status == MoveStatus::Asked).then(|| format!("n-{card_id}")),
            answer: None,
            error: None,
        }
    }

    #[test]
    fn a_request_settles_on_a_reply_first_then_on_the_task_list() {
        let replies = HashMap::from([("n-a".to_string(), "Not yet.".to_string())]);
        let cards = [
            card("a", Row::Shallows),
            card("b", Row::Shallows),
            card("c", Row::Seabed),
        ];
        let settle_one = |r: MoveRequest| settle(&r, &replies, &cards);
        assert_eq!(
            settle_one(asked("a", Row::Shallows, MoveStatus::Asked)),
            Some(Settlement::Answered("Not yet.".into()))
        );
        assert_eq!(
            settle_one(asked("b", Row::Shallows, MoveStatus::Asked)),
            Some(Settlement::Landed)
        );
        assert_eq!(
            settle_one(asked("c", Row::Shallows, MoveStatus::Asked)),
            None
        );
        assert_eq!(
            settle_one(asked("b", Row::Shallows, MoveStatus::Failed)),
            Some(Settlement::Landed)
        );
        assert_eq!(
            settle_one(asked("missing", Row::Deep, MoveStatus::Asked)),
            None
        );
    }
}
