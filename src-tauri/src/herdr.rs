use std::collections::BTreeMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use portable_pty::{CommandBuilder, MasterPty, PtyPair, PtySize, native_pty_system};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::shell_path;

const PROGRAM: &str = "hc";
const AMBIENT_ENV: [&str; 5] = [
    "HC_TERMINAL_ID",
    "HC_TERMINAL_SOCKET",
    "HC_SCOPE",
    "HC_SESSION",
    "HC_SOCKET",
];
const ACTIVITY_EVENTS: [&str; 6] = [
    "created",
    "finished",
    "removed",
    "restarted",
    "status",
    "turn",
];
const WORKER_EVENTS: [&str; 7] = [
    "created",
    "finished",
    "lost",
    "removed",
    "restarted",
    "status",
    "turn",
];
const RECONNECT_DELAY: Duration = Duration::from_secs(2);
const ATTACH_READ_BUFFER: usize = 16 * 1024;
const PTY_ATTEMPTS: u32 = 4;
const PTY_RETRY_DELAY: Duration = Duration::from_millis(150);

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub session: String,
    pub socket: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Terminal {
    pub address: String,
    #[serde(default, deserialize_with = "or_default")]
    pub name: String,
    #[serde(default, deserialize_with = "or_default")]
    pub title: String,
    #[serde(default, deserialize_with = "or_default")]
    pub state: String,
    #[serde(default, deserialize_with = "status_field")]
    pub status: String,
    #[serde(default, deserialize_with = "or_default")]
    pub cwd: String,
    #[serde(default, deserialize_with = "or_default")]
    pub agent: String,
    #[serde(default, deserialize_with = "or_default")]
    pub labels: BTreeMap<String, String>,
    #[serde(default, deserialize_with = "or_default")]
    pub cols: u16,
    #[serde(default, deserialize_with = "or_default")]
    pub rows: u16,
}

fn or_default<'de, D, T>(deserializer: D) -> Result<T, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Default + serde::de::DeserializeOwned,
{
    Ok(serde_json::from_value(Value::deserialize(deserializer)?).unwrap_or_default())
}

fn status_field<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<String, D::Error> {
    Ok(status_of(&Value::deserialize(deserializer)?))
}

fn status_of(value: &Value) -> String {
    let state = value.get("state").unwrap_or(value);
    state.as_str().unwrap_or_default().to_string()
}

#[derive(Debug, Clone, PartialEq)]
pub enum Notice {
    EventsUp,
    EventsDown(String),
    Activity,
    TerminalsChanged,
    WorkersChanged,
    AttachEnded { terminal: String },
}

pub type Notify = Arc<dyn Fn(Notice) + Send + Sync>;

#[derive(Debug, PartialEq)]
pub enum Frame<'a> {
    Bytes(&'a [u8]),
    Size { cols: u16, rows: u16 },
}

pub type Output = Box<dyn FnMut(Frame) + Send>;

type Size = (u16, u16);

struct Attachment {
    id: u64,
    terminal: String,
    size: Size,
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

impl Attachment {
    fn end(mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[derive(Default)]
struct Sink {
    id: u64,
    output: Option<Output>,
}

struct Chat {
    attachment: Mutex<Option<Attachment>>,
    sink: Mutex<Sink>,
    ids: AtomicU64,
    notify: Notify,
}

pub struct Herdr {
    connection: Mutex<Connection>,
    terminals: Arc<Mutex<BTreeMap<String, Terminal>>>,
    events_child: Arc<Mutex<Option<Child>>>,
    generation: Arc<AtomicU64>,
    chat: Arc<Chat>,
    notify: Notify,
}

impl Herdr {
    pub fn new(connection: Connection, notify: Notify) -> Herdr {
        Herdr {
            connection: Mutex::new(connection),
            terminals: Arc::default(),
            events_child: Arc::default(),
            generation: Arc::default(),
            chat: Arc::new(Chat {
                attachment: Mutex::default(),
                sink: Mutex::default(),
                ids: AtomicU64::new(1),
                notify: Arc::clone(&notify),
            }),
            notify,
        }
    }

    pub fn connection(&self) -> Connection {
        self.connection.lock().unwrap().clone()
    }

    pub fn set_connection(&self, connection: Connection) {
        *self.connection.lock().unwrap() = connection;
        self.detach();
        self.start_events();
    }

    pub fn terminals(&self) -> BTreeMap<String, Terminal> {
        self.terminals.lock().unwrap().clone()
    }

    pub fn list(&self) -> Result<Vec<Terminal>, String> {
        let output = self.run(&["ls", "--json"])?;
        parse_terminals(&output)
    }

    pub fn find_by_label(&self, label: &str) -> Result<Option<Terminal>, String> {
        let label = label.trim();
        if !label.contains('=') {
            return Err(format!(
                "the terminal label must look like key=value, got \"{label}\""
            ));
        }
        let output = self.run(&["ls", "--json", "--label", label])?;
        Ok(parse_terminals(&output)?.into_iter().next())
    }

    pub fn send(&self, terminal: &str, text: &str) -> Result<(), String> {
        self.run(&["send", terminal, text]).map(|_| ())
    }

    pub fn start_events(&self) {
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        if let Some(mut old) = self.events_child.lock().unwrap().take() {
            let _ = old.kill();
            let _ = old.wait();
        }
        let current = Arc::clone(&self.generation);
        let child_slot = Arc::clone(&self.events_child);
        let terminals = Arc::clone(&self.terminals);
        let chat = Arc::clone(&self.chat);
        let notify = Arc::clone(&self.notify);
        let connection = self.connection();
        std::thread::spawn(move || {
            while current.load(Ordering::SeqCst) == generation {
                let outcome = stream_events(&connection, &child_slot, &terminals, &chat, &notify);
                if current.load(Ordering::SeqCst) != generation {
                    break;
                }
                notify(Notice::EventsDown(
                    outcome.err().unwrap_or_else(|| "event stream ended".into()),
                ));
                std::thread::sleep(RECONNECT_DELAY);
            }
        });
    }

    pub fn stop_events(&self) {
        self.generation.fetch_add(1, Ordering::SeqCst);
        if let Some(mut child) = self.events_child.lock().unwrap().take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    pub fn attach(
        &self,
        terminal: &str,
        cols: u16,
        rows: u16,
        output: Output,
    ) -> Result<(), String> {
        self.chat
            .attach(&self.connection(), terminal, (cols, rows), output)
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        self.chat.resize((cols, rows))
    }

    pub fn write_input(&self, bytes: &[u8]) -> Result<(), String> {
        self.chat.write_input(bytes)
    }

    pub fn detach(&self) {
        self.chat.detach();
    }

    fn run(&self, args: &[&str]) -> Result<String, String> {
        run_hc(&self.connection(), args)
    }
}

impl Chat {
    fn attach(
        self: &Arc<Self>,
        connection: &Connection,
        terminal: &str,
        size: Size,
        output: Output,
    ) -> Result<(), String> {
        self.detach();
        let id = self.ids.fetch_add(1, Ordering::SeqCst);
        *self.sink.lock().unwrap() = Sink {
            id,
            output: Some(output),
        };
        let (attachment, reader) = spawn_attach(connection, id, terminal, size)?;
        *self.attachment.lock().unwrap() = Some(attachment);
        self.read(id, terminal, reader);
        Ok(())
    }

    fn follow_size(self: &Arc<Self>, connection: &Connection, terminal: &str, announced: Size) {
        let attached = match self.attachment.lock().unwrap().as_ref() {
            Some(a) if a.terminal == terminal => a.size,
            _ => return,
        };
        if attached == announced {
            return;
        }
        let Ok(core) = core_size(connection, terminal) else {
            return;
        };
        let mut slot = self.attachment.lock().unwrap();
        if !slot
            .as_ref()
            .is_some_and(|a| a.terminal == terminal && a.size != core)
        {
            return;
        }
        let id = self.ids.fetch_add(1, Ordering::SeqCst);
        let previous = self.switch_sink(id, core);
        match spawn_attach(connection, id, terminal, core) {
            Ok((fresh, reader)) => {
                let old = slot.replace(fresh);
                drop(slot);
                if let Some(old) = old {
                    old.end();
                }
                self.read(id, terminal, reader);
            }
            Err(error) => {
                self.sink.lock().unwrap().id = previous;
                eprintln!("fathom: cannot reattach at the new size: {error}");
            }
        }
    }

    fn switch_sink(&self, id: u64, (cols, rows): Size) -> u64 {
        let mut sink = self.sink.lock().unwrap();
        let previous = std::mem::replace(&mut sink.id, id);
        if let Some(output) = sink.output.as_mut() {
            output(Frame::Size { cols, rows });
        }
        previous
    }

    fn read(self: &Arc<Self>, id: u64, terminal: &str, mut reader: Box<dyn Read + Send>) {
        let chat = Arc::clone(self);
        let terminal = terminal.to_string();
        std::thread::spawn(move || {
            let mut buffer = vec![0u8; ATTACH_READ_BUFFER];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => chat.emit(id, &buffer[..n]),
                }
            }
            let ended = {
                let mut slot = chat.attachment.lock().unwrap();
                if slot.as_ref().is_some_and(|a| a.id == id) {
                    slot.take()
                } else {
                    None
                }
            };
            if let Some(ended) = ended {
                ended.end();
                (chat.notify)(Notice::AttachEnded { terminal });
            }
        });
    }

    fn emit(&self, id: u64, bytes: &[u8]) {
        let mut sink = self.sink.lock().unwrap();
        if sink.id == id
            && let Some(output) = sink.output.as_mut()
        {
            output(Frame::Bytes(bytes));
        }
    }

    fn resize(&self, size: Size) -> Result<(), String> {
        let mut slot = self.attachment.lock().unwrap();
        let attachment = slot.as_mut().ok_or("the chat panel is not attached")?;
        attachment
            .master
            .resize(pty_size(size))
            .map_err(|e| e.to_string())?;
        attachment.size = size;
        Ok(())
    }

    fn write_input(&self, bytes: &[u8]) -> Result<(), String> {
        let mut slot = self.attachment.lock().unwrap();
        let attachment = slot.as_mut().ok_or("the chat panel is not attached")?;
        attachment
            .writer
            .write_all(bytes)
            .and_then(|_| attachment.writer.flush())
            .map_err(|e| e.to_string())
    }

    fn detach(&self) {
        let attachment = self.attachment.lock().unwrap().take();
        *self.sink.lock().unwrap() = Sink::default();
        if let Some(attachment) = attachment {
            attachment.end();
        }
    }
}

fn spawn_attach(
    connection: &Connection,
    id: u64,
    terminal: &str,
    size: Size,
) -> Result<(Attachment, Box<dyn Read + Send>), String> {
    let pty = open_pty(size)?;
    let mut builder = CommandBuilder::new(program()?);
    builder.args(["attach", terminal]);
    for (key, value) in connection_env(connection) {
        match value {
            Some(value) => builder.env(key, value),
            None => builder.env_remove(key),
        }
    }
    builder.env("TERM", "xterm-256color");
    let child = pty
        .slave
        .spawn_command(builder)
        .map_err(|e| format!("cannot start hc attach: {e}"))?;
    drop(pty.slave);
    let reader = pty.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pty.master.take_writer().map_err(|e| e.to_string())?;
    let attachment = Attachment {
        id,
        terminal: terminal.to_string(),
        size,
        master: pty.master,
        writer,
        child,
    };
    Ok((attachment, reader))
}

fn core_size(connection: &Connection, terminal: &str) -> Result<Size, String> {
    let output = run_hc(connection, &["get", terminal, "--json"])?;
    let value: Value =
        serde_json::from_str(&output).map_err(|e| format!("unexpected hc output: {e}"))?;
    dimensions(&value).ok_or_else(|| "hc get has no size".to_string())
}

fn dimensions(value: &Value) -> Option<Size> {
    let dimension = |key| {
        value
            .get(key)
            .and_then(Value::as_u64)
            .and_then(|v| u16::try_from(v).ok())
    };
    Some((dimension("cols")?, dimension("rows")?))
}

fn run_hc(connection: &Connection, args: &[&str]) -> Result<String, String> {
    let mut command = Command::new(program()?);
    command.args(args).stdin(Stdio::null());
    apply_env(&mut command, connection);
    let output = command
        .output()
        .map_err(|e| format!("cannot run hc: {e}"))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Err(if stderr.is_empty() { stdout } else { stderr })
    }
}

impl Drop for Herdr {
    fn drop(&mut self) {
        self.stop_events();
        self.detach();
    }
}

fn open_pty(size: Size) -> Result<PtyPair, String> {
    let size = pty_size(size);
    let mut attempt = 1;
    loop {
        match native_pty_system().openpty(size) {
            Ok(pair) => return Ok(pair),
            Err(_) if attempt < PTY_ATTEMPTS => {
                attempt += 1;
                std::thread::sleep(PTY_RETRY_DELAY);
            }
            Err(e) => return Err(format!("cannot open a pty: {e}")),
        }
    }
}

fn pty_size((cols, rows): Size) -> PtySize {
    PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    }
}

fn program() -> Result<std::path::PathBuf, String> {
    shell_path::find(PROGRAM).ok_or_else(|| "hc (herdr-core) is not on PATH".to_string())
}

fn connection_env(connection: &Connection) -> Vec<(&'static str, Option<String>)> {
    let mut env: Vec<(&'static str, Option<String>)> =
        AMBIENT_ENV.iter().map(|k| (*k, None)).collect();
    if !connection.session.trim().is_empty() {
        env.push(("HC_SESSION", Some(connection.session.trim().to_string())));
    }
    if !connection.socket.trim().is_empty() {
        env.push(("HC_SOCKET", Some(connection.socket.trim().to_string())));
    }
    env.push(("PATH", Some(shell_path::get().to_string())));
    env
}

fn apply_env(command: &mut Command, connection: &Connection) {
    for (key, value) in connection_env(connection) {
        match value {
            Some(value) => command.env(key, value),
            None => command.env_remove(key),
        };
    }
}

fn parse_terminals(json: &str) -> Result<Vec<Terminal>, String> {
    let value: Value =
        serde_json::from_str(json).map_err(|e| format!("unexpected hc output: {e}"))?;
    let list = value
        .get("terminals")
        .cloned()
        .unwrap_or(Value::Array(vec![]));
    serde_json::from_value(list).map_err(|e| format!("unexpected hc terminal list: {e}"))
}

fn stream_events(
    connection: &Connection,
    child_slot: &Mutex<Option<Child>>,
    terminals: &Mutex<BTreeMap<String, Terminal>>,
    chat: &Arc<Chat>,
    notify: &Notify,
) -> Result<(), String> {
    let mut command = Command::new(program()?);
    command
        .args(["events", "--json"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    apply_env(&mut command, connection);
    let mut child = command
        .spawn()
        .map_err(|e| format!("cannot run hc events: {e}"))?;
    let stdout = child.stdout.take().ok_or("hc events has no output")?;
    *child_slot.lock().unwrap() = Some(child);
    for line in BufReader::new(stdout).lines() {
        let Ok(line) = line else { break };
        let Ok(message) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        for notice in apply_event(&mut terminals.lock().unwrap(), &message) {
            notify(notice);
        }
        if let Some((terminal, size)) = size_change(&message) {
            chat.follow_size(connection, &terminal, size);
        }
    }
    if let Some(mut child) = child_slot.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    Ok(())
}

fn size_change(message: &Value) -> Option<(String, Size)> {
    let params = message.get("params")?;
    if params.get("type")?.as_str()? != "size" {
        return None;
    }
    let terminal = params.get("terminal")?.as_str()?.to_string();
    Some((terminal, dimensions(params.get("data")?)?))
}

pub fn apply_event(terminals: &mut BTreeMap<String, Terminal>, message: &Value) -> Vec<Notice> {
    if let Some(list) = message.get("terminals") {
        let fresh: Vec<Terminal> = serde_json::from_value(list.clone()).unwrap_or_default();
        terminals.clear();
        terminals.extend(fresh.into_iter().map(|t| (t.address.clone(), t)));
        return vec![
            Notice::EventsUp,
            Notice::TerminalsChanged,
            Notice::WorkersChanged,
            Notice::Activity,
        ];
    }
    let Some(params) = message.get("params") else {
        return vec![];
    };
    let kind = params
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let address = params
        .get("terminal")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let data = params.get("data").cloned().unwrap_or(Value::Null);
    let mut notices = Vec::new();
    match kind {
        "size" => {
            if let (Some((cols, rows)), Some(t)) = (dimensions(&data), terminals.get_mut(&address))
            {
                t.cols = cols;
                t.rows = rows;
            }
        }
        "labels" => {
            let labels = data
                .get("labels")
                .cloned()
                .map(serde_json::from_value)
                .and_then(Result::ok)
                .unwrap_or_default();
            if let Some(t) = terminals.get_mut(&address) {
                t.labels = labels;
            }
            notices.push(Notice::TerminalsChanged);
        }
        "title" => {
            if let Some(t) = terminals.get_mut(&address) {
                t.title = data
                    .get("title")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
            }
        }
        "created" => {
            let source = data.get("terminal").cloned().unwrap_or(data);
            if let Ok(mut terminal) = serde_json::from_value::<Terminal>(source) {
                if terminal.address.is_empty() {
                    terminal.address = address.clone();
                }
                terminals.insert(terminal.address.clone(), terminal);
            }
            notices.push(Notice::TerminalsChanged);
        }
        "removed" => {
            terminals.remove(&address);
            notices.push(Notice::TerminalsChanged);
        }
        "finished" | "lost" => {
            if let Some(t) = terminals.get_mut(&address) {
                t.state = kind.to_string();
            }
            notices.push(Notice::TerminalsChanged);
        }
        "status" | "turn" => {
            if let Some(t) = terminals.get_mut(&address) {
                t.status = status_of(data.get("status").unwrap_or(&data));
            }
        }
        _ => {}
    }
    if WORKER_EVENTS.contains(&kind) {
        notices.push(Notice::WorkersChanged);
    }
    if ACTIVITY_EVENTS.contains(&kind) {
        notices.push(Notice::Activity);
    }
    notices
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn snapshot() -> Value {
        json!({"channel": null, "seq": 3, "terminals": [
            {"address": "t1", "name": "lead", "cols": 200, "rows": 120, "labels": {"role": "lead"}, "state": "live", "extra": 1}
        ]})
    }

    fn event(kind: &str, data: Value) -> Value {
        json!({"jsonrpc": "2.0", "method": "event", "params": {"data": data, "seq": 4, "terminal": "t1", "type": kind}})
    }

    #[test]
    fn snapshot_replaces_terminals() {
        let mut terminals = BTreeMap::new();
        let notices = apply_event(&mut terminals, &snapshot());
        assert_eq!(
            notices,
            vec![
                Notice::EventsUp,
                Notice::TerminalsChanged,
                Notice::WorkersChanged,
                Notice::Activity
            ]
        );
        assert_eq!(terminals["t1"].cols, 200);
        assert_eq!(terminals["t1"].labels["role"], "lead");
    }

    #[test]
    fn size_events_update_the_terminal_and_read_as_a_size_change() {
        let mut terminals = BTreeMap::new();
        apply_event(&mut terminals, &snapshot());
        let resize = event("size", json!({"cols": 111, "rows": 33}));
        assert!(apply_event(&mut terminals, &resize).is_empty());
        assert_eq!((terminals["t1"].cols, terminals["t1"].rows), (111, 33));
        assert_eq!(size_change(&resize), Some(("t1".into(), (111, 33))));
        assert_eq!(size_change(&event("turn", json!({"turn": 2}))), None);
    }

    #[test]
    fn activity_events_trigger_a_board_read() {
        let mut terminals = BTreeMap::new();
        apply_event(&mut terminals, &snapshot());
        assert_eq!(
            apply_event(&mut terminals, &event("turn", json!({"turn": 2}))),
            vec![Notice::WorkersChanged, Notice::Activity]
        );
        assert!(apply_event(&mut terminals, &event("heartbeat", json!({}))).is_empty());
        let removed = apply_event(&mut terminals, &event("removed", json!({})));
        assert_eq!(
            removed,
            vec![
                Notice::TerminalsChanged,
                Notice::WorkersChanged,
                Notice::Activity
            ]
        );
        assert!(terminals.is_empty());
    }

    #[test]
    fn agent_status_follows_the_snapshot_status_and_turn_events() {
        let mut terminals = BTreeMap::new();
        apply_event(
            &mut terminals,
            &json!({"channel": null, "seq": 1, "terminals": [
                {"address": "t1", "name": null, "title": "", "state": "live", "labels": {},
                 "status": {"app": "lab", "kind": "permission", "state": "blocked"}},
                {"address": "t2", "name": null, "state": "live", "status": null}
            ]}),
        );
        assert_eq!(terminals["t1"].status, "blocked");
        assert_eq!(terminals["t1"].name, "");
        assert_eq!(terminals["t2"].status, "");

        let working = event(
            "status",
            json!({"records": {}, "reported": true, "status": {"app": "lab", "state": "working"}}),
        );
        assert_eq!(
            apply_event(&mut terminals, &working),
            vec![Notice::WorkersChanged, Notice::Activity]
        );
        assert_eq!(terminals["t1"].status, "working");

        apply_event(
            &mut terminals,
            &event("turn", json!({"state": "idle", "turn": 3})),
        );
        assert_eq!(terminals["t1"].status, "idle");

        let cleared = event(
            "status",
            json!({"records": {}, "reported": false, "status": null}),
        );
        apply_event(&mut terminals, &cleared);
        assert_eq!(terminals["t1"].status, "");
    }

    #[test]
    fn hc_ls_reports_status_as_a_plain_string() {
        let json = r#"{"terminals":[{"address":"t1","agent":"lab","state":"live","status":"working","turn":1}]}"#;
        assert_eq!(parse_terminals(json).unwrap()[0].status, "working");
    }

    #[test]
    fn env_clears_ambient_scope_and_sets_the_chosen_connection() {
        let env = connection_env(&Connection {
            session: "lab".into(),
            socket: String::new(),
        });
        assert!(env.contains(&("HC_TERMINAL_ID", None)));
        assert!(env.contains(&("HC_SESSION", Some("lab".into()))));
        assert!(!env.iter().any(|(k, v)| *k == "HC_SOCKET" && v.is_some()));
    }

    #[test]
    fn terminal_list_parses_hc_ls() {
        let json = r#"{"hidden_finished":0,"terminals":[{"address":"t1","agent":"sh","cwd":"/w","name":"probe","state":"live","turn":0}]}"#;
        let list = parse_terminals(json).unwrap();
        assert_eq!(list[0].name, "probe");
        assert_eq!(list[0].agent, "sh");
    }

    fn wait_for(what: &str, mut check: impl FnMut() -> bool) {
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        while !check() {
            assert!(
                std::time::Instant::now() < deadline,
                "timed out waiting for {what}"
            );
            std::thread::sleep(Duration::from_millis(100));
        }
    }

    fn known_size(herdr: &Herdr, terminal: &str) -> Option<Size> {
        herdr
            .terminals
            .lock()
            .unwrap()
            .get(terminal)
            .map(|t| (t.cols, t.rows))
    }

    #[derive(Default)]
    struct Screen {
        bytes: Vec<u8>,
        sizes: Vec<Size>,
    }

    fn screen_sink() -> (Arc<Mutex<Screen>>, Output) {
        let screen = Arc::new(Mutex::new(Screen::default()));
        let sink = Arc::clone(&screen);
        (
            screen,
            Box::new(move |frame| {
                let mut screen = sink.lock().unwrap();
                match frame {
                    Frame::Bytes(bytes) => screen.bytes.extend_from_slice(bytes),
                    Frame::Size { cols, rows } => {
                        screen.bytes.clear();
                        screen.sizes.push((cols, rows));
                    }
                }
            }),
        )
    }

    #[test]
    #[ignore = "needs FATHOM_LAB_SESSION and FATHOM_LAB_SOCKET pointing at a throwaway herdr-core session"]
    fn sizes_types_and_sends_into_a_lab_terminal() {
        let connection = Connection {
            session: std::env::var("FATHOM_LAB_SESSION").expect("FATHOM_LAB_SESSION"),
            socket: std::env::var("FATHOM_LAB_SOCKET").expect("FATHOM_LAB_SOCKET"),
        };
        let label = std::env::var("FATHOM_LAB_LABEL").unwrap_or("firstmate.role=primary".into());
        let herdr = Herdr::new(connection.clone(), Arc::new(|_| {}));
        herdr.start_events();
        let terminal = herdr
            .find_by_label(&label)
            .unwrap()
            .expect("a labeled terminal")
            .address;
        wait_for("the event snapshot", || {
            known_size(&herdr, &terminal).is_some()
        });

        let (screen, sink) = screen_sink();
        herdr.attach(&terminal, 101, 37, sink).unwrap();
        wait_for("the attach size", || {
            known_size(&herdr, &terminal) == Some((101, 37))
        });
        let seen =
            |text: &str| String::from_utf8_lossy(&screen.lock().unwrap().bytes).contains(text);

        herdr.write_input(b"typed-in-fathom\r").unwrap();
        wait_for("the typed line to arrive", || seen("GOT:typed-in-fathom"));

        let message = "Lab card (lab-1): sent-from-fathom";
        herdr.send(&terminal, message).unwrap();
        wait_for("the sent message", || seen(&format!("GOT:{message}")));

        herdr.resize(117, 41).unwrap();
        wait_for("the panel resize", || {
            known_size(&herdr, &terminal) == Some((117, 41))
        });

        let other = Herdr::new(connection, Arc::new(|_| {}));
        let (_, other_sink) = screen_sink();
        other.attach(&terminal, 90, 30, other_sink).unwrap();
        wait_for("the other client's attach size", || {
            known_size(&herdr, &terminal) == Some((90, 30))
        });
        wait_for("Fathom to reattach at the other client's size", || {
            screen.lock().unwrap().sizes.last() == Some(&(90, 30))
        });
        herdr.write_input(b"after-reattach\r").unwrap();
        wait_for("typing through the new attach", || {
            seen("GOT:after-reattach")
        });
        assert_eq!(known_size(&herdr, &terminal), Some((90, 30)));

        herdr.resize(117, 41).unwrap();
        wait_for("Fathom to take the size back", || {
            known_size(&herdr, &terminal) == Some((117, 41))
        });
        other.write_input(b"\r").unwrap();
        wait_for("typing in the other client to take it back", || {
            known_size(&herdr, &terminal) == Some((90, 30))
        });
        wait_for("Fathom to follow again", || {
            screen.lock().unwrap().sizes.last() == Some(&(90, 30))
                && screen.lock().unwrap().sizes.len() == 2
        });

        other.detach();
        herdr.detach();
        herdr.stop_events();
    }
}
