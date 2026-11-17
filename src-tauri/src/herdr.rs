use std::collections::BTreeMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use portable_pty::{CommandBuilder, MasterPty, PtySize, native_pty_system};
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
const FALLBACK_SIZE: (u16, u16) = (120, 40);
const RECONNECT_DELAY: Duration = Duration::from_secs(2);
const ATTACH_READ_BUFFER: usize = 16 * 1024;

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
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub cwd: String,
    #[serde(default)]
    pub agent: String,
    #[serde(default)]
    pub labels: BTreeMap<String, String>,
    #[serde(default)]
    pub cols: u16,
    #[serde(default)]
    pub rows: u16,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Notice {
    EventsUp,
    EventsDown(String),
    Activity,
    TerminalsChanged,
    Resized {
        terminal: String,
        cols: u16,
        rows: u16,
    },
    AttachEnded {
        terminal: String,
    },
}

pub type Notify = Arc<dyn Fn(Notice) + Send + Sync>;
pub type Output = Box<dyn FnMut(&[u8]) + Send>;

struct Attachment {
    id: u64,
    terminal: String,
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

pub struct Herdr {
    connection: Mutex<Connection>,
    terminals: Arc<Mutex<BTreeMap<String, Terminal>>>,
    events_child: Arc<Mutex<Option<Child>>>,
    generation: Arc<AtomicU64>,
    attachment: Arc<Mutex<Option<Attachment>>>,
    attach_ids: AtomicU64,
    notify: Notify,
}

impl Herdr {
    pub fn new(connection: Connection, notify: Notify) -> Herdr {
        Herdr {
            connection: Mutex::new(connection),
            terminals: Arc::default(),
            events_child: Arc::default(),
            generation: Arc::default(),
            attachment: Arc::default(),
            attach_ids: AtomicU64::new(1),
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

    pub fn terminal_size(&self, terminal: &str) -> Option<(u16, u16)> {
        let terminals = self.terminals.lock().unwrap();
        terminals
            .values()
            .find(|t| t.address == terminal || t.name == terminal)
            .filter(|t| t.cols > 0 && t.rows > 0)
            .map(|t| (t.cols, t.rows))
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
        let attachment = Arc::clone(&self.attachment);
        let notify = Arc::clone(&self.notify);
        let connection = self.connection();
        std::thread::spawn(move || {
            while current.load(Ordering::SeqCst) == generation {
                let outcome =
                    stream_events(&connection, &child_slot, &terminals, &attachment, &notify);
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

    pub fn attach(&self, terminal: &str, mut output: Output) -> Result<(u16, u16), String> {
        self.detach();
        let (cols, rows) = self.terminal_size(terminal).unwrap_or(FALLBACK_SIZE);
        let pty = native_pty_system()
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("cannot open a pty: {e}"))?;
        let mut builder = CommandBuilder::new(program()?);
        builder.args(["attach", terminal]);
        for (key, value) in self.env() {
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
        let mut reader = pty.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = pty.master.take_writer().map_err(|e| e.to_string())?;
        let id = self.attach_ids.fetch_add(1, Ordering::SeqCst);
        *self.attachment.lock().unwrap() = Some(Attachment {
            id,
            terminal: terminal.to_string(),
            master: pty.master,
            writer,
            child,
        });

        let attachment = Arc::clone(&self.attachment);
        let notify = Arc::clone(&self.notify);
        let terminal = terminal.to_string();
        std::thread::spawn(move || {
            let mut buffer = vec![0u8; ATTACH_READ_BUFFER];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => output(&buffer[..n]),
                }
            }
            let mut slot = attachment.lock().unwrap();
            if slot.as_ref().is_some_and(|a| a.id == id) {
                if let Some(mut ended) = slot.take() {
                    let _ = ended.child.wait();
                }
                drop(slot);
                notify(Notice::AttachEnded { terminal });
            }
        });
        Ok((cols, rows))
    }

    pub fn write_input(&self, bytes: &[u8]) -> Result<(), String> {
        let mut slot = self.attachment.lock().unwrap();
        let attachment = slot.as_mut().ok_or("the chat panel is not attached")?;
        attachment
            .writer
            .write_all(bytes)
            .and_then(|_| attachment.writer.flush())
            .map_err(|e| e.to_string())
    }

    pub fn detach(&self) {
        if let Some(mut attachment) = self.attachment.lock().unwrap().take() {
            let _ = attachment.child.kill();
            let _ = attachment.child.wait();
        }
    }

    fn env(&self) -> Vec<(&'static str, Option<String>)> {
        connection_env(&self.connection())
    }

    fn run(&self, args: &[&str]) -> Result<String, String> {
        let mut command = Command::new(program()?);
        command.args(args).stdin(Stdio::null());
        apply_env(&mut command, &self.connection());
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
}

impl Drop for Herdr {
    fn drop(&mut self) {
        self.stop_events();
        self.detach();
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
    attachment: &Mutex<Option<Attachment>>,
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
            if let Notice::Resized {
                terminal,
                cols,
                rows,
            } = &notice
            {
                resize_attachment(attachment, terminal, *cols, *rows);
            }
            notify(notice);
        }
    }
    if let Some(mut child) = child_slot.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    Ok(())
}

fn resize_attachment(attachment: &Mutex<Option<Attachment>>, terminal: &str, cols: u16, rows: u16) {
    if let Some(attached) = attachment
        .lock()
        .unwrap()
        .as_ref()
        .filter(|a| a.terminal == terminal)
    {
        let _ = attached.master.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        });
    }
}

pub fn apply_event(terminals: &mut BTreeMap<String, Terminal>, message: &Value) -> Vec<Notice> {
    if let Some(list) = message.get("terminals") {
        let fresh: Vec<Terminal> = serde_json::from_value(list.clone()).unwrap_or_default();
        terminals.clear();
        terminals.extend(fresh.into_iter().map(|t| (t.address.clone(), t)));
        return vec![Notice::EventsUp, Notice::TerminalsChanged, Notice::Activity];
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
            let cols = data.get("cols").and_then(Value::as_u64).unwrap_or(0) as u16;
            let rows = data.get("rows").and_then(Value::as_u64).unwrap_or(0) as u16;
            if let Some(t) = terminals.get_mut(&address) {
                t.cols = cols;
                t.rows = rows;
            }
            notices.push(Notice::Resized {
                terminal: address.clone(),
                cols,
                rows,
            });
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
        _ => {}
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
            vec![Notice::EventsUp, Notice::TerminalsChanged, Notice::Activity]
        );
        assert_eq!(terminals["t1"].cols, 200);
        assert_eq!(terminals["t1"].labels["role"], "lead");
    }

    #[test]
    fn size_events_update_and_announce() {
        let mut terminals = BTreeMap::new();
        apply_event(&mut terminals, &snapshot());
        let notices = apply_event(
            &mut terminals,
            &event("size", json!({"cols": 111, "rows": 33})),
        );
        assert_eq!(
            notices,
            vec![Notice::Resized {
                terminal: "t1".into(),
                cols: 111,
                rows: 33
            }]
        );
        assert_eq!((terminals["t1"].cols, terminals["t1"].rows), (111, 33));
    }

    #[test]
    fn activity_events_trigger_a_board_read() {
        let mut terminals = BTreeMap::new();
        apply_event(&mut terminals, &snapshot());
        assert_eq!(
            apply_event(&mut terminals, &event("turn", json!({"turn": 2}))),
            vec![Notice::Activity]
        );
        assert!(apply_event(&mut terminals, &event("heartbeat", json!({}))).is_empty());
        let removed = apply_event(&mut terminals, &event("removed", json!({})));
        assert_eq!(removed, vec![Notice::TerminalsChanged, Notice::Activity]);
        assert!(terminals.is_empty());
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
}
