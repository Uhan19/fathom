use std::collections::{BTreeMap, HashMap};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const STORE_FILE: &str = "tokens.db";
pub const PRICES_FILE: &str = "prices.json";
pub const DAYS: usize = 30;
const WEEK_DAYS: usize = 7;
const MS_PER_DAY: i64 = 86_400_000;
const RETAIN_MS: i64 = (DAYS as i64 + 1) * MS_PER_DAY;
const TRANSCRIPT_EXTENSION: &str = "jsonl";
const ASSISTANT_MARK: &str = r#""type":"assistant""#;
const USER_MARK: &str = r#""type":"user""#;
const TOOL_RESULT_MARK: &str = r#""tool_result""#;
const META_MARK: &str = r#""isMeta":true"#;
const SIDECHAIN_MARK: &str = r#""isSidechain":true"#;
const NOTE_MARK: &str = "inbox note ";
const NOTE_MOVE_MARK: &str = " - Fathom board request: move";
const ACK_MARK: &str = "acked ";
const WAKE_MARK: &str = "WAKE_ACK_REQUIRED";
const NUDGE_SINGLE: &str = "board request waiting";
const NUDGE_PLURAL: &str = "board requests waiting";
const NOTE_TURN: &str = "note:";
const NUDGE_TURN: &str = "nudge:";
const SYNTHETIC_MODEL: &str = "<synthetic>";
const WORKER_BRANCH: &str = "fm/";
const PIPELINE_WORKTREES: &str = "/.no-mistakes/worktrees/";
const PIPELINE_PROJECT: &str = "no-mistakes";
const PIPELINE_REPOS: &str = "repos";
const DETACHED_BRANCH: &str = "HEAD";
const ORIGIN_SECTION: &str = r#"[remote "origin"]"#;
const PER_MILLION: f64 = 1_000_000.0;
const PROMPTS_VERSION: i64 = 1;
const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS files (
    path TEXT PRIMARY KEY,
    offset INTEGER NOT NULL,
    turn TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    cwd TEXT NOT NULL DEFAULT '',
    branch TEXT NOT NULL DEFAULT '',
    repo TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    session TEXT NOT NULL,
    at_ms INTEGER NOT NULL,
    model TEXT NOT NULL,
    input INTEGER NOT NULL,
    output INTEGER NOT NULL,
    cache_write INTEGER NOT NULL,
    cache_write_1h INTEGER NOT NULL,
    cache_read INTEGER NOT NULL,
    turn TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS messages_at ON messages (at_ms);
CREATE TABLE IF NOT EXISTS prompts (
    id TEXT PRIMARY KEY,
    session TEXT NOT NULL,
    at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS prompts_at ON prompts (at_ms);
";

#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Price {
    pub input: f64,
    pub output: f64,
    pub cache_write: f64,
    pub cache_write_1h: f64,
    pub cache_read: f64,
}

pub type Prices = BTreeMap<String, Price>;

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Usage {
    pub input: u64,
    pub output: u64,
    pub cache_write: u64,
    pub cache_write_1h: u64,
    pub cache_read: u64,
}

impl Usage {
    fn tokens(&self) -> u64 {
        self.input + self.output + self.cache_write + self.cache_read
    }

    fn cost(&self, price: Option<&Price>) -> Costs {
        let Some(p) = price else {
            return Costs::default();
        };
        let dollars = |tokens: u64, per_million: f64| tokens as f64 * per_million / PER_MILLION;
        let five_minute = self.cache_write.saturating_sub(self.cache_write_1h);
        Costs {
            input: dollars(self.input, p.input),
            output: dollars(self.output, p.output),
            cache_write: dollars(five_minute, p.cache_write)
                + dollars(self.cache_write_1h, p.cache_write_1h),
            cache_read: dollars(self.cache_read, p.cache_read),
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Costs {
    pub input: f64,
    pub output: f64,
    pub cache_write: f64,
    pub cache_read: f64,
}

impl Costs {
    pub fn total(&self) -> f64 {
        self.input + self.output + self.cache_write + self.cache_read
    }

    fn add(&mut self, other: &Costs) {
        self.input += other.input;
        self.output += other.output;
        self.cache_write += other.cache_write;
        self.cache_read += other.cache_read;
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Message {
    pub id: String,
    pub session: String,
    pub at_ms: i64,
    pub model: String,
    pub usage: Usage,
    pub turn: String,
    pub cwd: String,
    pub branch: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Prompt {
    pub id: String,
    pub session: String,
    pub at_ms: i64,
}

#[derive(Debug, Default, PartialEq)]
pub struct Chunk {
    pub messages: Vec<Message>,
    pub prompts: Vec<Prompt>,
    pub turn: String,
    pub consumed: usize,
}

pub fn parse_chunk(bytes: &[u8], turn: &str) -> Chunk {
    let consumed = bytes.iter().rposition(|b| *b == b'\n').map_or(0, |i| i + 1);
    let mut chunk = Chunk {
        turn: turn.to_string(),
        consumed,
        ..Chunk::default()
    };
    for line in bytes[..consumed].split(|b| *b == b'\n') {
        let Ok(line) = std::str::from_utf8(line) else {
            continue;
        };
        if line.contains(ASSISTANT_MARK) {
            if let Some(message) = assistant(line, &chunk.turn) {
                chunk.messages.push(message);
            }
        } else if line.contains(USER_MARK) {
            read_user(line, &mut chunk);
        }
    }
    chunk
}

fn read_user(line: &str, chunk: &mut Chunk) {
    let tool_result = line.contains(TOOL_RESULT_MARK);
    let prompt = !tool_result && !line.contains(META_MARK) && !line.contains(SIDECHAIN_MARK);
    let value = if prompt {
        serde_json::from_str::<Value>(line).ok()
    } else {
        None
    };
    if let Some(note) = note_move(line) {
        chunk.turn = format!("{NOTE_TURN}{note}");
    } else if let Some(nudge) = value.as_ref().and_then(nudge_move) {
        chunk.turn = format!("{NUDGE_TURN}{nudge}");
    } else if prompt || ends_note_turn(line, &chunk.turn) {
        chunk.turn.clear();
    }
    if let Some(asked) = value.as_ref().and_then(prompt_of) {
        chunk.prompts.push(asked);
    }
}

fn prompt_of(value: &Value) -> Option<Prompt> {
    Some(Prompt {
        id: text(value, "uuid")?,
        session: text(value, "sessionId")?,
        at_ms: parse_timestamp(value.get("timestamp")?.as_str()?)?,
    })
}

fn note_move(line: &str) -> Option<String> {
    let end = line.find(NOTE_MOVE_MARK)?;
    let start = line[..end].rfind(NOTE_MARK)? + NOTE_MARK.len();
    let id = &line[start..end];
    let atom = !id.is_empty()
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "._-".contains(c));
    atom.then(|| id.to_string())
}

fn nudge_move(value: &Value) -> Option<String> {
    let content = value.get("message")?.get("content")?.as_str()?.trim();
    let (count, rest) = content.split_once(' ')?;
    let nudged = count.parse::<u32>().is_ok() && (rest == NUDGE_SINGLE || rest == NUDGE_PLURAL);
    nudged.then(|| {
        text(value, "uuid")
            .or_else(|| text(value, "timestamp"))
            .unwrap_or_default()
    })
}

fn ends_note_turn(line: &str, turn: &str) -> bool {
    let Some(note) = turn.strip_prefix(NOTE_TURN) else {
        return false;
    };
    line.contains(&format!("{ACK_MARK}{note}")) || line.contains(WAKE_MARK)
}

fn text(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn count(value: &Value, key: &str) -> u64 {
    value.get(key).and_then(Value::as_u64).unwrap_or(0)
}

fn assistant(line: &str, turn: &str) -> Option<Message> {
    let value: Value = serde_json::from_str(line).ok()?;
    let message = value.get("message")?;
    let usage = message.get("usage")?;
    let model = normalized_model(message.get("model")?.as_str()?);
    if model == SYNTHETIC_MODEL {
        return None;
    }
    Some(Message {
        id: text(message, "id").or_else(|| text(&value, "requestId"))?,
        session: text(&value, "sessionId")?,
        at_ms: parse_timestamp(value.get("timestamp")?.as_str()?)?,
        model,
        usage: Usage {
            input: count(usage, "input_tokens"),
            output: count(usage, "output_tokens"),
            cache_write: count(usage, "cache_creation_input_tokens"),
            cache_write_1h: usage
                .get("cache_creation")
                .map_or(0, |c| count(c, "ephemeral_1h_input_tokens")),
            cache_read: count(usage, "cache_read_input_tokens"),
        },
        turn: turn.to_string(),
        cwd: text(&value, "cwd").unwrap_or_default(),
        branch: text(&value, "gitBranch").unwrap_or_default(),
    })
}

pub fn normalized_model(model: &str) -> String {
    model.split('[').next().unwrap_or(model).trim().to_string()
}

pub fn parse_timestamp(stamp: &str) -> Option<i64> {
    let (date, time) = stamp.trim_end_matches('Z').split_once('T')?;
    let mut ymd = date.splitn(3, '-').map(|p| p.parse::<i64>().ok());
    let (year, month, day) = (ymd.next()??, ymd.next()??, ymd.next()??);
    let (clock, fraction) = time.split_once('.').unwrap_or((time, "0"));
    let mut hms = clock.splitn(3, ':').map(|p| p.parse::<i64>().ok());
    let (hour, minute, second) = (hms.next()??, hms.next()??, hms.next()??);
    let millis: i64 = format!("{fraction:0<3}").get(..3)?.parse().ok()?;
    let days = days_from_civil(year, month, day);
    Some((((days * 24 + hour) * 60 + minute) * 60 + second) * 1000 + millis)
}

fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let yoe = year - era * 400;
    let mp = (month + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

pub struct Store {
    conn: Connection,
}

impl Store {
    pub fn open(path: &Path) -> Result<Store, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let conn = Connection::open(path).map_err(|e| e.to_string())?;
        conn.execute_batch(SCHEMA).map_err(|e| e.to_string())?;
        Ok(Store { conn })
    }

    pub fn scan(&mut self, root: &Path, now_ms: i64, is_repo: IsRepo) -> Result<(), String> {
        let mut files = Vec::new();
        transcripts(root, &mut files);
        let tx = self.conn.transaction().map_err(|e| e.to_string())?;
        let version: i64 = tx
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .map_err(|e| e.to_string())?;
        if version < PROMPTS_VERSION {
            backfill_prompts(&tx, now_ms)?;
            tx.pragma_update(None, "user_version", PROMPTS_VERSION)
                .map_err(|e| e.to_string())?;
        }
        for path in files {
            if let Err(error) = scan_file(&tx, &path, now_ms, is_repo) {
                eprintln!("fathom: cannot read {}: {error}", path.display());
            }
        }
        for table in ["messages", "prompts"] {
            tx.execute(
                &format!("DELETE FROM {table} WHERE at_ms < ?1"),
                params![now_ms - RETAIN_MS],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())
    }

    fn sessions(&self) -> Result<HashMap<String, Session>, String> {
        let mut statement = self
            .conn
            .prepare("SELECT id, cwd, branch, repo FROM sessions")
            .map_err(|e| e.to_string())?;
        let rows = statement
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    Session {
                        cwd: r.get(1)?,
                        branch: r.get(2)?,
                        repo: r.get(3)?,
                    },
                ))
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
    }

    fn prompts_since(&self, since_ms: i64) -> Result<HashMap<String, u64>, String> {
        let mut statement = self
            .conn
            .prepare("SELECT session, COUNT(*) FROM prompts WHERE at_ms >= ?1 GROUP BY session")
            .map_err(|e| e.to_string())?;
        let rows = statement
            .query_map(params![since_ms], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)? as u64))
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
    }

    fn messages_since(&self, since_ms: i64) -> Result<Vec<Stored>, String> {
        let mut statement = self
            .conn
            .prepare(
                "SELECT session, at_ms, model, input, output, cache_write, cache_write_1h, cache_read, turn
                 FROM messages WHERE at_ms >= ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = statement
            .query_map(params![since_ms], |r| {
                Ok(Stored {
                    session: r.get(0)?,
                    at_ms: r.get(1)?,
                    model: r.get(2)?,
                    usage: Usage {
                        input: r.get::<_, i64>(3)? as u64,
                        output: r.get::<_, i64>(4)? as u64,
                        cache_write: r.get::<_, i64>(5)? as u64,
                        cache_write_1h: r.get::<_, i64>(6)? as u64,
                        cache_read: r.get::<_, i64>(7)? as u64,
                    },
                    turn: r.get(8)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
    }
}

fn transcripts(dir: &Path, found: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        match entry.file_type() {
            Ok(kind) if kind.is_dir() => transcripts(&path, found),
            Ok(kind)
                if kind.is_file()
                    && path.extension().is_some_and(|e| e == TRANSCRIPT_EXTENSION) =>
            {
                found.push(path)
            }
            _ => {}
        }
    }
}

fn scan_file(
    tx: &rusqlite::Transaction,
    path: &Path,
    now_ms: i64,
    is_repo: IsRepo,
) -> Result<(), String> {
    let key = path.display().to_string();
    let meta = std::fs::metadata(path).map_err(|e| e.to_string())?;
    let size = meta.len();
    let known: Option<(i64, String)> = tx
        .query_row(
            "SELECT offset, turn FROM files WHERE path = ?1",
            params![key],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let (mut offset, mut turn) = match known {
        Some((offset, turn)) if offset as u64 <= size => (offset as u64, turn),
        Some(_) => (0, String::new()),
        None if modified_ms(&meta).is_some_and(|ms| ms < now_ms - RETAIN_MS) => {
            (size, String::new())
        }
        None => (0, String::new()),
    };
    if offset < size {
        let bytes = read_span(path, offset, size)?;
        let chunk = parse_chunk(&bytes, &turn);
        save_chunk(tx, &chunk, is_repo)?;
        offset += chunk.consumed as u64;
        turn = chunk.turn;
    }
    tx.execute(
        "INSERT INTO files (path, offset, turn) VALUES (?1, ?2, ?3)
         ON CONFLICT(path) DO UPDATE SET offset = excluded.offset, turn = excluded.turn",
        params![key, offset as i64, turn],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn read_span(path: &Path, from: u64, to: u64) -> Result<Vec<u8>, String> {
    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    file.seek(SeekFrom::Start(from))
        .map_err(|e| e.to_string())?;
    let length = to.saturating_sub(from);
    let mut bytes = Vec::with_capacity(length as usize);
    file.take(length)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    Ok(bytes)
}

fn backfill_prompts(tx: &rusqlite::Transaction, now_ms: i64) -> Result<(), String> {
    let read: Vec<(String, i64)> = {
        let mut statement = tx
            .prepare("SELECT path, offset FROM files")
            .map_err(|e| e.to_string())?;
        let rows = statement
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())?
    };
    for (path, offset) in read {
        let path = Path::new(&path);
        let recent = std::fs::metadata(path)
            .ok()
            .and_then(|meta| modified_ms(&meta))
            .is_some_and(|ms| ms >= now_ms - RETAIN_MS);
        if let (true, Ok(bytes)) = (recent, read_span(path, 0, offset as u64)) {
            save_prompts(tx, &parse_chunk(&bytes, "").prompts)?;
        }
    }
    Ok(())
}

fn modified_ms(meta: &std::fs::Metadata) -> Option<i64> {
    let since = meta
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?;
    Some(since.as_millis() as i64)
}

fn save_chunk(tx: &rusqlite::Transaction, chunk: &Chunk, is_repo: IsRepo) -> Result<(), String> {
    let mut message = tx
        .prepare_cached(
            "INSERT INTO messages (id, session, at_ms, model, input, output, cache_write, cache_write_1h, cache_read, turn)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
             ON CONFLICT(id) DO UPDATE SET
               input = max(input, excluded.input),
               output = max(output, excluded.output),
               cache_write = max(cache_write, excluded.cache_write),
               cache_write_1h = max(cache_write_1h, excluded.cache_write_1h),
               cache_read = max(cache_read, excluded.cache_read)",
        )
        .map_err(|e| e.to_string())?;
    let mut session = tx
        .prepare_cached(
            "INSERT INTO sessions (id, cwd, branch, repo) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(id) DO UPDATE SET
               cwd = CASE WHEN excluded.cwd = '' THEN cwd ELSE excluded.cwd END,
               branch = CASE WHEN excluded.branch = '' THEN branch ELSE excluded.branch END,
               repo = CASE WHEN excluded.repo = '' THEN repo ELSE excluded.repo END",
        )
        .map_err(|e| e.to_string())?;
    let mut repos: HashMap<&str, String> = HashMap::new();
    for m in &chunk.messages {
        let u = &m.usage;
        message
            .execute(params![
                m.id,
                m.session,
                m.at_ms,
                m.model,
                u.input as i64,
                u.output as i64,
                u.cache_write as i64,
                u.cache_write_1h as i64,
                u.cache_read as i64,
                m.turn
            ])
            .map_err(|e| e.to_string())?;
        let repo = repos
            .entry(m.cwd.as_str())
            .or_insert_with(|| repo_root(&m.cwd, is_repo));
        session
            .execute(params![m.session, m.cwd, m.branch, repo.as_str()])
            .map_err(|e| e.to_string())?;
    }
    save_prompts(tx, &chunk.prompts)
}

fn save_prompts(tx: &rusqlite::Transaction, prompts: &[Prompt]) -> Result<(), String> {
    let mut insert = tx
        .prepare_cached("INSERT OR IGNORE INTO prompts (id, session, at_ms) VALUES (?1, ?2, ?3)")
        .map_err(|e| e.to_string())?;
    for p in prompts {
        insert
            .execute(params![p.id, p.session, p.at_ms])
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[derive(Debug, Clone, Default, PartialEq)]
struct Session {
    cwd: String,
    branch: String,
    repo: String,
}

#[derive(Debug, Clone, PartialEq)]
struct Stored {
    session: String,
    at_ms: i64,
    model: String,
    usage: Usage,
    turn: String,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Roles {
    pub home: Option<PathBuf>,
    pub chat_folder: Option<PathBuf>,
    pub assistant_folder: PathBuf,
    pub titles: HashMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    Orchestrator,
    Worker,
    Assistant,
    Move,
    Other,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
struct Consumer {
    role: Role,
    name: String,
    task_id: Option<String>,
}

const ORCHESTRATOR_NAME: &str = "Orchestrator";
const ASSISTANT_NAME: &str = "Board assistant";
const MOVES_NAME: &str = "Board move requests";

impl Roles {
    fn assistant(&self, session: &Session) -> bool {
        Path::new(&session.cwd) == self.assistant_folder
    }

    fn consumer(&self, session: &Session, project: &str) -> Consumer {
        if self.assistant(session) {
            return consumer(Role::Assistant, ASSISTANT_NAME, None);
        }
        let cwd = Path::new(&session.cwd);
        if let Some(task) = session.branch.strip_prefix(WORKER_BRANCH) {
            let name = self.titles.get(task).map_or(task, String::as_str);
            return consumer(Role::Worker, name, Some(task));
        }
        let at = |folder: &Option<PathBuf>| folder.as_deref().is_some_and(|f| f == cwd);
        if at(&self.home) || at(&self.chat_folder) {
            return consumer(Role::Orchestrator, ORCHESTRATOR_NAME, None);
        }
        consumer(Role::Other, project, None)
    }
}

fn consumer(role: Role, name: &str, task_id: Option<&str>) -> Consumer {
    Consumer {
        role,
        name: name.to_string(),
        task_id: task_id.map(str::to_string),
    }
}

fn base(path: &str) -> &str {
    path.trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or(path)
}

pub type IsRepo<'a> = &'a dyn Fn(&Path) -> bool;

fn repo_root(cwd: &str, is_repo: IsRepo) -> String {
    if cwd.is_empty() {
        return String::new();
    }
    Path::new(cwd)
        .ancestors()
        .find(|folder| is_repo(folder))
        .map(|root| root.display().to_string())
        .unwrap_or_default()
}

fn projects(sessions: &HashMap<String, Session>) -> HashMap<String, String> {
    let known: Vec<&Path> = sessions
        .values()
        .filter(|s| !s.repo.is_empty())
        .map(|s| Path::new(&s.repo))
        .collect();
    let named = |s: &Session| -> String {
        if !s.repo.is_empty() {
            return base(&s.repo).to_string();
        }
        let folder = Path::new(&s.cwd);
        known
            .iter()
            .filter(|root| folder.starts_with(root))
            .max_by_key(|root| root.as_os_str().len())
            .map_or_else(
                || base(&s.cwd).to_string(),
                |root| base(&root.to_string_lossy()).to_string(),
            )
    };
    let mut by_branch: HashMap<&str, Option<String>> = HashMap::new();
    for s in sessions.values() {
        if s.branch.is_empty() || s.branch == DETACHED_BRANCH || s.cwd.contains(PIPELINE_WORKTREES)
        {
            continue;
        }
        let name = named(s);
        by_branch
            .entry(s.branch.as_str())
            .and_modify(|known| {
                if known.as_ref() != Some(&name) {
                    *known = None;
                }
            })
            .or_insert(Some(name));
    }
    let mut origins: HashMap<PathBuf, Option<String>> = HashMap::new();
    sessions
        .iter()
        .map(|(id, s)| {
            let project = match pipeline_clone_config(&s.cwd) {
                Some(config) => origins
                    .entry(config)
                    .or_insert_with_key(|config| origin_name(config))
                    .clone()
                    .or_else(|| by_branch.get(s.branch.as_str()).cloned().flatten())
                    .unwrap_or_else(|| PIPELINE_PROJECT.to_string()),
                None => named(s),
            };
            (id.clone(), project)
        })
        .collect()
}

fn pipeline_clone_config(cwd: &str) -> Option<PathBuf> {
    let at = cwd.find(PIPELINE_WORKTREES)?;
    let id = cwd[at + PIPELINE_WORKTREES.len()..]
        .split('/')
        .next()
        .filter(|id| !id.is_empty())?;
    let pipeline_home = Path::new(&cwd[..at + PIPELINE_WORKTREES.len()]).parent()?;
    Some(
        pipeline_home
            .join(PIPELINE_REPOS)
            .join(format!("{id}.git"))
            .join("config"),
    )
}

fn origin_name(config: &Path) -> Option<String> {
    let text = std::fs::read_to_string(config).ok()?;
    let mut in_origin = false;
    for line in text.lines().map(str::trim) {
        if line.starts_with('[') {
            in_origin = line == ORIGIN_SECTION;
            continue;
        }
        let Some((key, url)) = line.split_once('=') else {
            continue;
        };
        if in_origin && key.trim() == "url" {
            let url = url.trim().trim_end_matches('/');
            let last = url.rsplit(['/', ':']).next()?;
            let name = last.strip_suffix(".git").unwrap_or(last);
            return (!name.is_empty()).then(|| name.to_string());
        }
    }
    None
}

pub fn price_for<'a>(prices: &'a Prices, model: &str) -> Option<&'a Price> {
    prices.get(model).or_else(|| {
        prices
            .iter()
            .filter(|(key, _)| model.starts_with(key.as_str()))
            .max_by_key(|(key, _)| key.len())
            .map(|(_, price)| price)
    })
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Day {
    pub date: String,
    pub start_ms: i64,
    pub input: u64,
    pub output: u64,
    pub cache_write: u64,
    pub cache_read: u64,
    pub cost: Costs,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Share {
    pub name: String,
    pub tokens: u64,
    pub cost: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsumerShare {
    pub role: Role,
    pub name: String,
    pub task_id: Option<String>,
    pub tokens: u64,
    pub cost: f64,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Overhead {
    pub assistant_tokens: u64,
    pub assistant_questions: u64,
    pub move_requests: Vec<u64>,
    pub week_tokens: u64,
    pub week_overhead_tokens: u64,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenReport {
    pub taken_at_ms: i64,
    pub days: Vec<Day>,
    pub models: Vec<Share>,
    pub consumers: Vec<ConsumerShare>,
    pub projects: Vec<Share>,
    pub overhead: Overhead,
    pub unpriced: Vec<String>,
    pub prices_error: Option<String>,
}

#[derive(Default)]
struct Tally {
    usage: Usage,
    cost: Costs,
}

impl Tally {
    fn add(&mut self, usage: &Usage, cost: &Costs) {
        self.usage.input += usage.input;
        self.usage.output += usage.output;
        self.usage.cache_write += usage.cache_write;
        self.usage.cache_write_1h += usage.cache_write_1h;
        self.usage.cache_read += usage.cache_read;
        self.cost.add(cost);
    }
}

pub struct DayStart {
    pub date: String,
    pub start_ms: i64,
}

pub fn report(
    store: &Store,
    roles: &Roles,
    prices: &Prices,
    days: &[DayStart],
    now_ms: i64,
) -> Result<TokenReport, String> {
    let first = days.first().map_or(now_ms, |d| d.start_ms);
    let week_start = days
        .len()
        .checked_sub(WEEK_DAYS)
        .and_then(|i| days.get(i))
        .map_or(first, |d| d.start_ms);
    let sessions = store.sessions()?;
    let projects = projects(&sessions);
    let mut daily: Vec<Tally> = days.iter().map(|_| Tally::default()).collect();
    let mut models: BTreeMap<String, Tally> = BTreeMap::new();
    let mut consumers: BTreeMap<Consumer, Tally> = BTreeMap::new();
    let mut by_project: BTreeMap<String, Tally> = BTreeMap::new();
    let mut moves: BTreeMap<String, u64> = BTreeMap::new();
    let mut unpriced: BTreeMap<String, ()> = BTreeMap::new();
    let mut overhead = Overhead::default();
    let no_session = Session::default();

    for message in store.messages_since(first)? {
        let price = price_for(prices, &message.model);
        if price.is_none() {
            unpriced.insert(message.model.clone(), ());
        }
        let cost = message.usage.cost(price);
        let tokens = message.usage.tokens();
        let day = days.iter().rposition(|d| message.at_ms >= d.start_ms);
        if let Some(day) = day {
            daily[day].add(&message.usage, &cost);
        }
        let session = sessions.get(&message.session).unwrap_or(&no_session);
        let project = projects.get(&message.session).map_or("", String::as_str);
        let owner = roles.consumer(session, project);
        let who = if !message.turn.is_empty() && owner.role == Role::Orchestrator {
            consumer(Role::Move, MOVES_NAME, None)
        } else {
            owner
        };
        if who.role == Role::Assistant {
            overhead.assistant_tokens += tokens;
        }
        if message.at_ms < week_start {
            continue;
        }
        overhead.week_tokens += tokens;
        if who.role == Role::Move {
            *moves.entry(message.turn.clone()).or_default() += tokens;
        }
        if matches!(who.role, Role::Move | Role::Assistant) {
            overhead.week_overhead_tokens += tokens;
        }
        models
            .entry(message.model.clone())
            .or_default()
            .add(&message.usage, &cost);
        if !project.is_empty() {
            by_project
                .entry(project.to_string())
                .or_default()
                .add(&message.usage, &cost);
        }
        consumers.entry(who).or_default().add(&message.usage, &cost);
    }
    overhead.assistant_questions = store
        .prompts_since(first)?
        .into_iter()
        .filter(|(id, _)| sessions.get(id).is_some_and(|s| roles.assistant(s)))
        .map(|(_, count)| count)
        .sum();
    overhead.move_requests = moves.into_values().collect();

    Ok(TokenReport {
        taken_at_ms: now_ms,
        days: days
            .iter()
            .zip(daily)
            .map(|(d, t)| Day {
                date: d.date.clone(),
                start_ms: d.start_ms,
                input: t.usage.input,
                output: t.usage.output,
                cache_write: t.usage.cache_write,
                cache_read: t.usage.cache_read,
                cost: t.cost,
            })
            .collect(),
        models: ranked(models.into_iter()),
        consumers: {
            let mut list: Vec<ConsumerShare> = consumers
                .into_iter()
                .map(|(c, t)| ConsumerShare {
                    role: c.role,
                    name: c.name,
                    task_id: c.task_id,
                    tokens: t.usage.tokens(),
                    cost: t.cost.total(),
                })
                .collect();
            list.sort_by(|a, b| b.tokens.cmp(&a.tokens).then(a.name.cmp(&b.name)));
            list
        },
        projects: ranked(by_project.into_iter()),
        overhead,
        unpriced: unpriced.into_keys().collect(),
        prices_error: None,
    })
}

fn ranked(items: impl Iterator<Item = (String, Tally)>) -> Vec<Share> {
    let mut list: Vec<Share> = items
        .map(|(name, t)| Share {
            name,
            tokens: t.usage.tokens(),
            cost: t.cost.total(),
        })
        .collect();
    list.sort_by(|a, b| b.tokens.cmp(&a.tokens).then(a.name.cmp(&b.name)));
    list
}

pub fn default_prices() -> Prices {
    let price = |input: f64, output: f64, cache_read: f64| Price {
        input,
        output,
        cache_write: input * 1.25,
        cache_write_1h: input * 2.0,
        cache_read,
    };
    [
        ("claude-fable-5-2", price(8.0, 40.0, 0.2)),
        ("claude-mythos-5-2", price(8.0, 40.0, 0.2)),
        ("claude-fable-5-1", price(10.0, 50.0, 0.25)),
        ("claude-mythos-5-1", price(10.0, 50.0, 0.25)),
        ("claude-fable-5", price(10.0, 50.0, 1.0)),
        ("claude-opus-5-5", price(4.0, 20.0, 0.2)),
        ("claude-opus-5", price(5.0, 25.0, 0.5)),
        ("claude-opus-4-8", price(5.0, 25.0, 0.5)),
        ("claude-opus-4-7", price(5.0, 25.0, 0.5)),
        ("claude-opus-4-6", price(5.0, 25.0, 0.5)),
        ("claude-sonnet-5-5", price(2.0, 10.0, 0.1)),
        ("claude-sonnet-5", price(2.0, 10.0, 0.2)),
        ("claude-sonnet-4-6", price(3.0, 15.0, 0.3)),
        ("claude-haiku-5-5", price(0.1, 0.5, 0.01)),
        ("claude-haiku-4-5", price(1.0, 5.0, 0.1)),
    ]
    .into_iter()
    .map(|(model, price)| (model.to_string(), price))
    .collect()
}

pub fn load_prices(path: &Path) -> (Prices, Option<String>) {
    match std::fs::read_to_string(path) {
        Ok(text) => match serde_json::from_str::<Prices>(&text) {
            Ok(prices) => (prices, None),
            Err(error) => (
                default_prices(),
                Some(format!(
                    "{} is not a valid price table: {error}",
                    path.display()
                )),
            ),
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let prices = default_prices();
            if let Ok(text) = serde_json::to_string_pretty(&prices) {
                let _ = std::fs::write(path, text + "\n");
            }
            (prices, None)
        }
        Err(error) => (
            default_prices(),
            Some(format!("cannot read {}: {error}", path.display())),
        ),
    }
}

pub fn local_days(now_ms: i64, count: usize) -> Vec<DayStart> {
    let mut starts = Vec::with_capacity(count);
    let mut start = local_midnight(now_ms);
    for _ in 0..count {
        let previous = local_midnight(start.0 - 1);
        starts.push(std::mem::replace(&mut start, previous));
    }
    starts.reverse();
    starts
        .into_iter()
        .map(|(start_ms, date)| DayStart { date, start_ms })
        .collect()
}

fn local_midnight(ms: i64) -> (i64, String) {
    let seconds = ms.div_euclid(1000) as libc::time_t;
    let mut tm: libc::tm = unsafe { std::mem::zeroed() };
    unsafe { libc::localtime_r(&seconds, &mut tm) };
    let date = format!(
        "{:04}-{:02}-{:02}",
        tm.tm_year + 1900,
        tm.tm_mon + 1,
        tm.tm_mday
    );
    tm.tm_hour = 0;
    tm.tm_min = 0;
    tm.tm_sec = 0;
    tm.tm_isdst = -1;
    let midnight = unsafe { libc::mktime(&mut tm) };
    (midnight * 1000, date)
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAY0: i64 = 1_790_000_000_000;

    fn assistant_line(id: &str, session: &str, at: &str, model: &str, usage: &str) -> String {
        format!(
            r#"{{"type":"assistant","sessionId":"{session}","cwd":"/work/reef","gitBranch":"fm/reef-7","timestamp":"{at}","message":{{"id":"{id}","model":"{model}","usage":{usage}}}}}"#
        )
    }

    fn user_line(session: &str, content: &str) -> String {
        format!(
            r#"{{"type":"user","sessionId":"{session}","message":{{"role":"user","content":{content}}}}}"#
        )
    }

    fn prompt_line(session: &str, id: &str, at_ms: i64, content: &str) -> String {
        user_line(session, content).replace(
            r#""type":"user""#,
            &format!(
                r#""type":"user","uuid":"{id}","timestamp":"{}""#,
                stamp(at_ms)
            ),
        )
    }

    const USAGE: &str = r#"{"input_tokens":10,"output_tokens":200,"cache_creation_input_tokens":3000,"cache_read_input_tokens":40000,"cache_creation":{"ephemeral_1h_input_tokens":1000,"ephemeral_5m_input_tokens":2000}}"#;

    #[test]
    fn timestamps_parse_as_utc_milliseconds() {
        assert_eq!(parse_timestamp("1970-01-01T00:00:00.000Z"), Some(0));
        assert_eq!(
            parse_timestamp("2026-11-24T22:32:52.368Z"),
            Some(1_795_559_572_368)
        );
        assert_eq!(
            parse_timestamp("2026-11-24T22:32:52Z"),
            Some(1_795_559_572_000)
        );
        assert_eq!(parse_timestamp("yesterday"), None);
    }

    #[test]
    fn assistant_lines_become_usage_and_only_complete_lines_are_consumed() {
        let line = assistant_line(
            "m1",
            "s1",
            "2026-11-24T22:32:52.368Z",
            "claude-opus-5-5[1m]",
            USAGE,
        );
        let text = format!("{line}\n{{\"type\":\"assistant\",\"partial");
        let chunk = parse_chunk(text.as_bytes(), "");
        assert_eq!(chunk.consumed, line.len() + 1);
        let m = &chunk.messages[0];
        assert_eq!(
            (m.id.as_str(), m.session.as_str(), m.model.as_str()),
            ("m1", "s1", "claude-opus-5-5")
        );
        assert_eq!(
            m.usage,
            Usage {
                input: 10,
                output: 200,
                cache_write: 3000,
                cache_write_1h: 1000,
                cache_read: 40000
            }
        );
        assert_eq!(
            (m.cwd.as_str(), m.branch.as_str()),
            ("/work/reef", "fm/reef-7")
        );
    }

    fn tagged(lines: &[String]) -> Vec<String> {
        let chunk = parse_chunk((lines.join("\n") + "\n").as_bytes(), "");
        chunk.messages.iter().map(|m| m.turn.clone()).collect()
    }

    #[test]
    fn a_firstmate_wake_for_a_board_move_tags_the_turn_until_the_note_is_acked() {
        let at = "2026-11-24T10:00:00.000Z";
        let reply = |id: &str| assistant_line(id, "s1", at, "claude-opus-5-5", USAGE);
        let lines = [
            user_line(
                "s1",
                r#"[{"type":"tool_result","content":"check: captain inbox note 17-AbC - Fathom board request: move reef-7 \"Chart\" from deep to landed\nWAKE_ACK_REQUIRED: run drain"}]"#,
            ),
            reply("m1"),
            user_line("s1", r#"[{"type":"tool_result","content":"reef-7 moved"}]"#),
            reply("m2"),
            user_line(
                "s1",
                r#"[{"type":"tool_result","content":"reef-7 | acked 17-AbC"}]"#,
            ),
            reply("m3"),
            user_line(
                "s1",
                r#"[{"type":"tool_result","content":"The note format is `Fathom board request: move ID` (requests.rs)"}]"#,
            ),
            reply("m4"),
        ];
        assert_eq!(tagged(&lines), ["note:17-AbC", "note:17-AbC", "", ""]);
    }

    #[test]
    fn a_new_wake_or_a_new_prompt_ends_a_move_turn() {
        let at = "2026-11-24T10:00:00.000Z";
        let reply = |id: &str| assistant_line(id, "s1", at, "claude-opus-5-5", USAGE);
        let lines = [
            user_line(
                "s1",
                r#"[{"type":"tool_result","content":"inbox note 9-x - Fathom board request: move a from deep to landed"}]"#,
            ),
            reply("m1"),
            user_line(
                "s1",
                r#"[{"type":"tool_result","content":"WAKE_ACK_REQUIRED: another wake"}]"#,
            ),
            reply("m2"),
            user_line(
                "s1",
                r#"[{"type":"tool_result","content":"inbox note 9-y - Fathom board request: move b from deep to landed"}]"#,
            ),
            reply("m3"),
            user_line("s1", r#""what is next?""#),
            reply("m4"),
        ];
        assert_eq!(tagged(&lines), ["note:9-x", "", "note:9-y", ""]);
    }

    #[test]
    fn the_own_backlog_nudge_prompt_tags_the_turn_until_the_next_prompt() {
        let at = "2026-11-24T10:00:00.000Z";
        let reply = |id: &str| assistant_line(id, "s1", at, "claude-opus-5-5", USAGE);
        let lines = [
            prompt_line("s1", "u-1", DAY0, r#""2 board requests waiting""#),
            reply("m1"),
            user_line("s1", r#"[{"type":"tool_result","content":"accepted"}]"#),
            reply("m2"),
            prompt_line("s1", "u-2", DAY0 + 1000, r#""thanks, now chart the reef""#),
            reply("m3"),
        ];
        assert_eq!(tagged(&lines), ["nudge:u-1", "nudge:u-1", ""]);
        let chunk = parse_chunk((lines.join("\n") + "\n").as_bytes(), "");
        let asked: Vec<(&str, &str, i64)> = chunk
            .prompts
            .iter()
            .map(|p| (p.id.as_str(), p.session.as_str(), p.at_ms))
            .collect();
        assert_eq!(asked, [("u-1", "s1", DAY0), ("u-2", "s1", DAY0 + 1000)]);
    }

    #[test]
    fn cost_weights_each_kind_of_token_by_its_price() {
        let usage = Usage {
            input: 1_000_000,
            output: 1_000_000,
            cache_write: 3_000_000,
            cache_write_1h: 1_000_000,
            cache_read: 10_000_000,
        };
        let price = default_prices()["claude-opus-5-5"];
        assert!(
            (usage.cost(Some(&price)).total() - (4.0 + 20.0 + 2.0 * 5.0 + 8.0 + 10.0 * 0.2)).abs()
                < 1e-9
        );
        let costs = usage.cost(Some(&price));
        assert_eq!(
            (costs.input, costs.output, costs.cache_write),
            (4.0, 20.0, 18.0)
        );
        assert_eq!(usage.cost(None).total(), 0.0);
        let prices = default_prices();
        assert_eq!(
            price_for(&prices, "claude-haiku-4-5-20251001"),
            prices.get("claude-haiku-4-5")
        );
        assert_eq!(
            price_for(&prices, "claude-opus-5-5"),
            prices.get("claude-opus-5-5")
        );
        assert!(price_for(&prices, "gpt-9").is_none());
    }

    fn no_repo(_: &Path) -> bool {
        false
    }

    fn session(cwd: &str, branch: &str, repo: &str) -> Session {
        Session {
            cwd: cwd.into(),
            branch: branch.into(),
            repo: repo.into(),
        }
    }

    #[test]
    fn a_session_belongs_to_the_repository_that_contains_its_folder() {
        let repos = ["/pool/2/fathom", "/home/mate"];
        let is_repo = |p: &Path| repos.iter().any(|r| Path::new(r) == p);
        assert_eq!(
            repo_root("/pool/2/fathom/src-tauri/src", &is_repo),
            "/pool/2/fathom"
        );
        assert_eq!(repo_root("/tmp/scratch", &is_repo), "");

        let sessions: HashMap<String, Session> = [
            (
                "root",
                session("/pool/2/fathom", "fm/reef-7", "/pool/2/fathom"),
            ),
            (
                "sub",
                session("/pool/2/fathom/src-tauri", "", "/pool/2/fathom"),
            ),
            ("gone", session("/pool/2/fathom/old/deleted", "", "")),
            ("mate", session("/home/mate", "main", "/home/mate")),
            ("loose", session("/tmp/scratch", "", "")),
            (
                "review",
                session("/u/.no-mistakes/worktrees/abc/run1", "fm/reef-7", ""),
            ),
            (
                "orphan",
                session("/u/.no-mistakes/worktrees/abc/run2", "fm/lost", ""),
            ),
            ("tide", session("/pool/5/tide", "HEAD", "/pool/5/tide")),
            (
                "detached",
                session("/u/.no-mistakes/worktrees/abc/run3", "HEAD", ""),
            ),
            ("tide-main", session("/pool/5/tide", "main", "/pool/5/tide")),
            (
                "shared-branch",
                session("/u/.no-mistakes/worktrees/abc/run4", "main", ""),
            ),
        ]
        .into_iter()
        .map(|(id, s)| (id.to_string(), s))
        .collect();
        let found = projects(&sessions);
        assert_eq!(
            [
                "root",
                "sub",
                "gone",
                "mate",
                "loose",
                "review",
                "orphan",
                "detached",
                "shared-branch"
            ]
            .map(|id| found[id].as_str()),
            [
                "fathom",
                "fathom",
                "fathom",
                "mate",
                "scratch",
                "fathom",
                PIPELINE_PROJECT,
                PIPELINE_PROJECT,
                PIPELINE_PROJECT
            ]
        );
    }

    #[test]
    fn a_pipeline_session_belongs_to_the_repository_its_clone_came_from() {
        let home = tempfile::tempdir().unwrap();
        let pipeline = home.path().join(".no-mistakes");
        let clone = |id: &str, config: &str| {
            let dir = pipeline.join(PIPELINE_REPOS).join(format!("{id}.git"));
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(dir.join("config"), config).unwrap();
        };
        clone(
            "abc",
            "[core]\n\tbare = true\n[remote \"fork\"]\n\turl = https://example.com/someone/fork.git\n[remote \"origin\"]\n\turl = https://example.com/reef/tide.git\n",
        );
        clone("def", "[remote \"origin\"]\n\turl = git@example.com:kelp\n");
        clone("ghi", "[core]\n\tbare = true\n");
        let run = |id: &str| {
            let cwd = pipeline
                .join("worktrees")
                .join(id)
                .join("01RUN")
                .join("packages/app");
            session(&cwd.to_string_lossy(), "HEAD", "")
        };
        let sessions: HashMap<String, Session> = [
            ("tide-run", run("abc")),
            ("tide-run-again", run("abc")),
            ("kelp-run", run("def")),
            ("unnamed-run", run("ghi")),
            (
                "fathom",
                session("/pool/2/fathom", "HEAD", "/pool/2/fathom"),
            ),
        ]
        .into_iter()
        .map(|(id, s)| (id.to_string(), s))
        .collect();
        let found = projects(&sessions);
        assert_eq!(
            ["tide-run", "tide-run-again", "kelp-run", "unnamed-run"].map(|id| found[id].as_str()),
            ["tide", "tide", "kelp", PIPELINE_PROJECT]
        );
    }

    #[test]
    fn the_scan_remembers_each_sessions_repository_while_its_folder_exists() {
        let projects_dir = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let mut store = Store::open(&data.path().join(STORE_FILE)).unwrap();
        let today = DAY0 + 29 * MS_PER_DAY;
        write(
            projects_dir.path(),
            "p/one.jsonl",
            &[line(
                "x1",
                "sub",
                "/pool/2/fathom/src-tauri",
                "",
                today,
                "claude-opus-5-5",
                5,
            )],
        );
        let is_repo = |p: &Path| p == Path::new("/pool/2/fathom");
        store.scan(projects_dir.path(), today, &is_repo).unwrap();
        assert_eq!(store.sessions().unwrap()["sub"].repo, "/pool/2/fathom");
    }

    fn days() -> Vec<DayStart> {
        (0..DAYS as i64)
            .map(|i| DayStart {
                date: format!("d{i}"),
                start_ms: DAY0 + i * MS_PER_DAY,
            })
            .collect()
    }

    fn stamp(ms: i64) -> String {
        let seconds = ms / 1000;
        let days = seconds.div_euclid(86_400);
        let (y, m, d) = civil_from_days(days);
        let rest = seconds.rem_euclid(86_400);
        format!(
            "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.000Z",
            rest / 3600,
            rest % 3600 / 60,
            rest % 60
        )
    }

    fn civil_from_days(z: i64) -> (i64, i64, i64) {
        let z = z + 719_468;
        let era = z.div_euclid(146_097);
        let doe = z - era * 146_097;
        let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        let mp = (5 * doy + 2) / 153;
        let d = doy - (153 * mp + 2) / 5 + 1;
        let m = if mp < 10 { mp + 3 } else { mp - 9 };
        (yoe + era * 400 + i64::from(m <= 2), m, d)
    }

    fn write(dir: &Path, name: &str, lines: &[String]) -> PathBuf {
        let path = dir.join(name);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, lines.join("\n") + "\n").unwrap();
        path
    }

    fn line(
        id: &str,
        session: &str,
        cwd: &str,
        branch: &str,
        at_ms: i64,
        model: &str,
        tokens: u64,
    ) -> String {
        format!(
            r#"{{"type":"assistant","sessionId":"{session}","cwd":"{cwd}","gitBranch":"{branch}","timestamp":"{}","message":{{"id":"{id}","model":"{model}","usage":{{"input_tokens":0,"output_tokens":0,"cache_creation_input_tokens":0,"cache_read_input_tokens":{tokens}}}}}}}"#,
            stamp(at_ms)
        )
    }

    #[test]
    fn the_store_reads_files_incrementally_dedupes_and_groups_sessions() {
        let projects = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let mut store = Store::open(&data.path().join(STORE_FILE)).unwrap();
        let today = DAY0 + 29 * MS_PER_DAY + 3_600_000;
        let lines = vec![
            line(
                "a1",
                "orch",
                "/home/mate",
                "main",
                today,
                "claude-opus-5-5",
                600,
            ),
            line(
                "a1",
                "orch",
                "/home/mate",
                "main",
                today,
                "claude-opus-5-5",
                600,
            ),
            line(
                "w1",
                "crew",
                "/pool/2/reef",
                "fm/reef-7",
                today,
                "claude-sonnet-5-5",
                300,
            ),
            line(
                "b1",
                "bosun",
                "/data/bosun",
                "",
                today,
                "claude-haiku-5-5",
                50,
            ),
            line(
                "old",
                "orch",
                "/home/mate",
                "main",
                DAY0 - 2 * MS_PER_DAY,
                "claude-opus-5-5",
                999,
            ),
        ];
        let file = write(projects.path(), "p/one.jsonl", &lines);
        write(
            projects.path(),
            "p/one/subagents/agent-x.jsonl",
            &[line(
                "s1",
                "crew",
                "/pool/2/reef",
                "fm/reef-7",
                DAY0 + 25 * MS_PER_DAY,
                "claude-opus-5-5",
                100,
            )],
        );
        write(
            projects.path(),
            "p/review.jsonl",
            &[line(
                "n1",
                "nm",
                "/u/.no-mistakes/worktrees/abc/run1",
                "fm/reef-7",
                today,
                "claude-opus-5-5",
                40,
            )],
        );
        store.scan(projects.path(), today, &no_repo).unwrap();

        let roles = Roles {
            home: Some("/home/mate".into()),
            chat_folder: None,
            assistant_folder: "/data/bosun".into(),
            titles: HashMap::from([("reef-7".to_string(), "Chart the reef".to_string())]),
        };
        let prices = default_prices();
        let report = report(&store, &roles, &prices, &days(), today).unwrap();
        assert_eq!(report.days[29].cache_read, 600 + 300 + 50 + 40);
        assert_eq!(report.days[25].cache_read, 100);
        assert_eq!(report.days.iter().map(|d| d.cache_read).sum::<u64>(), 1090);
        let consumers: Vec<(Role, &str, u64)> = report
            .consumers
            .iter()
            .map(|c| (c.role.clone(), c.name.as_str(), c.tokens))
            .collect();
        assert_eq!(
            consumers,
            [
                (Role::Orchestrator, "Orchestrator", 600),
                (Role::Worker, "Chart the reef", 440),
                (Role::Assistant, "Board assistant", 50),
            ]
        );
        let projects_seen: Vec<(&str, u64)> = report
            .projects
            .iter()
            .map(|p| (p.name.as_str(), p.tokens))
            .collect();
        assert_eq!(projects_seen, [("mate", 600), ("reef", 440), ("bosun", 50)]);
        assert_eq!(report.overhead.assistant_tokens, 50);
        assert_eq!(report.overhead.week_tokens, 1090);
        assert!(report.unpriced.is_empty());

        let more = line(
            "a2",
            "orch",
            "/home/mate",
            "main",
            today + 1000,
            "claude-opus-5-5",
            7,
        );
        let mut file_handle = std::fs::OpenOptions::new()
            .append(true)
            .open(&file)
            .unwrap();
        std::io::Write::write_all(&mut file_handle, format!("{more}\n").as_bytes()).unwrap();
        store.scan(projects.path(), today + 2000, &no_repo).unwrap();
        let again = super::report(&store, &roles, &prices, &days(), today + 2000).unwrap();
        assert_eq!(again.days[29].cache_read, 990 + 7);
    }

    #[test]
    fn move_turns_count_only_in_the_orchestrators_sessions() {
        let projects = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let mut store = Store::open(&data.path().join(STORE_FILE)).unwrap();
        let today = DAY0 + 29 * MS_PER_DAY;
        let wake = |session: &str| {
            user_line(
                session,
                r#"[{"type":"tool_result","content":"inbox note 5-q - Fathom board request: move a from deep to landed"}]"#,
            )
        };
        write(
            projects.path(),
            "p/orch.jsonl",
            &[
                wake("orch"),
                line(
                    "o1",
                    "orch",
                    "/home/mate",
                    "main",
                    today,
                    "claude-opus-5-5",
                    70,
                ),
            ],
        );
        write(
            projects.path(),
            "p/crew.jsonl",
            &[
                wake("crew"),
                line(
                    "c1",
                    "crew",
                    "/pool/1/reef",
                    "fm/reef-7",
                    today,
                    "claude-opus-5-5",
                    30,
                ),
            ],
        );
        store.scan(projects.path(), today, &no_repo).unwrap();
        let roles = Roles {
            home: Some("/home/mate".into()),
            assistant_folder: "/data/bosun".into(),
            ..Roles::default()
        };
        let report = report(&store, &roles, &default_prices(), &days(), today).unwrap();
        let roles_seen: Vec<(Role, u64)> = report
            .consumers
            .iter()
            .map(|c| (c.role.clone(), c.tokens))
            .collect();
        assert_eq!(roles_seen, [(Role::Move, 70), (Role::Worker, 30)]);
        assert_eq!(report.overhead.move_requests, [70]);
        assert_eq!(report.overhead.week_overhead_tokens, 70);
    }

    fn assistant_day(projects: &Path, today: i64) {
        let earlier = DAY0 - MS_PER_DAY / 2;
        let ask = |id: &str, at: i64| prompt_line("bosun", id, at, r#""where is reef-7?""#);
        let answer = |id: &str, at: i64, tokens: u64| {
            line(
                id,
                "bosun",
                "/data/bosun",
                "",
                at,
                "claude-haiku-5-5",
                tokens,
            )
        };
        write(
            projects,
            "p/bosun.jsonl",
            &[
                ask("q1", earlier),
                answer("a1", earlier, 6_000),
                ask("q2", earlier),
                answer("a2", earlier, 6_000),
                ask("q3", today),
                answer("a3", today, 100),
                ask("q4", today),
                answer("a4", today, 300),
            ],
        );
    }

    fn assistant_overhead(store: &Store, today: i64) -> (u64, u64) {
        let roles = Roles {
            assistant_folder: "/data/bosun".into(),
            ..Roles::default()
        };
        let report = report(store, &roles, &default_prices(), &days(), today).unwrap();
        (
            report.overhead.assistant_tokens,
            report.overhead.assistant_questions,
        )
    }

    #[test]
    fn the_assistant_counts_only_the_questions_asked_in_the_days_its_tokens_cover() {
        let projects = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let mut store = Store::open(&data.path().join(STORE_FILE)).unwrap();
        let today = DAY0 + 29 * MS_PER_DAY;
        assistant_day(projects.path(), today);
        store.scan(projects.path(), today, &no_repo).unwrap();
        assert_eq!(assistant_overhead(&store, today), (400, 2));
    }

    #[test]
    fn a_store_read_before_questions_had_times_learns_them_from_what_it_already_read() {
        let projects = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let mut store = Store::open(&data.path().join(STORE_FILE)).unwrap();
        let today = DAY0 + 29 * MS_PER_DAY;
        assistant_day(projects.path(), today);
        store.scan(projects.path(), today, &no_repo).unwrap();
        store
            .conn
            .execute_batch("DELETE FROM prompts; PRAGMA user_version = 0;")
            .unwrap();
        store.scan(projects.path(), today, &no_repo).unwrap();
        assert_eq!(assistant_overhead(&store, today), (400, 2));
        store.scan(projects.path(), today, &no_repo).unwrap();
        assert_eq!(assistant_overhead(&store, today), (400, 2));
    }

    #[test]
    fn a_missing_price_table_is_written_with_defaults_and_a_broken_one_reports_an_error() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(PRICES_FILE);
        let (prices, error) = load_prices(&path);
        assert!(error.is_none());
        assert_eq!(prices, default_prices());
        assert_eq!(load_prices(&path).0, default_prices());
        std::fs::write(&path, "{ not json").unwrap();
        let (prices, error) = load_prices(&path);
        assert_eq!(prices, default_prices());
        assert!(error.unwrap().contains("not a valid price table"));
    }

    #[test]
    fn local_days_are_consecutive_midnights_ending_today() {
        let now = 1_795_559_572_368;
        let days = local_days(now, DAYS);
        assert_eq!(days.len(), DAYS);
        assert!(days[DAYS - 1].start_ms <= now && now - days[DAYS - 1].start_ms < MS_PER_DAY);
        for pair in days.windows(2) {
            let gap = pair[1].start_ms - pair[0].start_ms;
            assert!((MS_PER_DAY - 3_600_000..=MS_PER_DAY + 3_600_000).contains(&gap));
            assert_ne!(pair[0].date, pair[1].date);
        }
    }
}
