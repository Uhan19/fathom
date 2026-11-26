use std::collections::HashMap;
use std::io::Write;
use std::path::Path;
use std::process::Stdio;

use serde::{Deserialize, Serialize};

use crate::source::Source;
use crate::tasks::{Row, firstmate_command};
use crate::workers::Worker;

const INBOX_SCRIPT: &str = "bin/fm-inbox.sh";
const REQUEST_ID_PREFIX: &str = "fathom-move";
const STOP_ID_PREFIX: &str = "fathom-stop";
const REQUEST_ID_LIMIT: usize = 128;

#[derive(Deserialize)]
struct NoteResult {
    id: Option<String>,
    #[serde(default)]
    saved: bool,
}

#[derive(Deserialize)]
struct Receipts {
    #[serde(default)]
    replies: Vec<Reply>,
}

#[derive(Deserialize)]
struct Reply {
    id: String,
    #[serde(default)]
    body: String,
}

pub fn request_id(card_id: &str, now_ms: i64) -> String {
    prefixed_id(REQUEST_ID_PREFIX, card_id, now_ms)
}

pub fn stop_request_id(task_id: &str, now_ms: i64) -> String {
    prefixed_id(STOP_ID_PREFIX, task_id, now_ms)
}

fn prefixed_id(prefix: &str, card_id: &str, now_ms: i64) -> String {
    let suffix = format!("-{now_ms}");
    let room = REQUEST_ID_LIMIT - prefix.len() - 1 - suffix.len();
    let card: String = card_id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || "._:-".contains(c) {
                c
            } else {
                '-'
            }
        })
        .take(room)
        .collect();
    format!("{prefix}-{card}{suffix}")
}

pub fn move_body(card_id: &str, title: &str, from: Row, to: Row) -> String {
    let title = title.split_whitespace().collect::<Vec<_>>().join(" ");
    format!(
        "Fathom board request: move {card_id} \"{title}\" from {} to {}",
        from.key(),
        to.key()
    )
}

pub fn stop_body(task_id: &str, title: &str) -> String {
    let title = title.split_whitespace().collect::<Vec<_>>().join(" ");
    format!(
        "Fathom board request: stop the worker on {task_id} \"{title}\" to free its memory. \
         Its agent has been idle past its prompt cache. \
         Keep the task where it is on the board, so it can start again later."
    )
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum StopOutcome {
    Asked {
        #[serde(rename = "noteId")]
        note_id: String,
    },
    Stopped,
}

pub fn stop_worker(
    source: &Source,
    worker: &Worker,
    title: &str,
    now_ms: i64,
    kill: impl FnOnce(&str) -> Result<(), String>,
) -> Result<StopOutcome, String> {
    match source {
        Source::Firstmate { home } => {
            let request_id = stop_request_id(&worker.task_id, now_ms);
            let body = stop_body(&worker.task_id, title);
            let note_id = send_note(home, &request_id, &body)?;
            Ok(StopOutcome::Asked { note_id })
        }
        Source::Backlog => {
            kill(&worker.terminal)?;
            Ok(StopOutcome::Stopped)
        }
    }
}

pub fn send_note(home: &Path, request_id: &str, body: &str) -> Result<String, String> {
    let mut child = firstmate_command(home, INBOX_SCRIPT)?
        .args(["note", "--request-id", request_id, "--json", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("cannot run {INBOX_SCRIPT}: {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        match stdin.write_all(body.as_bytes()) {
            Err(e) if e.kind() != std::io::ErrorKind::BrokenPipe => {
                return Err(format!("cannot write the request: {e}"));
            }
            _ => {}
        }
    }
    let output = child.wait_with_output().map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    match serde_json::from_str::<NoteResult>(stdout.trim()) {
        Ok(NoteResult {
            id: Some(id),
            saved: true,
        }) => Ok(id),
        _ => Err(failure(
            &output.stderr,
            &stdout,
            "Firstmate did not save the request",
        )),
    }
}

pub fn replies(home: &Path) -> Result<HashMap<String, String>, String> {
    let output = firstmate_command(home, INBOX_SCRIPT)?
        .args(["receipts", "--all-replies"])
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("cannot run {INBOX_SCRIPT}: {e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    if !output.status.success() {
        return Err(failure(&output.stderr, &stdout, "receipts failed"));
    }
    let receipts: Receipts = serde_json::from_str(stdout.trim())
        .map_err(|e| format!("unexpected receipts output: {e}"))?;
    Ok(receipts
        .replies
        .into_iter()
        .map(|r| (r.id, r.body.trim().to_string()))
        .collect())
}

fn failure(stderr: &[u8], stdout: &str, fallback: &str) -> String {
    let stderr = String::from_utf8_lossy(stderr).trim().to_string();
    [stderr, stdout.trim().to_string()]
        .into_iter()
        .find(|s| !s.is_empty())
        .unwrap_or_else(|| fallback.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::write_script;

    fn worker() -> Worker {
        Worker {
            task_id: "atl-12".into(),
            terminal: "t7".into(),
            status: crate::workers::WorkerStatus::Idle,
        }
    }

    #[test]
    fn on_a_firstmate_home_stop_asks_firstmate_and_ends_nothing_itself() {
        let home = tempfile::tempdir().unwrap();
        let bin = home.path().join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        write_script(
            &bin.join("fm-inbox.sh"),
            r#"#!/bin/sh
printf '%s\n' "$@" > "$(dirname "$0")/args"
cat > "$(dirname "$0")/body"
echo '{"schema":"fm-inbox-note.v1","outcome":"created","id":"n-9","saved":true,"announced":true}'
"#,
        );
        let source = Source::Firstmate {
            home: home.path().to_path_buf(),
        };
        let outcome = stop_worker(&source, &worker(), "Fix the reef map", 42, |_| {
            panic!("a Firstmate worker is never ended behind Firstmate's back")
        })
        .unwrap();
        assert_eq!(
            outcome,
            StopOutcome::Asked {
                note_id: "n-9".into()
            }
        );
        let args = std::fs::read_to_string(bin.join("args")).unwrap();
        assert!(args.contains("fathom-stop-atl-12-42"));
        let body = std::fs::read_to_string(bin.join("body")).unwrap();
        assert!(
            body.starts_with(
                "Fathom board request: stop the worker on atl-12 \"Fix the reef map\""
            )
        );
    }

    #[test]
    fn on_fathoms_own_backlog_stop_ends_the_workers_terminal() {
        let mut ended = None;
        let outcome = stop_worker(
            &Source::Backlog,
            &worker(),
            "Fix the reef map",
            42,
            |terminal| {
                ended = Some(terminal.to_string());
                Ok(())
            },
        )
        .unwrap();
        assert_eq!(outcome, StopOutcome::Stopped);
        assert_eq!(ended.as_deref(), Some("t7"));
    }

    #[test]
    #[ignore = "needs FATHOM_LAB_SESSION and FATHOM_LAB_TASK for a fathom.task worker in a throwaway herdr-core session"]
    fn stop_ends_a_lab_backlog_workers_terminal() {
        use crate::herdr::{Connection, Herdr};
        let connection = Connection {
            session: std::env::var("FATHOM_LAB_SESSION").expect("FATHOM_LAB_SESSION"),
            socket: std::env::var("FATHOM_LAB_SOCKET").unwrap_or_default(),
        };
        let task = std::env::var("FATHOM_LAB_TASK").expect("FATHOM_LAB_TASK");
        let herdr = Herdr::new(connection.clone(), std::sync::Arc::new(|_| {}));
        herdr.start_events();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
        let worker = loop {
            let found = crate::workers::board_workers(
                &Source::Backlog,
                &connection.session,
                &herdr.terminals(),
            )
            .into_iter()
            .find(|w| w.task_id == task);
            if let Some(worker) = found {
                break worker;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "the lab worker never showed"
            );
            std::thread::sleep(std::time::Duration::from_millis(200));
        };
        let outcome = stop_worker(&Source::Backlog, &worker, "Lab worker", 0, |t| {
            herdr.kill(t)
        })
        .unwrap();
        assert_eq!(outcome, StopOutcome::Stopped);
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
        while herdr
            .terminals()
            .get(&worker.terminal)
            .is_some_and(|t| t.state == "live")
        {
            assert!(
                std::time::Instant::now() < deadline,
                "the lab terminal is still live"
            );
            std::thread::sleep(std::time::Duration::from_millis(200));
        }
        println!("stopped {} on {}", worker.task_id, worker.terminal);
    }

    #[test]
    fn a_stop_request_names_the_task_and_keeps_its_card() {
        assert!(stop_request_id("atl-12", 7).starts_with("fathom-stop-atl-12-"));
        let body = stop_body("atl-12", "Fix  the\nreef map");
        assert!(
            body.starts_with(
                "Fathom board request: stop the worker on atl-12 \"Fix the reef map\""
            )
        );
        assert!(body.contains("Keep the task where it is on the board"));
    }

    #[test]
    fn request_ids_are_valid_inbox_ids() {
        let id = request_id("atl-12", 1_700_000_000_000);
        assert_eq!(id, "fathom-move-atl-12-1700000000000");
        let odd = request_id(&format!("we/ird id{}", "x".repeat(300)), 5);
        assert!(odd.len() <= REQUEST_ID_LIMIT);
        assert!(odd.starts_with("fathom-move-we-ird-idx"));
        assert!(odd.ends_with("-5"));
        assert!(
            odd.chars()
                .all(|c| c.is_ascii_alphanumeric() || "._:-".contains(c))
        );
    }

    #[test]
    fn the_body_is_one_line_with_fixed_row_keys() {
        assert_eq!(
            move_body("atl-12", "Fix the\n  reef  map", Row::Seabed, Row::Shallows),
            "Fathom board request: move atl-12 \"Fix the reef map\" from seabed to shallows"
        );
    }

    fn fake_inbox(script: &str) -> tempfile::TempDir {
        let home = tempfile::tempdir().unwrap();
        let bin = home.path().join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        let path = bin.join("fm-inbox.sh");
        write_script(&path, &format!("#!/bin/sh\n{script}\n"));
        home
    }

    #[test]
    fn a_saved_note_returns_its_id_even_when_the_wake_failed() {
        let home = fake_inbox(
            r#"cat > "$FM_HOME/body"; printf '%s\n' "$*" > "$FM_HOME/args"
echo '{"schema":"fm-inbox-note.v1","outcome":"created","id":"n-1","saved":true,"announced":false}'
exit 3"#,
        );
        let id = send_note(home.path(), "fathom-move-a-1", "Fathom board request: hi").unwrap();
        assert_eq!(id, "n-1");
        let read = |name: &str| std::fs::read_to_string(home.path().join(name)).unwrap();
        assert_eq!(read("body"), "Fathom board request: hi");
        assert_eq!(
            read("args").trim(),
            "note --request-id fathom-move-a-1 --json -"
        );
    }

    #[test]
    fn an_unsaved_note_is_an_error() {
        let home = fake_inbox("echo 'fm-inbox: no inbox' >&2; exit 1");
        assert_eq!(
            send_note(home.path(), "r", "b").unwrap_err(),
            "fm-inbox: no inbox"
        );
    }

    #[test]
    fn an_inbox_that_exits_before_reading_still_reports_its_own_error() {
        const LARGER_THAN_A_PIPE: usize = 1 << 20;
        let home = fake_inbox("echo 'fm-inbox: no inbox' >&2; exit 1");
        assert_eq!(
            send_note(home.path(), "r", &"b".repeat(LARGER_THAN_A_PIPE)).unwrap_err(),
            "fm-inbox: no inbox"
        );
    }

    #[test]
    fn replies_map_note_ids_to_their_text() {
        let home = fake_inbox(
            r#"printf '%s\n' '{"schema":"fm-inbox-receipts.v1","pending":[],"handled":[],"replies":[{"id":"n-1","at":"x","body":"Not yet.\n","cursor":"000000000001"}],"reply_cursor":"000000000001","omitted":[]}'"#,
        );
        let replies = replies(home.path()).unwrap();
        assert_eq!(replies["n-1"], "Not yet.");
    }
}
