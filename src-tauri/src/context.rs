use std::collections::HashMap;
use std::fs::{self, Metadata};
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

use base64::Engine;
use serde::Serialize;

use crate::source::Source;

const STATE_DIR: &str = "state";
const DATA_DIR: &str = "data";
const STATUS_EXTENSION: &str = "status";
const META_EXTENSION: &str = "meta";
const ARCHIVED_LOG: &str = "status";
const ARCHIVED_LOG_EXTENSION: &str = "log";
const RECORDED_PR_KEY: &str = "pr";
const MAX_FOLDER_ENTRIES: usize = 200;
const MAX_MENTIONS: usize = 200;
const SNIFF_BYTES: usize = 4096;
pub const TEXT_PREVIEW_BYTES: u64 = 256 * 1024;
pub const IMAGE_PREVIEW_BYTES: u64 = 12 * 1024 * 1024;

const MARKDOWN_EXTENSIONS: [&str; 3] = ["md", "markdown", "mdx"];
const TEXT_EXTENSIONS: [&str; 30] = [
    "txt", "log", "json", "jsonl", "yaml", "yml", "toml", "csv", "tsv", "ini", "conf", "cfg", "sh",
    "bash", "zsh", "ts", "tsx", "js", "jsx", "mjs", "rs", "py", "go", "sql", "diff", "patch",
    "xml", "css", "status", "msg",
];
const IMAGE_TYPES: [(&str, &str); 8] = [
    ("png", "image/png"),
    ("jpg", "image/jpeg"),
    ("jpeg", "image/jpeg"),
    ("gif", "image/gif"),
    ("webp", "image/webp"),
    ("svg", "image/svg+xml"),
    ("bmp", "image/bmp"),
    ("avif", "image/avif"),
];
const HTML_EXTENSIONS: [&str; 2] = ["html", "htm"];

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CardContext {
    pub has_home: bool,
    pub recorded_pr: Option<String>,
    pub activity: Vec<StatusEntry>,
    pub task_folder: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusEntry {
    pub state: String,
    pub at_ms: Option<i64>,
    pub key: Option<String>,
    pub text: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PreviewKind {
    Markdown,
    Text,
    Image,
    Html,
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EntryKind {
    File,
    Folder,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub path: String,
    pub name: String,
    pub folder: String,
    pub kind: EntryKind,
    pub preview: PreviewKind,
    pub size: Option<u64>,
    pub modified_ms: Option<i64>,
    pub in_task_folder: bool,
    pub mentions: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub kind: PreviewKind,
    pub text: Option<String>,
    pub data_url: Option<String>,
    pub truncated: bool,
    pub size: u64,
}

pub struct Places<'a> {
    pub home: &'a Path,
    pub user_home: Option<&'a Path>,
}

pub fn card_context(source: &Source, id: &str) -> Result<CardContext, String> {
    let Source::Firstmate { home } = source else {
        return Ok(CardContext {
            has_home: false,
            recorded_pr: None,
            activity: vec![],
            task_folder: None,
        });
    };
    let id = checked_id(id)?;
    let folder = task_folder(home, id);
    Ok(CardContext {
        has_home: true,
        recorded_pr: fs::read_to_string(
            home.join(STATE_DIR).join(format!("{id}.{META_EXTENSION}")),
        )
        .ok()
        .and_then(|meta| recorded_pr(&meta)),
        activity: read_activity(home, id),
        task_folder: folder.is_dir().then(|| format!("{DATA_DIR}/{id}")),
    })
}

pub fn card_files(
    places: &Places,
    id: &str,
    mentioned: &[String],
) -> Result<Vec<FileEntry>, String> {
    let id = checked_id(id)?;
    let folder = task_folder(places.home, id);
    let folder_key = fs::canonicalize(&folder).ok();
    let mut entries = list_folder(places, &folder);
    let mut index: HashMap<PathBuf, usize> = entries
        .iter()
        .enumerate()
        .filter_map(|(i, e)| Some((fs::canonicalize(&e.path).ok()?, i)))
        .collect();
    for raw in mentioned.iter().take(MAX_MENTIONS) {
        let Some(path) = resolve(places, raw) else {
            continue;
        };
        let Ok(key) = fs::canonicalize(&path) else {
            continue;
        };
        if Some(&key) == folder_key.as_ref() {
            continue;
        }
        if let Some(&i) = index.get(&key) {
            push_mention(&mut entries[i], raw);
            continue;
        }
        let Ok(meta) = fs::metadata(&path) else {
            continue;
        };
        let mut entry = entry_for(places, &path, &meta);
        entry.in_task_folder = folder_key.as_ref().is_some_and(|f| key.starts_with(f));
        push_mention(&mut entry, raw);
        index.insert(key, entries.len());
        entries.push(entry);
    }
    Ok(entries)
}

pub fn preview(path: &Path) -> Result<Preview, String> {
    let meta = fs::metadata(path).map_err(|e| format!("cannot read {}: {e}", path.display()))?;
    if !meta.is_file() {
        return Err(format!("{} is not a file", path.display()));
    }
    let size = meta.len();
    match preview_kind(path, &meta) {
        kind @ (PreviewKind::Markdown | PreviewKind::Text) => {
            let (text, truncated) = read_text(path, TEXT_PREVIEW_BYTES)?;
            Ok(Preview {
                kind,
                text: Some(text),
                data_url: None,
                truncated,
                size,
            })
        }
        PreviewKind::Image => {
            if size > IMAGE_PREVIEW_BYTES {
                return Err(format!(
                    "this image is {} MB, too large to preview here; open it instead",
                    size / (1024 * 1024)
                ));
            }
            let bytes =
                fs::read(path).map_err(|e| format!("cannot read {}: {e}", path.display()))?;
            let mime = image_mime(path).unwrap_or("application/octet-stream");
            Ok(Preview {
                kind: PreviewKind::Image,
                text: None,
                data_url: Some(format!(
                    "data:{mime};base64,{}",
                    base64::engine::general_purpose::STANDARD.encode(bytes)
                )),
                truncated: false,
                size,
            })
        }
        PreviewKind::Html | PreviewKind::None => {
            Err("this file opens in its default app, not inside Fathom".into())
        }
    }
}

pub fn existing_path(raw: &str, user_home: Option<&Path>) -> Result<PathBuf, String> {
    let path = match (raw.strip_prefix("~/"), user_home) {
        (Some(rest), Some(home)) => home.join(rest),
        _ => PathBuf::from(raw),
    };
    if !path.is_absolute() {
        return Err(format!("{raw} is not a full path"));
    }
    if !path.exists() {
        return Err(format!("{raw} no longer exists"));
    }
    Ok(path)
}

pub fn parse_status_log(log: &str) -> Vec<StatusEntry> {
    log.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(parse_status_line)
        .collect()
}

pub fn parse_status_line(line: &str) -> StatusEntry {
    let plain = || StatusEntry {
        state: String::new(),
        at_ms: None,
        key: None,
        text: line.to_string(),
    };
    let Some((head, text)) = line.split_once(':') else {
        return plain();
    };
    let (state, mut tags) = head
        .split_once('[')
        .map_or((head, ""), |(s, rest)| (s, rest));
    let state = state.trim();
    let valid_state = !state.is_empty()
        && state
            .chars()
            .all(|c| c.is_ascii_lowercase() || c == '-' || c == '_');
    if !valid_state || (!tags.is_empty() && !head.trim_end().ends_with(']')) {
        return plain();
    }
    let mut at_ms = None;
    let mut key = None;
    while let Some((tag, rest)) = tags.split_once(']') {
        if let Some((name, value)) = tag.split_once('=') {
            match name.trim() {
                "at" => at_ms = value.trim().parse::<i64>().ok().map(|s| s * 1000),
                "key" => key = Some(value.trim().to_string()).filter(|k| !k.is_empty()),
                _ => {}
            }
        }
        tags = rest.trim_start().strip_prefix('[').unwrap_or("");
    }
    StatusEntry {
        state: state.to_string(),
        at_ms,
        key,
        text: text.trim().to_string(),
    }
}

pub fn recorded_pr(meta: &str) -> Option<String> {
    meta.lines()
        .filter_map(|line| line.split_once('='))
        .find(|(key, _)| key.trim() == RECORDED_PR_KEY)
        .map(|(_, value)| value.trim().to_string())
        .filter(|value| value.starts_with("https://"))
}

fn checked_id(id: &str) -> Result<&str, String> {
    let safe = !id.is_empty()
        && !id.starts_with('.')
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "._@%+-".contains(c));
    if safe {
        Ok(id)
    } else {
        Err(format!("{id} is not a task id"))
    }
}

fn task_folder(home: &Path, id: &str) -> PathBuf {
    home.join(DATA_DIR).join(id)
}

fn read_activity(home: &Path, id: &str) -> Vec<StatusEntry> {
    let mut logs = archived_logs(&task_folder(home, id));
    logs.push(
        home.join(STATE_DIR)
            .join(format!("{id}.{STATUS_EXTENSION}")),
    );
    let mut entries: Vec<StatusEntry> = logs
        .iter()
        .filter_map(|path| fs::read(path).ok())
        .flat_map(|bytes| parse_status_log(&String::from_utf8_lossy(&bytes)))
        .collect();
    entries.reverse();
    entries
}

fn archived_logs(folder: &Path) -> Vec<PathBuf> {
    let Ok(read) = fs::read_dir(folder) else {
        return vec![];
    };
    let mut numbered: Vec<(u32, PathBuf)> = read
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;
            let middle = name
                .strip_prefix(ARCHIVED_LOG)?
                .strip_suffix(ARCHIVED_LOG_EXTENSION)?
                .strip_suffix('.')?;
            let order = match middle {
                "" => 0,
                n => n.strip_prefix('.')?.parse::<u32>().ok()? + 1,
            };
            entry
                .file_type()
                .is_ok_and(|t| t.is_file())
                .then(|| (order, entry.path()))
        })
        .collect();
    numbered.sort();
    numbered.into_iter().map(|(_, path)| path).collect()
}

fn list_folder(places: &Places, folder: &Path) -> Vec<FileEntry> {
    let Ok(read) = fs::read_dir(folder) else {
        return vec![];
    };
    let mut entries: Vec<FileEntry> = read
        .flatten()
        .filter(|entry| !entry.file_name().to_string_lossy().starts_with('.'))
        .filter_map(|entry| {
            let path = entry.path();
            let meta = fs::metadata(&path).ok()?;
            let mut file = entry_for(places, &path, &meta);
            file.in_task_folder = true;
            Some(file)
        })
        .collect();
    entries.sort_by(|a, b| {
        (a.kind == EntryKind::Folder)
            .cmp(&(b.kind == EntryKind::Folder))
            .then(b.modified_ms.cmp(&a.modified_ms))
            .then(a.name.cmp(&b.name))
    });
    entries.truncate(MAX_FOLDER_ENTRIES);
    entries
}

fn entry_for(places: &Places, path: &Path, meta: &Metadata) -> FileEntry {
    let folder = meta.is_dir();
    FileEntry {
        path: path.display().to_string(),
        name: path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.display().to_string()),
        folder: path
            .parent()
            .map(|parent| display_folder(places, parent))
            .unwrap_or_default(),
        kind: if folder {
            EntryKind::Folder
        } else {
            EntryKind::File
        },
        preview: if folder {
            PreviewKind::None
        } else {
            preview_kind(path, meta)
        },
        size: (!folder).then_some(meta.len()),
        modified_ms: meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64),
        in_task_folder: false,
        mentions: vec![],
    }
}

fn push_mention(entry: &mut FileEntry, raw: &str) {
    if !entry.mentions.iter().any(|m| m == raw) {
        entry.mentions.push(raw.to_string());
    }
}

fn resolve(places: &Places, raw: &str) -> Option<PathBuf> {
    let raw = raw.trim();
    if raw.is_empty() || raw.contains('\0') {
        return None;
    }
    let path = if raw == "~" {
        places.user_home?.to_path_buf()
    } else if let Some(rest) = raw.strip_prefix("~/") {
        places.user_home?.join(rest)
    } else if raw.starts_with('/') {
        PathBuf::from(raw)
    } else {
        places.home.join(raw)
    };
    let climbs = path.components().any(|c| c == Component::ParentDir);
    (!climbs).then_some(path)
}

fn display_folder(places: &Places, dir: &Path) -> String {
    if let Ok(inside) = dir.strip_prefix(places.home) {
        return inside.display().to_string();
    }
    if let Some(Ok(inside)) = places.user_home.map(|home| dir.strip_prefix(home)) {
        return if inside.as_os_str().is_empty() {
            "~".into()
        } else {
            format!("~/{}", inside.display())
        };
    }
    dir.display().to_string()
}

fn extension(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
}

fn image_mime(path: &Path) -> Option<&'static str> {
    let ext = extension(path)?;
    IMAGE_TYPES
        .iter()
        .find(|(e, _)| *e == ext)
        .map(|(_, mime)| *mime)
}

pub fn preview_kind(path: &Path, meta: &Metadata) -> PreviewKind {
    match extension(path) {
        Some(ext) if MARKDOWN_EXTENSIONS.contains(&ext.as_str()) => PreviewKind::Markdown,
        Some(ext) if TEXT_EXTENSIONS.contains(&ext.as_str()) => PreviewKind::Text,
        Some(ext) if HTML_EXTENSIONS.contains(&ext.as_str()) => PreviewKind::Html,
        Some(_) if image_mime(path).is_some() => PreviewKind::Image,
        Some(_) => PreviewKind::None,
        None if meta.is_file() && looks_like_text(path) => PreviewKind::Text,
        None => PreviewKind::None,
    }
}

fn looks_like_text(path: &Path) -> bool {
    let mut head = Vec::with_capacity(SNIFF_BYTES);
    let read = fs::File::open(path).and_then(|f| f.take(SNIFF_BYTES as u64).read_to_end(&mut head));
    read.is_ok()
        && !head.contains(&0)
        && std::str::from_utf8(&head).map_or_else(|e| e.error_len().is_none(), |_| true)
}

fn read_text(path: &Path, limit: u64) -> Result<(String, bool), String> {
    let file = fs::File::open(path).map_err(|e| format!("cannot read {}: {e}", path.display()))?;
    let mut bytes = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("cannot read {}: {e}", path.display()))?;
    let truncated = bytes.len() as u64 > limit;
    bytes.truncate(limit as usize);
    let text = String::from_utf8_lossy(&bytes);
    let text = if truncated {
        text.trim_end_matches('\u{FFFD}').to_string()
    } else {
        text.into_owned()
    };
    Ok((text, truncated))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(path: &Path, text: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    #[test]
    fn existing_paths_expand_the_home_and_must_exist() {
        let fx = Fixture::new();
        let note = fx.user.join("notes/plan.md");
        write(&note, "plan");
        let user = Some(fx.user.as_path());
        assert_eq!(existing_path("~/notes/plan.md", user).unwrap(), note);
        assert_eq!(existing_path(note.to_str().unwrap(), None).unwrap(), note);
        assert!(existing_path("notes/plan.md", user).is_err());
        assert!(existing_path("~/notes/gone.md", user).is_err());
        assert!(existing_path("~/notes/plan.md", None).is_err());
    }

    struct Fixture {
        _root: tempfile::TempDir,
        home: PathBuf,
        user: PathBuf,
    }

    impl Fixture {
        fn new() -> Fixture {
            let root = tempfile::tempdir().unwrap();
            let user = root.path().join("sailor");
            let home = user.join("firstmate");
            fs::create_dir_all(home.join(STATE_DIR)).unwrap();
            Fixture {
                _root: root,
                home,
                user,
            }
        }

        fn places(&self) -> Places<'_> {
            Places {
                home: &self.home,
                user_home: Some(&self.user),
            }
        }

        fn source(&self) -> Source {
            Source::of(&self.home.display().to_string())
        }
    }

    #[test]
    fn status_lines_split_into_state_time_key_and_text() {
        assert_eq!(
            parse_status_line("working [at=1795100000]: tests pass: 12 of 12"),
            StatusEntry {
                state: "working".into(),
                at_ms: Some(1_795_100_000_000),
                key: None,
                text: "tests pass: 12 of 12".into(),
            }
        );
        let decision =
            parse_status_line("needs-decision [at=1795100900] [key=rollout]: pick A or B");
        assert_eq!(decision.state, "needs-decision");
        assert_eq!(decision.key.as_deref(), Some("rollout"));
        assert_eq!(decision.text, "pick A or B");

        let bare = parse_status_line("done: PR https://example.com/pull/3");
        assert_eq!(bare.state, "done");
        assert_eq!(bare.at_ms, None);
        assert_eq!(bare.text, "PR https://example.com/pull/3");

        let odd = parse_status_line("worker restarted at 10:42 after a crash");
        assert_eq!(odd.state, "");
        assert_eq!(odd.text, "worker restarted at 10:42 after a crash");

        let bad_time = parse_status_line("paused [at=<epoch>]: waiting on CI");
        assert_eq!(bad_time.state, "paused");
        assert_eq!(bad_time.at_ms, None);
    }

    #[test]
    fn a_status_log_skips_blank_lines() {
        let log = "working [at=1]: setup done\n\n  \ndone [at=2]: PR ready\n";
        let entries = parse_status_log(log);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[1].state, "done");
    }

    #[test]
    fn activity_reads_archived_logs_then_the_live_log_newest_first() {
        let f = Fixture::new();
        let data = f.home.join(DATA_DIR).join("atl-12");
        write(&data.join("status.log"), "working [at=1]: first run\n");
        write(&data.join("status.1.log"), "working [at=2]: second run\n");
        write(
            &data.join("status.notes.log"),
            "working [at=9]: not a log\n",
        );
        write(
            &f.home.join(STATE_DIR).join("atl-12.status"),
            "working [at=3]: live\nblocked [at=4]: needs a key\n",
        );
        let context = card_context(&f.source(), "atl-12").unwrap();
        let texts: Vec<&str> = context.activity.iter().map(|e| e.text.as_str()).collect();
        assert_eq!(texts, ["needs a key", "live", "second run", "first run"]);
        assert_eq!(context.task_folder.as_deref(), Some("data/atl-12"));
        assert!(context.has_home);
    }

    #[test]
    fn the_recorded_pull_request_comes_from_the_meta_file() {
        assert_eq!(
            recorded_pr("kind=ship\npr=https://github.com/example/atlas-api/pull/418\n"),
            Some("https://github.com/example/atlas-api/pull/418".into())
        );
        assert_eq!(recorded_pr("pr=\nkind=ship"), None);
        assert_eq!(recorded_pr("pr_head=abc"), None);

        let f = Fixture::new();
        write(
            &f.home.join(STATE_DIR).join("atl-15.meta"),
            "pr=https://github.com/example/atlas-api/pull/9\n",
        );
        let context = card_context(&f.source(), "atl-15").unwrap();
        assert_eq!(
            context.recorded_pr.as_deref(),
            Some("https://github.com/example/atlas-api/pull/9")
        );
        assert!(context.activity.is_empty());
        assert_eq!(context.task_folder, None);
    }

    #[test]
    fn the_backlog_has_no_home_context_and_unsafe_ids_are_refused() {
        let context = card_context(&Source::Backlog, "12").unwrap();
        assert!(!context.has_home);
        let f = Fixture::new();
        assert!(card_context(&f.source(), "..").is_err());
        assert!(card_context(&f.source(), "a/b").is_err());
        assert!(card_files(&f.places(), "../x", &[]).is_err());
    }

    #[test]
    fn files_list_the_task_folder_then_existing_mentioned_files() {
        let f = Fixture::new();
        let data = f.home.join(DATA_DIR).join("atl-03");
        write(&data.join("report.md"), "# Report\n");
        write(&data.join(".hidden"), "x");
        fs::create_dir_all(data.join("shots")).unwrap();
        write(&f.user.join("exports/review.md"), "review");
        write(&f.home.join("data/other-task/notes.txt"), "notes");
        write(&f.user.join("pictures/after.png"), "png");

        let mentioned: Vec<String> = [
            "data/atl-03/report.md",
            "~/exports/review.md",
            "data/other-task/notes.txt",
            &f.user.join("pictures/after.png").display().to_string(),
            "~/exports/missing.md",
            "data/atl-03",
            "../escape.txt",
            "~/exports/review.md",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        let files = card_files(&f.places(), "atl-03", &mentioned).unwrap();
        let names: Vec<&str> = files.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(
            names,
            ["report.md", "shots", "review.md", "notes.txt", "after.png"]
        );

        let report = &files[0];
        assert!(report.in_task_folder);
        assert_eq!(report.folder, "data/atl-03");
        assert_eq!(report.preview, PreviewKind::Markdown);
        assert_eq!(report.size, Some(9));
        assert_eq!(report.mentions, ["data/atl-03/report.md"]);

        assert_eq!(files[1].kind, EntryKind::Folder);
        assert_eq!(files[1].size, None);
        assert_eq!(files[2].folder, "~/exports");
        assert_eq!(files[2].mentions, ["~/exports/review.md"]);
        assert!(!files[2].in_task_folder);
        assert_eq!(files[3].folder, "data/other-task");
        assert_eq!(files[4].preview, PreviewKind::Image);
    }

    #[test]
    fn previews_read_text_truncate_large_files_and_refuse_html() {
        let f = Fixture::new();
        let note = f.user.join("note.md");
        write(&note, "# Title\n\nBody");
        let shown = preview(&note).unwrap();
        assert_eq!(shown.kind, PreviewKind::Markdown);
        assert_eq!(shown.text.as_deref(), Some("# Title\n\nBody"));
        assert!(!shown.truncated);

        let big = f.user.join("big.log");
        write(&big, &"é".repeat(TEXT_PREVIEW_BYTES as usize));
        let cut = preview(&big).unwrap();
        assert!(cut.truncated);
        assert!(cut.text.unwrap().len() <= TEXT_PREVIEW_BYTES as usize);

        let page = f.user.join("report.html");
        write(&page, "<script>alert(1)</script>");
        assert!(preview(&page).is_err());

        let image = f.user.join("dot.png");
        fs::write(&image, [0x89, b'P', b'N', b'G']).unwrap();
        let shown = preview(&image).unwrap();
        assert_eq!(
            shown.data_url.as_deref(),
            Some("data:image/png;base64,iVBORw==")
        );
    }

    #[test]
    fn files_without_an_extension_preview_as_text_only_when_they_look_like_text() {
        let f = Fixture::new();
        let plain = f.user.join("NOTES");
        write(&plain, "plain words");
        let binary = f.user.join("blob");
        fs::write(&binary, [0u8, 159, 146, 150]).unwrap();
        let kind = |p: &Path| preview_kind(p, &fs::metadata(p).unwrap());
        assert_eq!(kind(&plain), PreviewKind::Text);
        assert_eq!(kind(&binary), PreviewKind::None);
    }
}
