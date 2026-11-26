use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

use serde::{Deserialize, Serialize};

use super::tokens::parse_timestamp;

pub const SESSIONS_DIR: &str = "sessions";
const TAIL_STEPS: [u64; 3] = [256 * 1024, 2 * 1024 * 1024, 16 * 1024 * 1024];
const RECENT_REPLIES: usize = 20;
pub const WARM_MS: i64 = 5 * 60 * 1000;
pub const WARM_LONG_MS: i64 = 60 * 60 * 1000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub context_tokens: u64,
    pub last_reply_ms: i64,
    pub warm_ms: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionFile {
    pid: u32,
    session_id: String,
    cwd: String,
}

#[derive(Deserialize)]
struct Line {
    #[serde(rename = "type")]
    kind: Option<String>,
    timestamp: Option<String>,
    message: Option<Message>,
}

#[derive(Deserialize)]
struct Message {
    model: Option<String>,
    usage: Option<Usage>,
}

#[derive(Deserialize, Default)]
struct Usage {
    #[serde(default)]
    input_tokens: u64,
    #[serde(default)]
    cache_creation_input_tokens: u64,
    #[serde(default)]
    cache_read_input_tokens: u64,
    #[serde(default)]
    cache_creation: Option<CacheCreation>,
}

#[derive(Deserialize, Default)]
struct CacheCreation {
    #[serde(default)]
    ephemeral_1h_input_tokens: u64,
}

const SYNTHETIC: &str = "<synthetic>";

pub fn transcript_of(claude_dir: &Path, pid: u32) -> Option<PathBuf> {
    let text =
        std::fs::read_to_string(claude_dir.join(SESSIONS_DIR).join(format!("{pid}.json"))).ok()?;
    let file: SessionFile = serde_json::from_str(&text).ok()?;
    if file.pid != pid || file.session_id.is_empty() {
        return None;
    }
    let path = claude_dir
        .join(super::TRANSCRIPTS_DIR)
        .join(project_folder(&file.cwd))
        .join(format!("{}.jsonl", file.session_id));
    path.is_file().then_some(path)
}

pub fn project_folder(cwd: &str) -> String {
    cwd.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect()
}

pub fn latest(text: &str) -> Option<Session> {
    let mut found: Option<(u64, i64)> = None;
    let mut long = false;
    let mut seen = 0;
    for line in text.lines().rev() {
        if !line.contains("\"usage\"") || !line.contains("\"assistant\"") {
            continue;
        }
        let Ok(parsed) = serde_json::from_str::<Line>(line) else {
            continue;
        };
        if parsed.kind.as_deref() != Some("assistant") {
            continue;
        }
        let Some(message) = parsed.message else {
            continue;
        };
        if message.model.as_deref() == Some(SYNTHETIC) {
            continue;
        }
        let Some(usage) = message.usage else { continue };
        if found.is_none() {
            let Some(at) = parsed.timestamp.as_deref().and_then(parse_timestamp) else {
                continue;
            };
            let context = usage.input_tokens
                + usage.cache_creation_input_tokens
                + usage.cache_read_input_tokens;
            found = Some((context, at));
        }
        long |= usage
            .cache_creation
            .as_ref()
            .is_some_and(|c| c.ephemeral_1h_input_tokens > 0);
        seen += 1;
        if seen >= RECENT_REPLIES {
            break;
        }
    }
    found.map(|(context_tokens, last_reply_ms)| Session {
        context_tokens,
        last_reply_ms,
        warm_ms: if long { WARM_LONG_MS } else { WARM_MS },
    })
}

fn read_tail(path: &Path, bytes: u64) -> Option<(String, bool)> {
    let mut file = std::fs::File::open(path).ok()?;
    let len = file.metadata().ok()?.len();
    let start = len.saturating_sub(bytes);
    file.seek(SeekFrom::Start(start)).ok()?;
    let mut buf = Vec::with_capacity((len - start) as usize);
    file.read_to_end(&mut buf).ok()?;
    let text = String::from_utf8_lossy(&buf);
    let text = if start > 0 {
        text.split_once('\n')
            .map(|(_, rest)| rest.to_string())
            .unwrap_or_default()
    } else {
        text.into_owned()
    };
    Some((text, start == 0))
}

pub fn read(path: &Path) -> Option<Session> {
    for step in TAIL_STEPS {
        let (text, whole) = read_tail(path, step)?;
        if let Some(session) = latest(&text) {
            return Some(session);
        }
        if whole {
            return None;
        }
    }
    None
}

type Stamped = (u64, SystemTime, Option<Session>);

#[derive(Default)]
pub struct Sessions {
    cache: Mutex<HashMap<PathBuf, Stamped>>,
}

impl Sessions {
    pub fn of(&self, claude_dir: &Path, pids: &[u32]) -> Option<Session> {
        pids.iter()
            .filter_map(|pid| transcript_of(claude_dir, *pid))
            .filter_map(|path| self.cached(&path))
            .max_by_key(|s| s.last_reply_ms)
    }

    fn cached(&self, path: &Path) -> Option<Session> {
        let meta = std::fs::metadata(path).ok()?;
        let stamp = (meta.len(), meta.modified().ok()?);
        let mut cache = self.cache.lock().unwrap();
        if let Some((len, modified, session)) = cache.get(path)
            && (*len, *modified) == stamp
        {
            return *session;
        }
        let session = read(path);
        cache.insert(path.to_path_buf(), (stamp.0, stamp.1, session));
        session
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reply(at: &str, input: u64, write: u64, read: u64, long: u64) -> String {
        serde_json::json!({
            "type": "assistant",
            "timestamp": at,
            "message": {
                "id": format!("msg-{at}"),
                "model": "claude-test-1",
                "usage": {
                    "input_tokens": input,
                    "cache_creation_input_tokens": write,
                    "cache_read_input_tokens": read,
                    "output_tokens": 9,
                    "cache_creation": { "ephemeral_5m_input_tokens": write - long, "ephemeral_1h_input_tokens": long }
                }
            }
        })
        .to_string()
    }

    const USER: &str = r#"{"type":"user","timestamp":"2026-11-20T10:09:00.000Z","message":{"role":"user","content":"thanks"}}"#;

    #[test]
    fn context_is_the_latest_replys_input_plus_cache_and_the_cache_is_five_minutes_by_default() {
        let text = [
            reply("2026-11-20T10:00:00.000Z", 3, 100, 1_000, 0),
            reply("2026-11-20T10:05:00.000Z", 2, 50, 88_000, 0),
            USER.to_string(),
        ]
        .join("\n");
        let session = latest(&text).unwrap();
        assert_eq!(session.context_tokens, 88_052);
        assert_eq!(
            session.last_reply_ms,
            parse_timestamp("2026-11-20T10:05:00.000Z").unwrap()
        );
        assert_eq!(session.warm_ms, WARM_MS);
    }

    #[test]
    fn recent_one_hour_cache_writes_keep_the_session_warm_for_an_hour() {
        let text = [
            reply("2026-11-20T10:00:00.000Z", 1, 400, 0, 400),
            reply("2026-11-20T10:05:00.000Z", 1, 0, 900, 0),
        ]
        .join("\n");
        assert_eq!(latest(&text).unwrap().warm_ms, WARM_LONG_MS);
    }

    #[test]
    fn synthetic_replies_and_other_lines_are_skipped() {
        let synthetic = r#"{"type":"assistant","timestamp":"2026-11-20T11:00:00.000Z","message":{"model":"<synthetic>","usage":{"input_tokens":0}}}"#;
        let text = [
            reply("2026-11-20T10:00:00.000Z", 1, 2, 3, 0),
            synthetic.to_string(),
            USER.to_string(),
            "not json".into(),
        ]
        .join("\n");
        assert_eq!(latest(&text).unwrap().context_tokens, 6);
        assert_eq!(latest(USER), None);
    }

    #[test]
    fn a_session_file_names_the_transcript_in_its_folder() {
        let dir = tempfile::tempdir().unwrap();
        let claude = dir.path();
        let cwd = "/home/sailor/.trees/harbor-1/harbor";
        let folder = claude.join("projects").join(project_folder(cwd));
        assert_eq!(project_folder(cwd), "-home-sailor--trees-harbor-1-harbor");
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::create_dir_all(claude.join(SESSIONS_DIR)).unwrap();
        std::fs::write(
            claude.join(SESSIONS_DIR).join("4242.json"),
            serde_json::json!({"pid": 4242, "sessionId": "s-1", "cwd": cwd}).to_string(),
        )
        .unwrap();
        assert_eq!(transcript_of(claude, 4242), None);
        std::fs::write(
            folder.join("s-1.jsonl"),
            reply("2026-11-20T10:00:00.000Z", 1, 2, 3, 0),
        )
        .unwrap();
        assert_eq!(transcript_of(claude, 4242), Some(folder.join("s-1.jsonl")));
        assert_eq!(transcript_of(claude, 4243), None);

        let sessions = Sessions::default();
        assert_eq!(
            sessions.of(claude, &[4243, 4242]).unwrap().context_tokens,
            6
        );
    }

    #[test]
    fn a_long_tool_output_after_the_last_reply_is_read_past() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("s.jsonl");
        let filler = format!(
            "{{\"type\":\"user\",\"message\":{{\"content\":\"{}\"}}}}",
            "x".repeat(300 * 1024)
        );
        std::fs::write(
            &path,
            [reply("2026-11-20T10:00:00.000Z", 1, 2, 3, 0), filler].join("\n"),
        )
        .unwrap();
        assert_eq!(read(&path).unwrap().context_tokens, 6);
    }
}
