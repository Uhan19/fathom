use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};

use crate::shell_path;
use crate::toon::{self, Record};

const WRAPPER: &str = "bin/fm-tasks-axi.sh";
const LIST_FIELDS: &str = "hold_kind,hold_until,hold_reason,blocked_by,links,priority,closed";
const TRUNCATION_MARK: &str = "\n... (truncated";
const ENV_TO_CLEAR: [&str; 3] = ["FM_DATA_OVERRIDE", "FM_ROOT_OVERRIDE", "TASKS_AXI_FILE"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Row {
    Surface,
    Shallows,
    Deep,
    Seabed,
    Landed,
}

impl Row {
    pub const ALL: [Row; 5] = [
        Row::Surface,
        Row::Shallows,
        Row::Deep,
        Row::Seabed,
        Row::Landed,
    ];

    pub fn key(self) -> &'static str {
        match self {
            Row::Surface => "surface",
            Row::Shallows => "shallows",
            Row::Deep => "deep",
            Row::Seabed => "seabed",
            Row::Landed => "landed",
        }
    }

    pub fn default_name(self) -> &'static str {
        match self {
            Row::Surface => "Surface",
            Row::Shallows => "Shallows",
            Row::Deep => "Deep",
            Row::Seabed => "Seabed",
            Row::Landed => "Landed",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Link {
    pub kind: String,
    pub target: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Card {
    pub id: String,
    pub title: String,
    pub state: String,
    pub kind: String,
    pub project: String,
    pub row: Row,
    pub hold_kind: String,
    pub hold_until: String,
    pub hold_reason: String,
    pub blocked_by: Vec<String>,
    pub links: Vec<Link>,
    pub closed: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Detail {
    pub card: Card,
    pub body: String,
    pub created: String,
    pub priority: String,
    pub deps: Vec<String>,
}

pub fn row_for(state: &str, hold_kind: &str, hold_until: &str) -> Row {
    if state == "done" {
        return Row::Landed;
    }
    match hold_kind {
        "parked" => Row::Deep,
        "captain" if hold_until.is_empty() => Row::Surface,
        "captain" => Row::Deep,
        _ if state == "in_flight" => Row::Shallows,
        _ => Row::Seabed,
    }
}

pub fn read_board(home: &Path) -> Result<Vec<Card>, String> {
    let text = run(home, &["list", "--fields", LIST_FIELDS])?;
    Ok(toon::parse_list(&text)?.iter().map(card_from).collect())
}

pub fn read_detail(home: &Path, id: &str) -> Result<Detail, String> {
    let text = run(home, &["show", id, "--full"])?;
    let record = toon::parse_object(&text, "task")?;
    Ok(Detail {
        card: card_from(&record),
        body: field(&record, "body"),
        created: field(&record, "created"),
        priority: field(&record, "priority"),
        deps: split_list(&field(&record, "deps")),
    })
}

pub fn wrapper_path(home: &Path) -> PathBuf {
    home.join(WRAPPER)
}

fn run(home: &Path, args: &[&str]) -> Result<String, String> {
    let wrapper = wrapper_path(home);
    if !wrapper.is_file() {
        return Err(format!(
            "{} not found; check the Firstmate home setting",
            wrapper.display()
        ));
    }
    let mut command = Command::new(&wrapper);
    command
        .args(args)
        .current_dir(home)
        .env("FM_HOME", home)
        .env("PATH", shell_path::get());
    for name in ENV_TO_CLEAR {
        command.env_remove(name);
    }
    let output = command
        .output()
        .map_err(|e| format!("cannot run {}: {e}", wrapper.display()))?;
    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    if output.status.success() {
        Ok(stdout)
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let message = if stdout.contains("error:") {
            toon::error_message(&stdout)
        } else {
            stderr.trim().to_string()
        };
        Err(message)
    }
}

fn card_from(record: &Record) -> Card {
    let state = field(record, "state");
    let hold_kind = field(record, "hold_kind");
    let hold_until = field(record, "hold_until");
    Card {
        id: field(record, "id"),
        title: clean_title(&field(record, "title")),
        row: row_for(&state, &hold_kind, &hold_until),
        state,
        kind: field(record, "kind"),
        project: field(record, "repo"),
        hold_kind,
        hold_until,
        hold_reason: field(record, "hold_reason"),
        blocked_by: split_list(&field(record, "blocked_by")),
        links: parse_links(&field(record, "links")),
        closed: field(record, "closed"),
    }
}

fn field(record: &Record, name: &str) -> String {
    record.get(name).cloned().unwrap_or_default()
}

fn clean_title(raw: &str) -> String {
    match raw.find(TRUNCATION_MARK) {
        Some(cut) => format!("{}…", raw[..cut].trim_end()),
        None => raw.to_string(),
    }
}

fn split_list(raw: &str) -> Vec<String> {
    raw.split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect()
}

fn parse_links(raw: &str) -> Vec<Link> {
    split_list(raw)
        .into_iter()
        .filter_map(|entry| {
            let (kind, target) = entry.split_once(':')?;
            Some(Link {
                kind: kind.to_string(),
                target: target.to_string(),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rows_follow_the_design_table() {
        assert_eq!(row_for("done", "", ""), Row::Landed);
        assert_eq!(row_for("done", "captain", ""), Row::Landed);
        assert_eq!(row_for("in_flight", "parked", ""), Row::Deep);
        assert_eq!(row_for("queued", "parked", ""), Row::Deep);
        assert_eq!(row_for("in_flight", "captain", "2026-12-01"), Row::Deep);
        assert_eq!(row_for("in_flight", "captain", "2020-01-01"), Row::Deep);
        assert_eq!(row_for("in_flight", "captain", ""), Row::Surface);
        assert_eq!(row_for("queued", "captain", ""), Row::Surface);
        assert_eq!(row_for("in_flight", "", ""), Row::Shallows);
        assert_eq!(row_for("in_flight", "external", ""), Row::Shallows);
        assert_eq!(row_for("queued", "", ""), Row::Seabed);
        assert_eq!(row_for("queued", "future", "2026-12-01"), Row::Seabed);
    }

    #[test]
    fn truncated_titles_end_with_an_ellipsis() {
        let raw = "A long title cut at eighty\n... (truncated, 120 chars total - use show x --full to see complete text)";
        assert_eq!(clean_title(raw), "A long title cut at eighty…");
        assert_eq!(clean_title("Short"), "Short");
    }

    #[test]
    fn links_split_into_kind_and_target() {
        let links = parse_links("pr:https://example.com/pull/3,report:data/x/report.md");
        assert_eq!(
            links[0],
            Link {
                kind: "pr".into(),
                target: "https://example.com/pull/3".into()
            }
        );
        assert_eq!(links[1].kind, "report");
        assert_eq!(links[1].target, "data/x/report.md");
    }

    #[test]
    fn card_from_list_record() {
        let text = "tasks[1]{id,state,kind,repo,title,hold_kind,hold_until,hold_reason,blocked_by,links,priority,closed}:\n  harbor-lights,queued,ship,harbor,Fix the harbor lights,\"-\",\"-\",\"-\",tide-gauge,none,\"-\",\"-\"\n";
        let record = &toon::parse_list(text).unwrap()[0];
        let card = card_from(record);
        assert_eq!(card.row, Row::Seabed);
        assert_eq!(card.project, "harbor");
        assert_eq!(card.blocked_by, vec!["tide-gauge".to_string()]);
        assert!(card.links.is_empty());
    }
}

#[cfg(test)]
mod home_tests {
    use super::*;

    #[test]
    #[ignore = "needs FATHOM_TEST_HOME pointing at a Firstmate home copy"]
    fn reads_a_real_home() {
        let home = PathBuf::from(std::env::var("FATHOM_TEST_HOME").expect("FATHOM_TEST_HOME"));
        let cards = read_board(&home).unwrap();
        assert!(!cards.is_empty());
        for row in Row::ALL {
            println!(
                "{:>9}: {}",
                row.key(),
                cards.iter().filter(|c| c.row == row).count()
            );
        }
        let detail = read_detail(&home, &cards[0].id).unwrap();
        assert_eq!(detail.card.id, cards[0].id);
        assert!(!detail.card.title.contains("(truncated"));
    }
}
