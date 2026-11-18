use std::ops::RangeInclusive;
use std::sync::LazyLock;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::db::Db;
use crate::launch::{self, Agent};
use crate::source::Source;

pub const FIRSTMATE_LABEL: &str = "firstmate.role=primary";
const DEFAULT_HOME_RELATIVE: &str = "Documents/firstmate";
const FIRSTMATE_MARKER: &str = "bin/fm-tasks-axi.sh";

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
const KEY_AGENT_FOLDER: &str = "agentFolder";
const KEY_CHAT_AGENT: &str = "chatAgent";
const KEY_THEME: &str = "theme";
const KEY_CHAT_OPEN: &str = "chatOpen";
const KEY_CHAT_WIDTH: &str = "chatWidth";
const KEY_DETAIL_WIDTH: &str = "detailWidth";
const KEY_PROJECT_FILTER: &str = "projectFilter";
const KEY_HELPER_STARTED: &str = "helperStarted";
const KEY_HELPER_ASKING: &str = "helperAsking";

#[cfg(target_os = "macos")]
const PLATFORM: &str = "macos";
#[cfg(not(target_os = "macos"))]
const PLATFORM: &str = "linux";
const DEFAULT_BOARD_FONT: &str = "default";
const DEFAULT_CHAT_FONT_SIZE: u16 = 13;
const DEFAULT_BOARD_FONT_SIZE: u16 = 14;
pub const ADDED_FONT_PREFIX: &str = "family:";
const FONT_PRESETS: &str = include_str!("../../src/fontPresets.json");

pub const CHAT_WIDTH: Span = Span {
    default: 600,
    range: 300..=1400,
};
pub const DETAIL_WIDTH: Span = Span {
    default: 460,
    range: 340..=900,
};

pub struct Span {
    pub default: u32,
    pub range: RangeInclusive<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    #[default]
    Light,
    Dark,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum Surface {
    Chat,
    Board,
}

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
    pub agent_folder: String,
    #[serde(default)]
    pub chat_agent: Option<Agent>,
    pub theme: Theme,
    pub chat_open: bool,
    pub chat_width: u32,
    pub detail_width: u32,
    pub project_filter: Vec<String>,
    #[serde(default)]
    pub helper_started: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FontPreset {
    pub key: String,
    pub name: String,
}

#[derive(Deserialize)]
struct FontTable {
    sizes: SurfaceOf<[u16; 2]>,
    presets: std::collections::HashMap<String, SurfaceOf<Vec<FontPreset>>>,
}

#[derive(Deserialize)]
struct SurfaceOf<T> {
    chat: T,
    board: T,
}

impl<T> SurfaceOf<T> {
    fn get(&self, surface: Surface) -> &T {
        match surface {
            Surface::Chat => &self.chat,
            Surface::Board => &self.board,
        }
    }
}

static FONTS: LazyLock<FontTable> =
    LazyLock::new(|| serde_json::from_str(FONT_PRESETS).expect("font presets are valid JSON"));

pub fn font_presets(surface: Surface) -> &'static [FontPreset] {
    FONTS.presets[PLATFORM].get(surface)
}

pub fn font_sizes(surface: Surface) -> RangeInclusive<u16> {
    let [low, high] = *FONTS.sizes.get(surface);
    low..=high
}

pub fn default_home() -> String {
    std::env::home_dir()
        .map(|h| h.join(DEFAULT_HOME_RELATIVE))
        .filter(|home| home.join(FIRSTMATE_MARKER).is_file())
        .map(|home| home.display().to_string())
        .unwrap_or_default()
}

fn user_home() -> String {
    std::env::home_dir()
        .map(|home| home.display().to_string())
        .unwrap_or_default()
}

fn default_label(home: &str) -> String {
    match Source::of(home) {
        Source::Firstmate { .. } => FIRSTMATE_LABEL.to_string(),
        Source::Backlog => launch::chat_label(),
    }
}

fn chosen_label(stored: Option<&String>, home: &str) -> String {
    let built_in = [FIRSTMATE_LABEL.to_string(), launch::chat_label()];
    stored
        .map(|label| label.trim().to_string())
        .filter(|label| !label.is_empty() && !built_in.contains(label))
        .unwrap_or_else(|| default_label(home))
}

pub fn load(db: &Db) -> Result<Settings, String> {
    let stored = db.settings()?;
    let get = |key: &str, fallback: String| {
        stored
            .get(key)
            .filter(|v| !v.trim().is_empty())
            .cloned()
            .unwrap_or(fallback)
    };
    let size = |key: &str, surface: Surface, fallback: u16| {
        stored
            .get(key)
            .and_then(|v| v.trim().parse::<u16>().ok())
            .filter(|v| font_sizes(surface).contains(v))
            .unwrap_or(fallback)
    };
    let width = |key: &str, span: &Span| {
        stored
            .get(key)
            .and_then(|v| v.trim().parse::<u32>().ok())
            .map(|v| v.clamp(*span.range.start(), *span.range.end()))
            .unwrap_or(span.default)
    };
    let list = |key: &str| {
        stored
            .get(key)
            .and_then(|v| serde_json::from_str::<Vec<String>>(v).ok())
            .map(clean_names)
            .unwrap_or_default()
    };
    let flag = |key: &str, fallback: bool| {
        stored
            .get(key)
            .and_then(|v| v.trim().parse::<bool>().ok())
            .unwrap_or(fallback)
    };
    let home = stored
        .get(KEY_HOME)
        .map(|home| home.trim().to_string())
        .unwrap_or_else(default_home);
    Ok(Settings {
        terminal_label: chosen_label(stored.get(KEY_LABEL), &home),
        home,
        hc_session: get(KEY_SESSION, String::new()),
        hc_socket: get(KEY_SOCKET, String::new()),
        chat_font: get(KEY_CHAT_FONT, font_presets(Surface::Chat)[0].key.clone()),
        chat_font_size: size(KEY_CHAT_FONT_SIZE, Surface::Chat, DEFAULT_CHAT_FONT_SIZE),
        board_font: get(KEY_BOARD_FONT, DEFAULT_BOARD_FONT.to_string()),
        board_font_size: size(KEY_BOARD_FONT_SIZE, Surface::Board, DEFAULT_BOARD_FONT_SIZE),
        chat_added_fonts: list(KEY_CHAT_ADDED_FONTS),
        board_added_fonts: list(KEY_BOARD_ADDED_FONTS),
        agent_folder: get(KEY_AGENT_FOLDER, user_home()),
        chat_agent: stored
            .get(KEY_CHAT_AGENT)
            .and_then(|key| serde_json::from_value(json!(key)).ok()),
        theme: stored
            .get(KEY_THEME)
            .and_then(|key| serde_json::from_value(json!(key)).ok())
            .unwrap_or_default(),
        chat_open: flag(KEY_CHAT_OPEN, true),
        chat_width: width(KEY_CHAT_WIDTH, &CHAT_WIDTH),
        detail_width: width(KEY_DETAIL_WIDTH, &DETAIL_WIDTH),
        project_filter: list(KEY_PROJECT_FILTER),
        helper_started: flag(KEY_HELPER_STARTED, false),
    })
}

pub fn store(db: &Db, next: &Settings) -> Result<Settings, String> {
    check(next)?;
    let theme = serde_json::to_value(next.theme).map_err(|e| e.to_string())?;
    let pairs = [
        (KEY_HOME, next.home.trim().to_string()),
        (KEY_LABEL, next.terminal_label.trim().to_string()),
        (KEY_SESSION, next.hc_session.trim().to_string()),
        (KEY_SOCKET, next.hc_socket.trim().to_string()),
        (KEY_CHAT_FONT, next.chat_font.trim().to_string()),
        (KEY_CHAT_FONT_SIZE, next.chat_font_size.to_string()),
        (KEY_BOARD_FONT, next.board_font.trim().to_string()),
        (KEY_BOARD_FONT_SIZE, next.board_font_size.to_string()),
        (KEY_CHAT_ADDED_FONTS, names_json(&next.chat_added_fonts)),
        (KEY_BOARD_ADDED_FONTS, names_json(&next.board_added_fonts)),
        (KEY_AGENT_FOLDER, next.agent_folder.trim().to_string()),
        (KEY_THEME, theme.as_str().unwrap_or_default().to_string()),
        (KEY_CHAT_OPEN, next.chat_open.to_string()),
        (KEY_CHAT_WIDTH, next.chat_width.to_string()),
        (KEY_DETAIL_WIDTH, next.detail_width.to_string()),
        (KEY_PROJECT_FILTER, names_json(&next.project_filter)),
    ];
    db.set_settings(&pairs)?;
    load(db)
}

pub fn update(
    db: &Db,
    change: impl FnOnce(&mut Settings) -> Result<(), String>,
) -> Result<Settings, String> {
    let mut next = load(db)?;
    change(&mut next)?;
    store(db, &next)
}

fn check(next: &Settings) -> Result<(), String> {
    for (surface, size) in [
        (Surface::Chat, next.chat_font_size),
        (Surface::Board, next.board_font_size),
    ] {
        let sizes = font_sizes(surface);
        if !sizes.contains(&size) {
            return Err(format!(
                "the {} font size must be between {} and {}",
                surface_name(surface),
                sizes.start(),
                sizes.end()
            ));
        }
    }
    for (name, width, span) in [
        ("chat width", next.chat_width, &CHAT_WIDTH),
        ("card detail width", next.detail_width, &DETAIL_WIDTH),
    ] {
        if !span.range.contains(&width) {
            return Err(format!(
                "the {name} must be between {} and {} pixels",
                span.range.start(),
                span.range.end()
            ));
        }
    }
    Ok(())
}

pub fn surface_name(surface: Surface) -> &'static str {
    match surface {
        Surface::Chat => "chat",
        Surface::Board => "board",
    }
}

pub fn set_font(
    settings: &mut Settings,
    surface: Surface,
    font: &str,
    installed: impl FnOnce() -> Vec<String>,
) -> Result<(), String> {
    let wanted = font.trim();
    let wanted = wanted.strip_prefix(ADDED_FONT_PREFIX).unwrap_or(wanted);
    let same = |name: &str| name.eq_ignore_ascii_case(wanted);
    let (chosen, added) = match surface {
        Surface::Chat => (&mut settings.chat_font, &mut settings.chat_added_fonts),
        Surface::Board => (&mut settings.board_font, &mut settings.board_added_fonts),
    };
    if let Some(preset) = font_presets(surface)
        .iter()
        .find(|p| same(&p.key) || same(&p.name))
    {
        *chosen = preset.key.clone();
        return Ok(());
    }
    let family = match added.iter().find(|f| same(f)) {
        Some(family) => family.clone(),
        None => {
            let family = installed()
                .into_iter()
                .find(|f| same(f))
                .ok_or_else(|| format!("no font named \"{wanted}\" is installed"))?;
            added.push(family.clone());
            family
        }
    };
    *chosen = format!("{ADDED_FONT_PREFIX}{family}");
    Ok(())
}

pub fn helper_asking(db: &Db) -> Result<bool, String> {
    Ok(db
        .settings()?
        .get(KEY_HELPER_ASKING)
        .is_some_and(|v| v == "true"))
}

pub fn set_helper_asking(db: &Db, asking: bool) -> Result<(), String> {
    db.set_setting(KEY_HELPER_ASKING, &asking.to_string())
}

pub fn remember_helper_started(db: &Db) -> Result<(), String> {
    db.set_setting(KEY_HELPER_STARTED, "true")
}

pub fn remember_chat_agent(db: &Db, agent: Agent) -> Result<(), String> {
    db.set_setting(KEY_CHAT_AGENT, agent.key())
}

pub fn clean_names(names: Vec<String>) -> Vec<String> {
    let mut seen = Vec::<String>::new();
    for name in names {
        let name = name.trim();
        if !name.is_empty() && !seen.iter().any(|f| f == name) {
            seen.push(name.to_string());
        }
    }
    seen
}

fn names_json(names: &[String]) -> String {
    serde_json::to_string(&clean_names(names.to_vec())).unwrap_or_else(|_| "[]".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh() -> (tempfile::TempDir, Db) {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path()).unwrap();
        (dir, db)
    }

    #[test]
    fn font_settings_default_and_reject_sizes_out_of_range() {
        let (_dir, db) = fresh();
        let fresh = load(&db).unwrap();
        assert_eq!(fresh.chat_font, font_presets(Surface::Chat)[0].key);
        assert_eq!(fresh.chat_font_size, DEFAULT_CHAT_FONT_SIZE);
        assert_eq!(fresh.board_font, DEFAULT_BOARD_FONT);
        assert_eq!(fresh.board_font_size, DEFAULT_BOARD_FONT_SIZE);

        db.set_setting(KEY_CHAT_FONT, "menlo").unwrap();
        db.set_setting(KEY_CHAT_FONT_SIZE, "17").unwrap();
        db.set_setting(KEY_BOARD_FONT_SIZE, "400").unwrap();
        let stored = load(&db).unwrap();
        assert_eq!(stored.chat_font, "menlo");
        assert_eq!(stored.chat_font_size, 17);
        assert_eq!(stored.board_font_size, DEFAULT_BOARD_FONT_SIZE);
    }

    #[test]
    fn the_chat_label_defaults_to_the_board_source() {
        let (_dir, db) = fresh();
        db.set_setting(KEY_HOME, "").unwrap();
        assert_eq!(load(&db).unwrap().terminal_label, "fathom.role=chat");

        db.set_setting(KEY_LABEL, FIRSTMATE_LABEL).unwrap();
        assert_eq!(load(&db).unwrap().terminal_label, "fathom.role=chat");

        db.set_setting(KEY_HOME, "/somewhere/firstmate").unwrap();
        assert_eq!(load(&db).unwrap().terminal_label, FIRSTMATE_LABEL);
        db.set_setting(KEY_LABEL, "fathom.role=chat").unwrap();
        assert_eq!(load(&db).unwrap().terminal_label, FIRSTMATE_LABEL);

        db.set_setting(KEY_LABEL, " team.role=lead ").unwrap();
        assert_eq!(load(&db).unwrap().terminal_label, "team.role=lead");
        db.set_setting(KEY_HOME, "").unwrap();
        assert_eq!(load(&db).unwrap().terminal_label, "team.role=lead");
    }

    #[test]
    fn the_agent_folder_defaults_to_home_and_the_last_agent_is_remembered() {
        let (_dir, db) = fresh();
        let fresh = load(&db).unwrap();
        assert_eq!(fresh.agent_folder, user_home());
        assert_eq!(fresh.chat_agent, None);

        db.set_setting(KEY_AGENT_FOLDER, "/work/projects").unwrap();
        remember_chat_agent(&db, Agent::Codex).unwrap();
        let stored = load(&db).unwrap();
        assert_eq!(stored.agent_folder, "/work/projects");
        assert_eq!(stored.chat_agent, Some(Agent::Codex));

        db.set_setting(KEY_CHAT_AGENT, "nonsense").unwrap();
        assert_eq!(load(&db).unwrap().chat_agent, None);
    }

    #[test]
    fn added_fonts_are_trimmed_deduplicated_and_survive_bad_json() {
        let (_dir, db) = fresh();
        assert!(load(&db).unwrap().chat_added_fonts.is_empty());

        let list = vec![
            " Fira Code ".to_string(),
            "Fira Code".into(),
            String::new(),
            "Iosevka".into(),
        ];
        db.set_setting(KEY_CHAT_ADDED_FONTS, &names_json(&list))
            .unwrap();
        db.set_setting(KEY_BOARD_ADDED_FONTS, "not json").unwrap();
        let stored = load(&db).unwrap();
        assert_eq!(stored.chat_added_fonts, ["Fira Code", "Iosevka"]);
        assert!(stored.board_added_fonts.is_empty());
    }

    #[test]
    fn window_state_starts_light_with_the_chat_open_and_is_remembered() {
        let (_dir, db) = fresh();
        let first = load(&db).unwrap();
        assert_eq!(first.theme, Theme::Light);
        assert!(first.chat_open);
        assert_eq!(first.chat_width, CHAT_WIDTH.default);
        assert_eq!(first.detail_width, DETAIL_WIDTH.default);
        assert!(first.project_filter.is_empty());
        assert!(!first.helper_started);

        let saved = update(&db, |s| {
            s.theme = Theme::Dark;
            s.chat_open = false;
            s.chat_width = 720;
            s.detail_width = 500;
            s.project_filter = vec![" reef-map ".into(), "reef-map".into(), "dry-dock".into()];
            Ok(())
        })
        .unwrap();
        assert_eq!(saved.theme, Theme::Dark);
        assert!(!saved.chat_open);
        assert_eq!(saved.project_filter, ["reef-map", "dry-dock"]);

        let reopened = load(&Db::open_file(db.path()).unwrap()).unwrap();
        assert_eq!(reopened, saved);
    }

    #[test]
    fn saving_rejects_widths_and_sizes_out_of_range_and_loading_clamps_them() {
        let (_dir, db) = fresh();
        let wide = update(&db, |s| {
            s.chat_width = 5000;
            Ok(())
        });
        assert_eq!(
            wide,
            Err("the chat width must be between 300 and 1400 pixels".into())
        );
        let tiny = update(&db, |s| {
            s.board_font_size = 4;
            Ok(())
        });
        assert_eq!(
            tiny,
            Err("the board font size must be between 11 and 20".into())
        );
        db.set_setting(KEY_DETAIL_WIDTH, "9000").unwrap();
        db.set_setting(KEY_THEME, "sepia").unwrap();
        let loaded = load(&db).unwrap();
        assert_eq!(loaded.detail_width, *DETAIL_WIDTH.range.end());
        assert_eq!(loaded.theme, Theme::Light);
    }

    #[test]
    fn helper_flags_are_not_written_by_a_window_save() {
        let (_dir, db) = fresh();
        remember_helper_started(&db).unwrap();
        set_helper_asking(&db, true).unwrap();
        let mut stale = load(&db).unwrap();
        stale.helper_started = false;
        assert!(store(&db, &stale).unwrap().helper_started);
        assert!(helper_asking(&db).unwrap());
        set_helper_asking(&db, false).unwrap();
        assert!(!helper_asking(&db).unwrap());
    }

    #[test]
    fn a_font_is_chosen_by_preset_name_or_installed_family() {
        let (_dir, db) = fresh();
        let mut settings = load(&db).unwrap();
        let preset = &font_presets(Surface::Board)[1];
        set_font(
            &mut settings,
            Surface::Board,
            &preset.name.to_uppercase(),
            Vec::new,
        )
        .unwrap();
        assert_eq!(settings.board_font, preset.key);

        let installed = || vec!["Fira Code".to_string(), "Iosevka".to_string()];
        set_font(&mut settings, Surface::Chat, "fira code", installed).unwrap();
        assert_eq!(settings.chat_font, "family:Fira Code");
        assert_eq!(settings.chat_added_fonts, ["Fira Code"]);
        set_font(&mut settings, Surface::Chat, "Fira Code", Vec::new).unwrap();
        assert_eq!(settings.chat_added_fonts, ["Fira Code"]);

        assert_eq!(
            set_font(&mut settings, Surface::Chat, "Comic Mono", installed),
            Err("no font named \"Comic Mono\" is installed".into())
        );
    }

    #[test]
    fn the_shared_font_table_lists_presets_for_both_surfaces() {
        for surface in [Surface::Chat, Surface::Board] {
            assert_eq!(font_presets(surface).len(), 4);
            assert!(font_sizes(surface).contains(&14));
        }
        assert_eq!(font_presets(Surface::Board)[0].key, DEFAULT_BOARD_FONT);
    }
}
