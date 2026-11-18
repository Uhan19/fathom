use std::collections::HashMap;
use std::io::Write;
use std::path::Path;
use std::process::Stdio;

use serde::Deserialize;

use crate::tasks::{Row, firstmate_command};

const INBOX_SCRIPT: &str = "bin/fm-inbox.sh";
const REQUEST_ID_PREFIX: &str = "fathom-move";
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
    let suffix = format!("-{now_ms}");
    let room = REQUEST_ID_LIMIT - REQUEST_ID_PREFIX.len() - 1 - suffix.len();
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
    format!("{REQUEST_ID_PREFIX}-{card}{suffix}")
}

pub fn move_body(card_id: &str, title: &str, from: Row, to: Row) -> String {
    let title = title.split_whitespace().collect::<Vec<_>>().join(" ");
    format!(
        "Fathom board request: move {card_id} \"{title}\" from {} to {}",
        from.key(),
        to.key()
    )
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
    use std::os::unix::fs::PermissionsExt;

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
        std::fs::write(&path, format!("#!/bin/sh\n{script}\n")).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
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
