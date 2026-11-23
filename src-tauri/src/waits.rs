use std::collections::BTreeMap;
use std::path::Path;

use serde::{Serialize, Serializer};
use serde_json::{Map, Value};

pub const WAITS_FILE: &str = "waits.json";
const DATA_DIR: &str = "data";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum WaitKind {
    PrReview,
    SlackReply,
    EmailReply,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Need {
    All,
    Any,
    Count(u64),
}

impl Serialize for Need {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Need::All => serializer.serialize_str("all"),
            Need::Any => serializer.serialize_str("any"),
            Need::Count(n) => serializer.serialize_u64(*n),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Wait {
    pub kind: WaitKind,
    pub what: String,
    pub who: Vec<String>,
    pub need: Need,
    pub since: Option<String>,
    pub link: Option<String>,
    pub state: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Person {
    pub github: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Waits {
    pub tasks: BTreeMap<String, Vec<Wait>>,
    pub people: BTreeMap<String, Person>,
}

pub fn read(home: &Path) -> Waits {
    let path = home.join(DATA_DIR).join(WAITS_FILE);
    let Ok(text) = std::fs::read_to_string(&path) else {
        return Waits::default();
    };
    parse(&text).unwrap_or_else(|error| {
        eprintln!("fathom: ignoring {}: {error}", path.display());
        Waits::default()
    })
}

pub fn parse(text: &str) -> Result<Waits, String> {
    let json: Value = serde_json::from_str(text).map_err(|e| e.to_string())?;
    let root = json.as_object().ok_or("expected a JSON object")?;
    let tasks = entries(root.get("tasks"))
        .filter_map(|(id, task)| {
            let waits: Vec<Wait> = task["waits"].as_array()?.iter().filter_map(wait).collect();
            (!waits.is_empty()).then(|| (id.trim().to_string(), waits))
        })
        .filter(|(id, _)| !id.is_empty())
        .collect();
    let people = entries(root.get("people"))
        .filter(|(name, entry)| !name.trim().is_empty() && entry.is_object())
        .map(|(name, entry)| {
            let github =
                text_of(&entry["github"]).map(|login| login.trim_start_matches('@').into());
            (name.trim().to_string(), Person { github })
        })
        .collect();
    Ok(Waits { tasks, people })
}

fn entries(value: Option<&Value>) -> impl Iterator<Item = (&String, &Value)> {
    value
        .and_then(Value::as_object)
        .into_iter()
        .flat_map(Map::iter)
}

fn text_of(value: &Value) -> Option<String> {
    let text = value.as_str()?.trim();
    (!text.is_empty()).then(|| text.to_string())
}

fn wait(entry: &Value) -> Option<Wait> {
    entry.as_object()?;
    let kind = match entry["kind"].as_str().map(str::trim) {
        Some("pr-review") => WaitKind::PrReview,
        Some("slack-reply") => WaitKind::SlackReply,
        Some("email-reply") => WaitKind::EmailReply,
        _ => WaitKind::Other,
    };
    let mut who: Vec<String> = Vec::new();
    let names = match &entry["who"] {
        Value::Array(names) => names.iter().filter_map(text_of).collect(),
        single => text_of(single).into_iter().collect::<Vec<_>>(),
    };
    for name in names {
        if !who.contains(&name) {
            who.push(name);
        }
    }
    let state = entries(Some(&entry["state"]))
        .filter_map(|(name, said)| Some((name.trim().to_string(), text_of(said)?)))
        .filter(|(name, _)| !name.is_empty())
        .collect();
    Some(Wait {
        kind,
        what: text_of(&entry["what"]).unwrap_or_default(),
        who,
        need: need_of(&entry["need"]),
        since: text_of(&entry["since"]),
        link: text_of(&entry["link"]),
        state,
    })
}

fn need_of(value: &Value) -> Need {
    let count = match value {
        Value::Number(n) => n.as_u64(),
        Value::String(s) => match s.trim() {
            "any" => return Need::Any,
            other => other.parse().ok(),
        },
        _ => None,
    };
    match count {
        Some(n) if n > 0 => Need::Count(n),
        _ => Need::All,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const SAMPLE: &str = r#"{
      "tasks": {
        "hrb-31": {"waits": [
          {"kind": "pr-review", "what": "Re-review of the cropper upgrade",
           "who": ["Mira", "Tomas", "Priya"], "need": 2, "since": "2026-11-20T09:30:00Z",
           "link": "https://github.com/example/harbor-web/pull/812"},
          {"kind": "slack-reply", "what": "Phone check of the photo upload", "who": ["Tomas"],
           "need": "all", "since": "2026-11-20T10:00:00Z", "link": null,
           "state": {"Tomas": "asked"}}
        ]},
        "lan-33": {"waits": [
          {"kind": "email-reply", "what": "Confirmation of the domain transfer", "who": [],
           "need": "any", "since": "2026-11-18T08:00:00Z", "link": null}
        ]},
        "atl-19": {"waits": []}
      },
      "people": {"Mira": {"github": "mira-k"}, "Tomas": {}}
    }"#;

    #[test]
    fn a_missing_file_means_no_waits() {
        let home = tempfile::tempdir().unwrap();
        assert_eq!(read(home.path()), Waits::default());
    }

    #[test]
    fn a_malformed_file_means_no_waits() {
        let home = tempfile::tempdir().unwrap();
        let data = home.path().join(DATA_DIR);
        std::fs::create_dir_all(&data).unwrap();
        for broken in ["{\"tasks\": {", "[1, 2]", "\"waits\"", ""] {
            std::fs::write(data.join(WAITS_FILE), broken).unwrap();
            assert_eq!(read(home.path()), Waits::default(), "{broken}");
        }
        std::fs::write(data.join(WAITS_FILE), SAMPLE).unwrap();
        assert_eq!(read(home.path()).tasks.len(), 2);
    }

    #[test]
    fn several_waits_keep_their_order_and_fields() {
        let waits = parse(SAMPLE).unwrap();
        let task = &waits.tasks["hrb-31"];
        assert_eq!(task.len(), 2);
        assert_eq!(task[0].kind, WaitKind::PrReview);
        assert_eq!(task[0].who, ["Mira", "Tomas", "Priya"]);
        assert_eq!(task[0].need, Need::Count(2));
        assert_eq!(
            task[0].link.as_deref(),
            Some("https://github.com/example/harbor-web/pull/812")
        );
        assert_eq!(task[1].kind, WaitKind::SlackReply);
        assert_eq!(task[1].need, Need::All);
        assert_eq!(task[1].link, None);
        assert_eq!(task[1].state["Tomas"], "asked");
        assert!(!waits.tasks.contains_key("atl-19"));
        assert_eq!(waits.people["Mira"].github.as_deref(), Some("mira-k"));
        assert_eq!(waits.people["Tomas"].github, None);
    }

    #[test]
    fn an_empty_who_still_counts_as_a_wait() {
        let waits = parse(SAMPLE).unwrap();
        let email = &waits.tasks["lan-33"][0];
        assert_eq!(email.kind, WaitKind::EmailReply);
        assert!(email.who.is_empty());
        assert_eq!(email.need, Need::Any);
        assert_eq!(email.since.as_deref(), Some("2026-11-18T08:00:00Z"));
    }

    #[test]
    fn odd_entries_are_cleaned_up_or_skipped() {
        let waits = parse(
            &json!({
                "tasks": {
                    "pil-14": {"waits": [
                        "not a wait",
                        {"kind": "carrier-pigeon", "who": [" Mira ", "", "Mira", 7], "need": "3"},
                        {"who": "Jun", "need": 0, "what": "  ", "link": "", "state": {"Jun": 5}}
                    ]},
                    "led-52": {"waits": "soon"},
                    "  ": {"waits": [{"kind": "other"}]}
                },
                "people": {"Jun": {"github": "@jun-o"}, "Sana": "sana-p"}
            })
            .to_string(),
        )
        .unwrap();
        assert_eq!(waits.tasks.keys().collect::<Vec<_>>(), ["pil-14"]);
        let [first, second] = waits.tasks["pil-14"].as_slice() else {
            panic!("expected two waits");
        };
        assert_eq!(first.kind, WaitKind::Other);
        assert_eq!(first.who, ["Mira"]);
        assert_eq!(first.need, Need::Count(3));
        assert_eq!(second.who, ["Jun"]);
        assert_eq!(second.need, Need::All);
        assert_eq!(second.what, "");
        assert_eq!(second.link, None);
        assert!(second.state.is_empty());
        assert_eq!(waits.people["Jun"].github.as_deref(), Some("jun-o"));
        assert!(!waits.people.contains_key("Sana"));
    }

    #[test]
    fn the_board_receives_the_shape_the_frontend_reads() {
        let waits = parse(SAMPLE).unwrap();
        let sent = serde_json::to_value(&waits).unwrap();
        assert_eq!(
            sent["tasks"]["hrb-31"][1],
            json!({
                "kind": "slack-reply",
                "what": "Phone check of the photo upload",
                "who": ["Tomas"],
                "need": "all",
                "since": "2026-11-20T10:00:00Z",
                "link": null,
                "state": {"Tomas": "asked"}
            })
        );
        assert_eq!(sent["tasks"]["hrb-31"][0]["need"], json!(2));
        assert_eq!(sent["people"]["Tomas"], json!({"github": null}));
    }

    #[test]
    fn need_serializes_as_a_word_or_a_number() {
        let need = |n| serde_json::to_value(n).unwrap();
        assert_eq!(need(Need::All), json!("all"));
        assert_eq!(need(Need::Any), json!("any"));
        assert_eq!(need(Need::Count(2)), json!(2));
    }
}
