mod nautical;
pub mod scheme;

use std::collections::BTreeMap;
use std::ffi::OsString;
use std::fs;
use std::path::{Component, Path, PathBuf};

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

pub use nautical::{duplicate_nautical, nautical_manifest, nautical_tokens};

pub const NAUTICAL: &str = "nautical";
pub const NAUTICAL_NAME: &str = "Nautical";
pub const CONTRACT_VERSION: u32 = 1;
pub const MANIFEST_FILE: &str = "theme.json";
pub const STYLE_FILE: &str = "theme.css";
pub const SHOTS_DIR: &str = ".shots";
pub const GUIDE_FILE: &str = "GUIDE.md";
pub const GUIDE: &str = include_str!("../../../docs/themes.md");
const CONFIG_DIR: &str = ".config";
const APP_CONFIG_DIR: &str = "fathom";
const THEMES_DIR: &str = "themes";
const STORE_DIR: &str = "themes";
const RECORD_EXTENSION: &str = "json";
const MAX_ID_LEN: usize = 48;
const MAX_NAME_LEN: usize = 40;
const MAX_TEXT_LEN: usize = 40;
const MAX_FONT_LEN: usize = 300;
const MAX_FILE_BYTES: u64 = 4 * 1024 * 1024;
const MAX_THEME_BYTES: u64 = 16 * 1024 * 1024;
pub const ART_EXTENSIONS: [&str; 6] = ["svg", "png", "jpg", "jpeg", "gif", "webp"];
pub const ASSET_EXTENSIONS: [&str; 11] = [
    "css", "svg", "png", "jpg", "jpeg", "gif", "webp", "woff", "woff2", "ttf", "otf",
];
const NOTE_EXTENSIONS: [&str; 2] = ["md", "txt"];
const FORBIDDEN_IN_TEXT: [char; 4] = ['<', '>', '\n', '\r'];
const FORBIDDEN_IN_FONT: [&str; 7] = [";", "{", "}", "<", ">", "url(", "\\"];

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, JsonSchema,
)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Light,
    Dark,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum ChatSide {
    Left,
    #[default]
    Right,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum BoardShape {
    #[default]
    Rows,
    Lanes,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum HeaderPlace {
    #[default]
    Top,
    Rail,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum DetailPlace {
    #[default]
    Side,
    Overlay,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Fonts {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub heading: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mono: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub terminal: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Text {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub brand: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub helper: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub projects: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub surface_lead: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shallows_lead: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Art {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub brand_mark: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sailor: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sailor_active: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Layout {
    #[serde(default)]
    pub chat_side: ChatSide,
    #[serde(default)]
    pub board: BoardShape,
    #[serde(default)]
    pub header: HeaderPlace,
    #[serde(default)]
    pub detail: DetailPlace,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub row_label_width: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub collapsed_width: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lane_width: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rail_width: Option<u32>,
}

pub struct SizeRange {
    pub key: &'static str,
    pub min: u32,
    pub max: u32,
}

pub const SIZE_RANGES: [SizeRange; 4] = [
    SizeRange {
        key: "rowLabelWidth",
        min: 40,
        max: 320,
    },
    SizeRange {
        key: "collapsedWidth",
        min: 32,
        max: 96,
    },
    SizeRange {
        key: "laneWidth",
        min: 180,
        max: 480,
    },
    SizeRange {
        key: "railWidth",
        min: 160,
        max: 360,
    },
];

impl Layout {
    fn sizes(&self) -> [Option<u32>; 4] {
        [
            self.row_label_width,
            self.collapsed_width,
            self.lane_width,
            self.rail_width,
        ]
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Manifest {
    pub fathom_theme: u32,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cloned_from: Option<String>,
    #[serde(default = "both_modes")]
    pub modes: Vec<Mode>,
    #[serde(default)]
    pub fonts: Fonts,
    #[serde(default)]
    pub text: Text,
    #[serde(default)]
    pub art: Art,
    #[serde(default)]
    pub layout: Layout,
}

fn both_modes() -> Vec<Mode> {
    vec![Mode::Light, Mode::Dark]
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    pub problem: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub control: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub part: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub view: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<Mode>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub screenshot: Option<String>,
}

impl Finding {
    pub fn in_file(file: &str, problem: impl Into<String>) -> Finding {
        Finding {
            problem: problem.into(),
            control: None,
            part: None,
            file: Some(file.to_string()),
            view: None,
            mode: None,
            size: None,
            screenshot: None,
        }
    }

    pub fn general(problem: impl Into<String>) -> Finding {
        Finding {
            problem: problem.into(),
            control: None,
            part: None,
            file: None,
            view: None,
            mode: None,
            size: None,
            screenshot: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    pub hash: String,
    pub passed: bool,
    pub findings: Vec<Finding>,
    pub checked_ms: i64,
    #[serde(default)]
    pub good_hash: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum Status {
    BuiltIn,
    Ready,
    ReadyWithChanges,
    Failed,
    Unchecked,
}

#[derive(Debug, Clone, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub id: String,
    pub name: String,
    pub modes: Vec<Mode>,
    pub status: Status,
    pub problems: usize,
    pub usable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cloned_from: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Active {
    pub id: String,
    pub version: String,
    pub manifest: Manifest,
}

pub struct Snapshot {
    pub dir: PathBuf,
    root: PathBuf,
}

impl Drop for Snapshot {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[derive(Debug, Clone)]
pub struct Themes {
    pub root: PathBuf,
    pub store: PathBuf,
}

pub fn config_root(
    os: &str,
    home: Option<PathBuf>,
    xdg_config_home: Option<OsString>,
) -> Option<PathBuf> {
    let xdg = xdg_config_home
        .map(PathBuf::from)
        .filter(|dir| os == "linux" && dir.is_absolute());
    xdg.or_else(|| home.map(|home| home.join(CONFIG_DIR)))
        .map(|config| config.join(APP_CONFIG_DIR).join(THEMES_DIR))
}

pub fn default_root() -> Result<PathBuf, String> {
    config_root(
        std::env::consts::OS,
        std::env::home_dir(),
        std::env::var_os("XDG_CONFIG_HOME"),
    )
    .ok_or_else(|| "cannot find the home folder for themes".to_string())
}

impl Themes {
    pub fn new(root: PathBuf, data_dir: &Path) -> Themes {
        Themes {
            root,
            store: data_dir.join(STORE_DIR),
        }
    }

    pub fn folder(&self, id: &str) -> Result<PathBuf, String> {
        check_id(id)?;
        Ok(self.root.join(id))
    }

    pub fn good_copy(&self, id: &str) -> PathBuf {
        self.store.join(id)
    }

    fn record_file(&self, id: &str) -> PathBuf {
        self.store.join(format!("{id}.{RECORD_EXTENSION}"))
    }

    pub fn record(&self, id: &str) -> Option<Record> {
        let text = fs::read_to_string(self.record_file(id)).ok()?;
        serde_json::from_str(&text).ok()
    }

    pub fn write_guide(&self) -> Result<(), String> {
        fs::create_dir_all(&self.root)
            .map_err(|e| format!("cannot create {}: {e}", self.root.display()))?;
        let path = self.root.join(GUIDE_FILE);
        if fs::read_to_string(&path).is_ok_and(|current| current == GUIDE) {
            return Ok(());
        }
        fs::write(&path, GUIDE).map_err(|e| format!("cannot write {}: {e}", path.display()))
    }

    pub fn ids(&self) -> Vec<String> {
        let Ok(entries) = fs::read_dir(&self.root) else {
            return Vec::new();
        };
        let mut ids: Vec<String> = entries
            .flatten()
            .filter(|e| e.path().join(MANIFEST_FILE).is_file())
            .filter_map(|e| e.file_name().into_string().ok())
            .filter(|id| check_id(id).is_ok())
            .collect();
        ids.sort();
        ids
    }

    pub fn list(&self) -> Vec<Summary> {
        let mut out = vec![nautical_summary()];
        out.extend(self.ids().into_iter().map(|id| self.summary(&id)));
        out
    }

    pub fn summary(&self, id: &str) -> Summary {
        let folder = self.root.join(id);
        let manifest = read_manifest(&folder).ok();
        let record = self.record(id);
        let current = folder_hash(&folder).ok();
        let good = record.as_ref().and_then(|r| r.good_hash.clone());
        let checked = record
            .as_ref()
            .filter(|r| Some(&r.hash) == current.as_ref());
        let status = match (checked, &good) {
            (Some(r), _) if r.passed => Status::Ready,
            (Some(_), _) => Status::Failed,
            (None, Some(_)) => Status::ReadyWithChanges,
            (None, None) => Status::Unchecked,
        };
        Summary {
            id: id.to_string(),
            name: manifest
                .as_ref()
                .map(|m| m.name.clone())
                .unwrap_or_else(|| id.to_string()),
            modes: manifest
                .as_ref()
                .map(|m| m.modes.clone())
                .unwrap_or_else(both_modes),
            status,
            problems: checked.map(|r| r.findings.len()).unwrap_or(0),
            usable: good.is_some(),
            folder: Some(folder.display().to_string()),
            cloned_from: manifest.and_then(|m| m.cloned_from),
        }
    }

    pub fn active(&self, id: &str) -> Option<Active> {
        if id == NAUTICAL
            || check_id(id).is_err()
            || !self.root.join(id).join(MANIFEST_FILE).is_file()
        {
            return None;
        }
        let record = self.record(id)?;
        let version = record.good_hash?;
        let manifest = read_manifest(&self.good_copy(id)).ok()?;
        Some(Active {
            id: id.to_string(),
            version,
            manifest,
        })
    }

    pub fn can_use(&self, id: &str) -> Result<(), String> {
        if id == NAUTICAL {
            return Ok(());
        }
        check_id(id)?;
        if !self.root.join(id).join(MANIFEST_FILE).is_file() {
            return Err(format!("there is no theme called {id}"));
        }
        if self.active(id).is_none() {
            return Err(format!(
                "the theme {id} has not passed its check yet; run the check and fix its problems first"
            ));
        }
        Ok(())
    }

    pub fn snapshot(&self, id: &str, folder: &Path) -> Result<Snapshot, String> {
        let root = self
            .store
            .join(format!(".checking-{}-{id}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let dir = root.join(id);
        fs::create_dir_all(&dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
        copy_theme(folder, &dir)?;
        Ok(Snapshot { dir, root })
    }

    pub fn store_result(
        &self,
        id: &str,
        checked: &Path,
        hash: &str,
        findings: Vec<Finding>,
        now_ms: i64,
    ) -> Result<Record, String> {
        fs::create_dir_all(&self.store)
            .map_err(|e| format!("cannot create {}: {e}", self.store.display()))?;
        let passed = findings.is_empty();
        let previous_good = self.record(id).and_then(|r| r.good_hash);
        let good_hash = if passed {
            self.promote(id, checked)?;
            Some(hash.to_string())
        } else {
            previous_good
        };
        let record = Record {
            hash: hash.to_string(),
            passed,
            findings,
            checked_ms: now_ms,
            good_hash,
        };
        let text = serde_json::to_string_pretty(&record).map_err(|e| e.to_string())?;
        let path = self.record_file(id);
        fs::write(&path, text).map_err(|e| format!("cannot write {}: {e}", path.display()))?;
        Ok(record)
    }

    fn promote(&self, id: &str, checked: &Path) -> Result<(), String> {
        let target = self.good_copy(id);
        let _ = fs::remove_dir_all(&target);
        fs::rename(checked, &target)
            .map_err(|e| format!("cannot keep the checked copy of {id}: {e}"))
    }

    pub fn forget(&self, id: &str) {
        let _ = fs::remove_dir_all(self.good_copy(id));
        let _ = fs::remove_file(self.record_file(id));
    }

    pub fn delete(&self, id: &str) -> Result<(), String> {
        if id == NAUTICAL {
            return Err("Nautical is built in and cannot be deleted".into());
        }
        let folder = self.folder(id)?;
        if !folder.join(MANIFEST_FILE).is_file() {
            return Err(format!("there is no theme called {id}"));
        }
        fs::remove_dir_all(&folder)
            .map_err(|e| format!("cannot delete {}: {e}", folder.display()))?;
        self.forget(id);
        Ok(())
    }

    pub fn free_id(&self, wanted: &str) -> String {
        let base = slug(wanted);
        let taken = |id: &str| id == NAUTICAL || self.root.join(id).exists();
        if !taken(&base) {
            return base;
        }
        (2..)
            .map(|n| format!("{base}-{n}"))
            .find(|id| !taken(id))
            .expect("some numbered id is free")
    }
}

fn nautical_summary() -> Summary {
    Summary {
        id: NAUTICAL.to_string(),
        name: NAUTICAL_NAME.to_string(),
        modes: both_modes(),
        status: Status::BuiltIn,
        problems: 0,
        usable: true,
        folder: None,
        cloned_from: None,
    }
}

pub fn check_id(id: &str) -> Result<(), String> {
    let well_formed = !id.is_empty()
        && id.len() <= MAX_ID_LEN
        && id.starts_with(|c: char| c.is_ascii_lowercase() || c.is_ascii_digit())
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
    if well_formed {
        Ok(())
    } else {
        Err(format!(
            "a theme id is a folder name of lowercase letters, digits and dashes, up to {MAX_ID_LEN} characters, not \"{id}\""
        ))
    }
}

pub fn slug(name: &str) -> String {
    let mut out = String::new();
    for c in name.trim().to_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c);
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
    }
    let trimmed: String = out.trim_matches('-').chars().take(MAX_ID_LEN).collect();
    let trimmed = trimmed.trim_end_matches('-').to_string();
    if trimmed.is_empty() {
        "theme".into()
    } else {
        trimmed
    }
}

pub fn id_of(folder: &Path) -> Result<String, String> {
    let name = folder
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| format!("{} is not a theme folder", folder.display()))?;
    check_id(name)?;
    if name == NAUTICAL {
        return Err("nautical is the built-in theme's id; name the folder something else".into());
    }
    Ok(name.to_string())
}

pub fn read_manifest(folder: &Path) -> Result<Manifest, String> {
    let path = folder.join(MANIFEST_FILE);
    let text =
        fs::read_to_string(&path).map_err(|e| format!("cannot read {}: {e}", path.display()))?;
    parse_manifest(&text)
}

pub fn parse_manifest(text: &str) -> Result<Manifest, String> {
    serde_json::from_str(text).map_err(|e| format!("{MANIFEST_FILE} is not valid: {e}"))
}

pub fn check_folder(folder: &Path) -> (Option<Manifest>, Vec<Finding>) {
    let mut findings = check_files(folder);
    for (name, path) in theme_files(folder) {
        if extension(Path::new(&name)).as_deref() == Some("css")
            && let Ok(css) = fs::read_to_string(&path)
        {
            findings.extend(
                lint_css(&css).into_iter().map(|(line, problem)| {
                    Finding::in_file(&name, format!("line {line}: {problem}"))
                }),
            );
        }
    }
    let manifest = match read_manifest(folder) {
        Ok(manifest) => {
            findings.extend(check_manifest(&manifest, folder));
            Some(manifest)
        }
        Err(problem) => {
            findings.push(Finding::in_file(MANIFEST_FILE, problem));
            None
        }
    };
    if !folder.join(STYLE_FILE).is_file() {
        findings.push(Finding::in_file(
            STYLE_FILE,
            "every theme needs a theme.css, even an empty one",
        ));
    }
    (manifest, findings)
}

pub fn check_manifest(manifest: &Manifest, folder: &Path) -> Vec<Finding> {
    let mut out = Vec::new();
    let mut problem = |text: String| out.push(Finding::in_file(MANIFEST_FILE, text));
    if manifest.fathom_theme != CONTRACT_VERSION {
        problem(format!(
            "fathomTheme is {}, but this Fathom reads contract version {CONTRACT_VERSION}",
            manifest.fathom_theme
        ));
    }
    let name = manifest.name.trim();
    if name.is_empty() || name.chars().count() > MAX_NAME_LEN {
        problem(format!("name must be 1 to {MAX_NAME_LEN} characters"));
    }
    let mut modes = manifest.modes.clone();
    modes.sort();
    modes.dedup();
    if manifest.modes.is_empty() || modes.len() != manifest.modes.len() {
        problem("modes lists light, dark or both, each once".into());
    }
    for (key, font) in font_slots(&manifest.fonts) {
        if let Some(font) = font {
            let bad = FORBIDDEN_IN_FONT.iter().find(|bad| font.contains(*bad));
            if font.trim().is_empty() || font.len() > MAX_FONT_LEN || bad.is_some() {
                problem(format!(
                    "fonts.{key} is a CSS font-family list such as \"Iowan Old Style\", serif, up to {MAX_FONT_LEN} characters, with no ; {{ }} < > url( or \\"
                ));
            }
        }
    }
    for (key, text) in text_slots(&manifest.text) {
        if let Some(text) = text
            && (text.chars().count() > MAX_TEXT_LEN || text.contains(FORBIDDEN_IN_TEXT))
        {
            problem(format!(
                "text.{key} is one line of up to {MAX_TEXT_LEN} characters without < or >"
            ));
        }
    }
    if manifest
        .text
        .helper
        .as_ref()
        .is_some_and(|h| h.trim().is_empty())
    {
        problem("text.helper cannot be empty; leave it out to keep Bosun".into());
    }
    for (key, file) in art_slots(&manifest.art) {
        if let Some(file) = file {
            if let Err(why) = check_asset_path(file, &ART_EXTENSIONS) {
                problem(format!("art.{key}: {why}"));
            } else if !folder.join(file).is_file() {
                problem(format!(
                    "art.{key}: {file} does not exist in the theme folder"
                ));
            }
        }
    }
    if manifest.art.sailor_active.is_some() && manifest.art.sailor.is_none() {
        problem("art.sailorActive needs art.sailor as its base layer".into());
    }
    for (range, value) in SIZE_RANGES.iter().zip(manifest.layout.sizes()) {
        if let Some(value) = value
            && !(range.min..=range.max).contains(&value)
        {
            problem(format!(
                "layout.{} must be between {} and {} pixels",
                range.key, range.min, range.max
            ));
        }
    }
    if manifest.layout.lane_width.is_some() && manifest.layout.board != BoardShape::Lanes {
        problem("layout.laneWidth only applies with layout.board set to lanes".into());
    }
    if manifest.layout.rail_width.is_some() && manifest.layout.header != HeaderPlace::Rail {
        problem("layout.railWidth only applies with layout.header set to rail".into());
    }
    if let Some(source) = &manifest.cloned_from
        && check_id(source).is_err()
    {
        problem("clonedFrom is the id of the theme this one started from".into());
    }
    out
}

fn font_slots(fonts: &Fonts) -> [(&'static str, &Option<String>); 4] {
    [
        ("body", &fonts.body),
        ("heading", &fonts.heading),
        ("mono", &fonts.mono),
        ("terminal", &fonts.terminal),
    ]
}

fn text_slots(text: &Text) -> [(&'static str, &Option<String>); 5] {
    [
        ("brand", &text.brand),
        ("helper", &text.helper),
        ("projects", &text.projects),
        ("surfaceLead", &text.surface_lead),
        ("shallowsLead", &text.shallows_lead),
    ]
}

fn art_slots(art: &Art) -> [(&'static str, &Option<String>); 3] {
    [
        ("brandMark", &art.brand_mark),
        ("sailor", &art.sailor),
        ("sailorActive", &art.sailor_active),
    ]
}

pub fn check_asset_path(file: &str, extensions: &[&str]) -> Result<(), String> {
    let path = Path::new(file);
    let relative =
        path.components().all(|c| matches!(c, Component::Normal(_))) && !file.contains('\\');
    if !relative || file.is_empty() {
        return Err(format!(
            "{file} must be a path inside the theme folder, such as art/mark.svg"
        ));
    }
    if hidden(path) {
        return Err(format!("{file} is a hidden file"));
    }
    match extension(path) {
        Some(ext) if extensions.contains(&ext.as_str()) => Ok(()),
        _ => Err(format!(
            "{file} must be one of these kinds of file: {}",
            extensions.join(", ")
        )),
    }
}

fn hidden(path: &Path) -> bool {
    path.components()
        .any(|c| matches!(c, Component::Normal(name) if name.to_string_lossy().starts_with('.')))
}

fn extension(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
}

pub fn theme_files(folder: &Path) -> Vec<(String, PathBuf)> {
    let mut out = Vec::new();
    collect_files(folder, folder, &mut out);
    out.sort();
    out
}

fn collect_files(root: &Path, dir: &Path, out: &mut Vec<(String, PathBuf)>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(rel) = path.strip_prefix(root) else {
            continue;
        };
        if hidden(rel) {
            continue;
        }
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if kind.is_dir() {
            collect_files(root, &path, out);
        } else if kind.is_file() {
            let name = rel
                .components()
                .map(|c| c.as_os_str().to_string_lossy())
                .collect::<Vec<_>>()
                .join("/");
            out.push((name, path));
        }
    }
}

fn check_files(folder: &Path) -> Vec<Finding> {
    let mut out = Vec::new();
    let mut total = 0;
    for (name, path) in theme_files(folder) {
        let size = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        total += size;
        let allowed = name == MANIFEST_FILE
            || extension(Path::new(&name)).is_some_and(|ext| {
                ASSET_EXTENSIONS.contains(&ext.as_str()) || NOTE_EXTENSIONS.contains(&ext.as_str())
            });
        if !allowed {
            out.push(Finding::in_file(
                &name,
                format!(
                    "themes hold data, never code: only theme.json, notes ({}) and these assets are allowed: {}",
                    NOTE_EXTENSIONS.join(", "),
                    ASSET_EXTENSIONS.join(", ")
                ),
            ));
        }
        if size > MAX_FILE_BYTES {
            out.push(Finding::in_file(
                &name,
                format!("{name} is larger than {} MB", MAX_FILE_BYTES / 1024 / 1024),
            ));
        }
    }
    if total > MAX_THEME_BYTES {
        out.push(Finding::general(format!(
            "the theme is larger than {} MB in total",
            MAX_THEME_BYTES / 1024 / 1024
        )));
    }
    out
}

const SCRIPT_MARKERS: [&str; 4] = ["expression(", "javascript:", "behavior:", "-moz-binding"];

fn blank(text: &str, open: &str, close: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find(open) {
        out.push_str(&rest[..start]);
        let after = &rest[start + open.len()..];
        let end = after
            .find(close)
            .map(|e| e + close.len())
            .unwrap_or(after.len());
        let skipped = &rest[start..start + open.len() + end];
        out.extend(skipped.chars().map(|c| if c == '\n' { '\n' } else { ' ' }));
        rest = &after[end..];
    }
    out.push_str(rest);
    out
}

fn blank_strings(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut quote: Option<char> = None;
    let mut escaped = false;
    for c in text.chars() {
        match quote {
            Some(q) => {
                out.push(if c == '\n' { '\n' } else { ' ' });
                if escaped {
                    escaped = false;
                } else if c == '\\' {
                    escaped = true;
                } else if c == q {
                    quote = None;
                }
            }
            None if c == '"' || c == '\'' => {
                quote = Some(c);
                out.push(' ');
            }
            None => out.push(c),
        }
    }
    out
}

const URL_OPEN: &str = "url(";
const IMAGE_SET_OPEN: &str = "image-set(";

fn as_parsed(css: &str) -> (String, Vec<usize>) {
    let mut text = String::with_capacity(css.len());
    let mut lines = Vec::with_capacity(css.len());
    let mut line = 1;
    let mut chars = css.chars().peekable();
    while let Some(c) = chars.next() {
        let at = line;
        let shown = if c == '\\' && chars.peek().is_some_and(|n| *n != '\n') {
            escaped(&mut chars, &mut line)
        } else {
            c
        };
        if c == '\n' {
            line += 1;
        }
        let shown = shown.to_ascii_lowercase();
        lines.extend(std::iter::repeat_n(at, shown.len_utf8()));
        text.push(shown);
    }
    (text, lines)
}

fn escaped(chars: &mut std::iter::Peekable<std::str::Chars>, line: &mut usize) -> char {
    let mut hex = String::new();
    while hex.len() < 6
        && let Some(digit) = chars.next_if(char::is_ascii_hexdigit)
    {
        hex.push(digit);
    }
    if hex.is_empty() {
        return chars.next().unwrap_or(char::REPLACEMENT_CHARACTER);
    }
    if chars.next_if(char::is_ascii_whitespace) == Some('\n') {
        *line += 1;
    }
    u32::from_str_radix(&hex, 16)
        .ok()
        .and_then(char::from_u32)
        .filter(|c| *c != '\0')
        .unwrap_or(char::REPLACEMENT_CHARACTER)
}

fn quoted_arguments(args: &str) -> Vec<&str> {
    let mut found = Vec::new();
    let mut depth = 0;
    let mut quote: Option<(char, usize)> = None;
    for (i, c) in args.char_indices() {
        match quote {
            Some((q, start)) if c == q => {
                if depth == 0 {
                    found.push(&args[start..i]);
                }
                quote = None;
            }
            Some(_) => {}
            None if c == '"' || c == '\'' => quote = Some((c, i + 1)),
            None if c == '(' => depth += 1,
            None if c == ')' && depth == 0 => break,
            None if c == ')' => depth -= 1,
            None => {}
        }
    }
    found
}

fn line_at(text: &str, index: usize) -> usize {
    text[..index].matches('\n').count() + 1
}

fn private_selectors(selector: &str) -> Vec<String> {
    let mut found = Vec::new();
    let chars: Vec<char> = selector.chars().collect();
    let mut depth = 0;
    let mut i = 0;
    while i < chars.len() {
        match chars[i] {
            '[' => depth += 1,
            ']' => depth -= 1,
            '.' | '#' if depth == 0 => {
                let name: String = chars[i + 1..]
                    .iter()
                    .take_while(|c| c.is_alphanumeric() || **c == '-' || **c == '_')
                    .collect();
                let starts_name = name.chars().next().is_some_and(|c| !c.is_ascii_digit());
                if starts_name {
                    found.push(format!("{}{name}", chars[i]));
                }
                i += name.chars().count();
            }
            _ => {}
        }
        i += 1;
    }
    found
}

fn remote(target: &str) -> bool {
    let target = target.trim().trim_matches(|c| c == '"' || c == '\'').trim();
    let lower = target.to_ascii_lowercase();
    let scheme = lower.split_once(':').map(|(s, _)| s).filter(|s| {
        s.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '+' || c == '-' || c == '.')
    });
    lower.starts_with("//") || scheme.is_some_and(|s| s != "data")
}

pub fn lint_css(css: &str) -> Vec<(usize, String)> {
    let mut out = Vec::new();
    let lower = css.to_ascii_lowercase();
    for marker in SCRIPT_MARKERS {
        if let Some(at) = lower.find(marker) {
            out.push((
                line_at(css, at),
                format!("{marker} is a script hook; themes hold data, never code"),
            ));
        }
    }
    let without_comments = blank(css, "/*", "*/");
    let (parsed, lines) = as_parsed(&without_comments);
    let mut search = 0;
    while let Some(found) = parsed[search..].find(URL_OPEN) {
        let at = search + found;
        let start = at + URL_OPEN.len();
        let end = parsed[start..]
            .find(')')
            .map(|e| start + e)
            .unwrap_or(parsed.len());
        let target = &parsed[start..end];
        if remote(target) {
            out.push((lines[at], format!("url({}) loads from outside the theme; use a file inside the theme folder or a data: URL", target.trim())));
        }
        search = end;
    }
    for (at, _) in parsed.match_indices(IMAGE_SET_OPEN) {
        for target in quoted_arguments(&parsed[at + IMAGE_SET_OPEN.len()..]) {
            if remote(target) {
                out.push((lines[at], format!("image-set(\"{target}\") loads from outside the theme; use a file inside the theme folder or a data: URL")));
            }
        }
    }
    for (at, _) in parsed.match_indices("@import") {
        out.push((
            lines[at],
            "@import is not allowed; put every rule in theme.css".to_string(),
        ));
    }
    let code = blank_strings(&without_comments);
    let mut start = 0;
    for (at, c) in code.char_indices() {
        match c {
            '{' => {
                let selector = code[start..at].trim();
                if !selector.starts_with('@') {
                    for name in private_selectors(selector) {
                        let line = line_at(
                            css,
                            start + code[start..at].find(name.as_str()).unwrap_or(0),
                        );
                        out.push((line, format!("{name} selects a private class or id; select a named part such as [data-part=\"card\"] instead")));
                    }
                }
                start = at + 1;
            }
            '}' | ';' => start = at + 1,
            _ => {}
        }
    }
    out.sort();
    out
}

pub fn folder_hash(folder: &Path) -> Result<String, String> {
    if !folder.join(MANIFEST_FILE).is_file() {
        return Err(format!("{} has no {MANIFEST_FILE}", folder.display()));
    }
    let mut hash = Fnv::new();
    for (name, path) in theme_files(folder) {
        let bytes = fs::read(&path).map_err(|e| format!("cannot read {}: {e}", path.display()))?;
        hash.write(name.as_bytes());
        hash.write(&[0]);
        hash.write(&(bytes.len() as u64).to_le_bytes());
        hash.write(&bytes);
    }
    Ok(format!("{:016x}", hash.finish()))
}

struct Fnv(u64);

impl Fnv {
    const OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
    const PRIME: u64 = 0x0000_0100_0000_01b3;

    fn new() -> Fnv {
        Fnv(Self::OFFSET)
    }

    fn write(&mut self, bytes: &[u8]) {
        for byte in bytes {
            self.0 ^= u64::from(*byte);
            self.0 = self.0.wrapping_mul(Self::PRIME);
        }
    }

    fn finish(&self) -> u64 {
        self.0
    }
}

fn copy_theme(from: &Path, to: &Path) -> Result<(), String> {
    for (name, path) in theme_files(from) {
        let target = to.join(&name);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("cannot create {}: {e}", parent.display()))?;
        }
        fs::copy(&path, &target).map_err(|e| format!("cannot copy {name}: {e}"))?;
    }
    Ok(())
}

pub fn write_files(folder: &Path, files: &BTreeMap<String, String>) -> Result<(), String> {
    for name in files.keys() {
        if name != MANIFEST_FILE {
            check_asset_path(name, &["css", "svg", "md", "txt"])?;
        }
    }
    fs::create_dir_all(folder).map_err(|e| format!("cannot create {}: {e}", folder.display()))?;
    for (name, text) in files {
        let target = folder.join(name);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("cannot create {}: {e}", parent.display()))?;
        }
        fs::write(&target, text).map_err(|e| format!("cannot write {name}: {e}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn home() -> Option<PathBuf> {
        Some(PathBuf::from("/home/sailor"))
    }

    fn themes() -> (tempfile::TempDir, Themes) {
        let dir = tempfile::tempdir().unwrap();
        let themes = Themes::new(dir.path().join("config/themes"), &dir.path().join("data"));
        (dir, themes)
    }

    fn write(folder: &Path, name: &str, text: &str) {
        let path = folder.join(name);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    const MANIFEST: &str = r#"{"fathomTheme": 1, "name": "Reef"}"#;

    fn theme(themes: &Themes, id: &str, manifest: &str) -> PathBuf {
        let folder = themes.root.join(id);
        write(&folder, MANIFEST_FILE, manifest);
        write(&folder, STYLE_FILE, "");
        folder
    }

    #[test]
    fn themes_live_in_the_config_folder_and_follow_xdg_only_on_linux() {
        assert_eq!(
            config_root("macos", home(), Some("/xdg".into())),
            Some(PathBuf::from("/home/sailor/.config/fathom/themes"))
        );
        assert_eq!(
            config_root("linux", home(), Some("/xdg".into())),
            Some(PathBuf::from("/xdg/fathom/themes"))
        );
        assert_eq!(
            config_root("linux", home(), Some("relative".into())),
            Some(PathBuf::from("/home/sailor/.config/fathom/themes"))
        );
        assert_eq!(config_root("linux", None, None), None);
    }

    #[test]
    fn reads_a_minimal_manifest_with_the_defaults() {
        let manifest = parse_manifest(MANIFEST).unwrap();
        assert_eq!(manifest.modes, vec![Mode::Light, Mode::Dark]);
        assert_eq!(manifest.layout, Layout::default());
        assert_eq!(manifest.layout.chat_side, ChatSide::Right);
        assert_eq!(manifest.text, Text::default());
    }

    #[test]
    fn a_misspelled_key_is_an_error_not_a_silent_default() {
        let error = parse_manifest(
            r#"{"fathomTheme": 1, "name": "Reef", "layout": {"chatSides": "left"}}"#,
        )
        .unwrap_err();
        assert!(error.contains("chatSides"), "{error}");
        let error =
            parse_manifest(r#"{"fathomTheme": 1, "name": "Reef", "layout": {"board": "grid"}}"#)
                .unwrap_err();
        assert!(error.contains("grid"), "{error}");
    }

    #[test]
    fn checks_versions_sizes_text_fonts_and_art() {
        let (_dir, themes) = themes();
        let folder = theme(
            &themes,
            "reef",
            r#"{
              "fathomTheme": 2,
              "name": "",
              "modes": ["dark", "dark"],
              "fonts": {"body": "Inter; color: red"},
              "text": {"brand": "<b>Reef</b>", "helper": " "},
              "art": {"brandMark": "../mark.svg", "sailor": "art/missing.svg", "sailorActive": "art/eyes.exe"},
              "layout": {"rowLabelWidth": 8, "laneWidth": 300}
            }"#,
        );
        let manifest = read_manifest(&folder).unwrap();
        let problems: Vec<String> = check_manifest(&manifest, &folder)
            .into_iter()
            .map(|f| f.problem)
            .collect();
        let has = |text: &str| problems.iter().any(|p| p.contains(text));
        assert!(has("contract version 1"), "{problems:?}");
        assert!(has("name must be"), "{problems:?}");
        assert!(has("modes lists"), "{problems:?}");
        assert!(has("fonts.body"), "{problems:?}");
        assert!(has("text.brand"), "{problems:?}");
        assert!(has("text.helper cannot be empty"), "{problems:?}");
        assert!(
            has("art.brandMark: ../mark.svg must be a path inside"),
            "{problems:?}"
        );
        assert!(
            has("art.sailor: art/missing.svg does not exist"),
            "{problems:?}"
        );
        assert!(
            has("art.sailorActive: art/eyes.exe must be one of"),
            "{problems:?}"
        );
        assert!(
            has("layout.rowLabelWidth must be between 40 and 320"),
            "{problems:?}"
        );
        assert!(has("layout.laneWidth only applies"), "{problems:?}");
    }

    #[test]
    fn a_folder_holds_data_never_code() {
        let (_dir, themes) = themes();
        let folder = theme(&themes, "reef", MANIFEST);
        write(&folder, "art/mark.svg", "<svg/>");
        write(&folder, "RECIPE.md", "notes");
        write(&folder, "boot.js", "alert(1)");
        write(&folder, ".shots/board.png", "png");
        let (_, findings) = check_folder(&folder);
        assert_eq!(findings.len(), 1, "{findings:?}");
        assert_eq!(findings[0].file.as_deref(), Some("boot.js"));
    }

    #[test]
    fn a_theme_without_css_or_manifest_is_reported() {
        let (_dir, themes) = themes();
        let folder = themes.root.join("bare");
        fs::create_dir_all(&folder).unwrap();
        let (manifest, findings) = check_folder(&folder);
        assert!(manifest.is_none());
        let files: Vec<_> = findings.iter().filter_map(|f| f.file.clone()).collect();
        assert_eq!(files, vec![MANIFEST_FILE, STYLE_FILE]);
    }

    #[test]
    fn ids_are_folder_names_and_nautical_is_reserved() {
        assert!(check_id("phosphor-2").is_ok());
        for bad in ["", "Phosphor", "-reef", "reef/x", "reef.x", &"a".repeat(49)] {
            assert!(check_id(bad).is_err(), "{bad}");
        }
        assert!(id_of(Path::new("/t/nautical")).is_err());
        assert_eq!(id_of(Path::new("/t/riso")).unwrap(), "riso");
        assert_eq!(slug("The Paper Atlas!"), "the-paper-atlas");
        assert_eq!(slug("  ***  "), "theme");
    }

    #[test]
    fn css_selects_named_parts_and_loads_nothing_from_outside() {
        let css = r#"/* .old-class is fine in a comment */
@import url("parts.css");
@import "https://evil.example/x.css";
@font-face { font-family: Stamp; src: url("fonts/stamp.woff2"); }
:root[data-mode="dark"] { --page: #000; }
[data-part="card"][data-state~="selected"]:hover > svg { color: red; }
[data-part="a.b"] { content: ".not-a-class"; }
body { background: url(data:image/svg+xml,%3Csvg%23x) , url('https://cdn.example/t.png'); }
.card, #root::after { width: expression(alert(1)); }
@media (max-width: 1.5em) { [data-part="row"] { flex: 1.5; } }
"#;
        let problems = lint_css(css);
        let lines: Vec<usize> = problems.iter().map(|(line, _)| *line).collect();
        assert_eq!(lines, vec![2, 3, 8, 9, 9, 9], "{problems:?}");
        assert!(problems[0].1.contains("@import"));
        assert!(problems[1].1.contains("@import"));
        assert!(problems[2].1.contains("https://cdn.example/t.png"));
        let text: Vec<&str> = problems.iter().map(|(_, p)| p.as_str()).collect();
        assert!(
            text.iter().any(|p| p.starts_with(".card selects")),
            "{text:?}"
        );
        assert!(
            text.iter().any(|p| p.starts_with("#root selects")),
            "{text:?}"
        );
        assert!(
            text.iter().any(|p| p.starts_with("expression(")),
            "{text:?}"
        );
    }

    #[test]
    fn css_is_linted_as_the_parser_reads_it() {
        let css = r#"@IMPORT "parts.css";
@\69mport "more.css";
body { background: URL(https://x.example/t.png); }
body { background: u\72l(https://x.example/u.png); }
body { background: -webkit-image-set("https://x.example/a.png" 1x, url(art/b.png) 2x); }
body { background: image-set('//x.example/c.png' 1x, linear-gradient(red, blue) 2x); }
body { background: image-set("art/d.png" 1x); content: "https://fine.example"; }
"#;
        let problems = lint_css(css);
        let lines: Vec<usize> = problems.iter().map(|(line, _)| *line).collect();
        assert_eq!(lines, vec![1, 2, 3, 4, 5, 6], "{problems:?}");
        assert!(problems[0].1.contains("@import") && problems[1].1.contains("@import"));
        assert!(problems[2].1.contains("https://x.example/t.png"));
        assert!(problems[3].1.contains("https://x.example/u.png"));
        assert!(problems[4].1.contains("https://x.example/a.png"));
        assert!(problems[5].1.contains("//x.example/c.png"));
    }

    #[test]
    fn the_hash_follows_content_and_ignores_shots() {
        let (_dir, themes) = themes();
        let folder = theme(&themes, "reef", MANIFEST);
        let first = folder_hash(&folder).unwrap();
        write(&folder, ".shots/board.png", "png");
        assert_eq!(folder_hash(&folder).unwrap(), first);
        write(&folder, STYLE_FILE, "body { color: var(--ink); }");
        assert_ne!(folder_hash(&folder).unwrap(), first);
    }

    #[test]
    fn a_failed_check_keeps_the_last_good_copy() {
        let (_dir, themes) = themes();
        let folder = theme(&themes, "reef", MANIFEST);
        assert_eq!(themes.summary("reef").status, Status::Unchecked);
        assert!(themes.can_use("reef").is_err());

        let good = folder_hash(&folder).unwrap();
        themes
            .store_result(
                "reef",
                &themes.snapshot("reef", &folder).unwrap().dir,
                &good,
                vec![],
                1,
            )
            .unwrap();
        assert_eq!(themes.summary("reef").status, Status::Ready);
        assert_eq!(themes.active("reef").unwrap().version, good);
        assert!(themes.can_use("reef").is_ok());

        write(&folder, STYLE_FILE, "body { display: none; }");
        assert_eq!(themes.summary("reef").status, Status::ReadyWithChanges);
        let bad = folder_hash(&folder).unwrap();
        let findings = vec![Finding::general("everything is hidden")];
        themes
            .store_result(
                "reef",
                &themes.snapshot("reef", &folder).unwrap().dir,
                &bad,
                findings,
                2,
            )
            .unwrap();
        let summary = themes.summary("reef");
        assert_eq!((summary.status, summary.problems), (Status::Failed, 1));
        assert_eq!(themes.active("reef").unwrap().version, good);
        let kept = fs::read_to_string(themes.good_copy("reef").join(STYLE_FILE)).unwrap();
        assert_eq!(kept, "");
    }

    #[test]
    fn the_good_copy_is_what_was_checked_not_a_later_edit() {
        let (_dir, themes) = themes();
        let folder = theme(&themes, "reef", MANIFEST);
        write(&folder, STYLE_FILE, "/* v1 */");
        let checked = themes.snapshot("reef", &folder).unwrap();
        let hash = folder_hash(&checked.dir).unwrap();
        write(
            &folder,
            STYLE_FILE,
            "[data-part=\"app\"] { display: none; }",
        );
        themes
            .store_result("reef", &checked.dir, &hash, vec![], 1)
            .unwrap();
        let kept = fs::read_to_string(themes.good_copy("reef").join(STYLE_FILE)).unwrap();
        assert_eq!(kept, "/* v1 */");
        assert_eq!(themes.active("reef").unwrap().version, hash);
        assert_eq!(themes.summary("reef").status, Status::ReadyWithChanges);
    }

    #[test]
    fn a_theme_whose_folder_is_gone_is_not_live() {
        let (_dir, themes) = themes();
        let folder = theme(&themes, "reef", MANIFEST);
        let hash = folder_hash(&folder).unwrap();
        themes
            .store_result(
                "reef",
                &themes.snapshot("reef", &folder).unwrap().dir,
                &hash,
                vec![],
                1,
            )
            .unwrap();
        assert!(themes.active("reef").is_some());
        fs::remove_dir_all(&folder).unwrap();
        assert!(themes.active("reef").is_none());
        assert!(themes.can_use("reef").is_err());
    }

    #[test]
    fn lists_nautical_first_then_folders_with_a_manifest() {
        let (_dir, themes) = themes();
        theme(
            &themes,
            "riso",
            r#"{"fathomTheme": 1, "name": "Riso", "modes": ["light"]}"#,
        );
        fs::create_dir_all(themes.root.join("empty")).unwrap();
        let list = themes.list();
        let ids: Vec<&str> = list.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(ids, vec![NAUTICAL, "riso"]);
        assert_eq!(list[0].status, Status::BuiltIn);
        assert_eq!(list[1].name, "Riso");
        assert_eq!(list[1].modes, vec![Mode::Light]);
    }

    #[test]
    fn deleting_removes_the_folder_and_the_checked_copy_but_never_nautical() {
        let (_dir, themes) = themes();
        let folder = theme(&themes, "reef", MANIFEST);
        let hash = folder_hash(&folder).unwrap();
        themes
            .store_result(
                "reef",
                &themes.snapshot("reef", &folder).unwrap().dir,
                &hash,
                vec![],
                1,
            )
            .unwrap();
        themes.delete("reef").unwrap();
        assert!(!folder.exists());
        assert!(!themes.good_copy("reef").exists());
        assert!(themes.record("reef").is_none());
        assert!(themes.delete(NAUTICAL).is_err());
        assert!(themes.delete("reef").is_err());
    }

    #[test]
    fn writes_text_files_inside_the_folder_only() {
        let (_dir, themes) = themes();
        let folder = themes.root.join("reef");
        let mut files = BTreeMap::new();
        files.insert(MANIFEST_FILE.to_string(), MANIFEST.to_string());
        files.insert("art/mark.svg".to_string(), "<svg/>".to_string());
        write_files(&folder, &files).unwrap();
        assert!(folder.join("art/mark.svg").is_file());
        files.insert("../escape.css".to_string(), "x".to_string());
        assert!(write_files(&folder, &files).is_err());
        let mut code = BTreeMap::new();
        code.insert("run.js".to_string(), "x".to_string());
        assert!(write_files(&folder, &code).is_err());
    }

    #[test]
    fn free_ids_never_collide_with_nautical_or_a_folder() {
        let (_dir, themes) = themes();
        assert_eq!(themes.free_id("Nautical"), "nautical-2");
        theme(&themes, "reef", MANIFEST);
        assert_eq!(themes.free_id("Reef"), "reef-2");
        assert_eq!(themes.free_id("Kelp"), "kelp");
    }

    #[test]
    fn the_guide_is_rewritten_on_every_start() {
        let (_dir, themes) = themes();
        themes.write_guide().unwrap();
        let path = themes.root.join(GUIDE_FILE);
        fs::write(&path, "old").unwrap();
        themes.write_guide().unwrap();
        assert_eq!(fs::read_to_string(path).unwrap(), GUIDE);
    }
}
