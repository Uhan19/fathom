use std::collections::{BTreeMap, HashMap};
use std::path::Path;

use serde::Serialize;

use crate::herdr::Terminal;

const META_EXTENSION: &str = "meta";
const HC_BACKEND: &str = "hc";
const LIVE: &str = "live";
const WORKING: &str = "working";
const DEFAULT_SESSION: &str = "default";
const REQUIRED_KEYS: [&str; 3] = ["backend", "hc_session", "hc_terminal"];

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum WorkerStatus {
    Working,
    Idle,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Worker {
    pub task_id: String,
    pub terminal: String,
    pub status: WorkerStatus,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Binding {
    pub task_id: String,
    pub session: String,
    pub terminal: String,
}

pub fn read_bindings(home: &Path) -> Vec<Binding> {
    let Ok(entries) = std::fs::read_dir(home.join("state")) else {
        return vec![];
    };
    let mut bindings: Vec<Binding> = entries
        .flatten()
        .filter(|entry| entry.file_type().is_ok_and(|t| t.is_file()))
        .filter_map(|entry| {
            let path = entry.path();
            if path.extension()? != META_EXTENSION {
                return None;
            }
            let task_id = path.file_stem()?.to_str()?;
            parse_meta(task_id, &std::fs::read_to_string(&path).ok()?)
        })
        .collect();
    bindings.sort_by(|a, b| a.task_id.cmp(&b.task_id));
    bindings
}

pub fn parse_meta(task_id: &str, text: &str) -> Option<Binding> {
    if !is_atom(task_id) {
        return None;
    }
    let mut fields: HashMap<&str, Vec<&str>> = HashMap::new();
    for line in text.lines() {
        if let Some((key, value)) = line.split_once('=') {
            fields.entry(key.trim()).or_default().push(value.trim());
        }
    }
    let single = |key: &str| match fields.get(key).map(Vec::as_slice) {
        Some([value]) if !value.is_empty() => Some(value.to_string()),
        _ => None,
    };
    let [backend, session, terminal] = REQUIRED_KEYS.map(|key| single(key).filter(|v| is_atom(v)));
    let (session, terminal) = (session?, terminal?);
    if backend? != HC_BACKEND {
        return None;
    }
    let matches = |key: &str, expected: &str| {
        !fields.contains_key(key) || single(key).is_some_and(|v| v == expected)
    };
    if !matches("window", &format!("{session}:{terminal}")) || !matches("endpoint_task_id", task_id)
    {
        return None;
    }
    Some(Binding {
        task_id: task_id.to_string(),
        session,
        terminal,
    })
}

fn is_atom(value: &str) -> bool {
    !value.is_empty()
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "._@%+-".contains(c))
}

pub fn live_workers(
    bindings: &[Binding],
    session: &str,
    terminals: &BTreeMap<String, Terminal>,
) -> Vec<Worker> {
    let session = match session.trim() {
        "" => DEFAULT_SESSION,
        named => named,
    };
    bindings
        .iter()
        .filter(|b| b.session == session)
        .filter_map(|b| {
            let terminal = terminals.get(&b.terminal).filter(|t| t.state == LIVE)?;
            Some(Worker {
                task_id: b.task_id.clone(),
                terminal: b.terminal.clone(),
                status: if terminal.status == WORKING {
                    WorkerStatus::Working
                } else {
                    WorkerStatus::Idle
                },
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const GOOD: &str = "backend=hc\nhc_session=reef\nhc_terminal=t4\nwindow=reef:t4\nendpoint_task_id=atl-12\nkind=ship\n";

    fn binding(task: &str, session: &str, terminal: &str) -> Binding {
        Binding {
            task_id: task.into(),
            session: session.into(),
            terminal: terminal.into(),
        }
    }

    #[test]
    fn a_valid_hc_record_binds_the_task_to_its_terminal() {
        assert_eq!(
            parse_meta("atl-12", GOOD),
            Some(binding("atl-12", "reef", "t4"))
        );
    }

    #[test]
    fn records_for_other_backends_or_with_bad_fields_are_ignored() {
        let swap = |from: &str, to: &str| GOOD.replace(from, to);
        assert_eq!(
            parse_meta("atl-12", &swap("backend=hc", "backend=tmux")),
            None
        );
        assert_eq!(parse_meta("atl-12", &swap("hc_terminal=t4\n", "")), None);
        assert_eq!(
            parse_meta("atl-12", &swap("hc_terminal=t4", "hc_terminal=")),
            None
        );
        assert_eq!(
            parse_meta("atl-12", &swap("window=reef:t4", "window=reef:t9")),
            None
        );
        assert_eq!(parse_meta("atl-13", GOOD), None);
        assert_eq!(
            parse_meta("atl-12", &format!("{GOOD}hc_terminal=t5\n")),
            None
        );
        assert_eq!(
            parse_meta("atl-12", &swap("hc_session=reef", "hc_session=re ef")),
            None
        );
        assert_eq!(parse_meta("../x", GOOD), None);
    }

    fn terminal(address: &str, state: &str, status: &str) -> Terminal {
        Terminal {
            address: address.into(),
            state: state.into(),
            status: status.into(),
            ..Terminal::default()
        }
    }

    #[test]
    fn only_live_terminals_in_the_configured_session_count() {
        let bindings = [
            binding("busy", "default", "t1"),
            binding("resting", "default", "t2"),
            binding("blocked", "default", "t3"),
            binding("gone", "default", "t9"),
            binding("ended", "default", "t4"),
            binding("elsewhere", "lab", "t1"),
        ];
        let terminals: BTreeMap<String, Terminal> = [
            terminal("t1", "live", "working"),
            terminal("t2", "live", "idle"),
            terminal("t3", "live", "blocked"),
            terminal("t4", "finished", "working"),
        ]
        .into_iter()
        .map(|t| (t.address.clone(), t))
        .collect();
        let workers = live_workers(&bindings, "", &terminals);
        let seen: Vec<(&str, &WorkerStatus)> = workers
            .iter()
            .map(|w| (w.task_id.as_str(), &w.status))
            .collect();
        assert_eq!(
            seen,
            [
                ("busy", &WorkerStatus::Working),
                ("resting", &WorkerStatus::Idle),
                ("blocked", &WorkerStatus::Idle),
            ]
        );
        assert_eq!(
            live_workers(&bindings, "lab", &terminals)[0].task_id,
            "elsewhere"
        );
    }

    #[test]
    fn bindings_are_read_from_meta_files_in_the_state_folder() {
        let home = tempfile::tempdir().unwrap();
        let state = home.path().join("state");
        std::fs::create_dir_all(state.join("nested.meta")).unwrap();
        std::fs::write(state.join("atl-12.meta"), GOOD).unwrap();
        std::fs::write(state.join("atl-12.status"), "working").unwrap();
        std::fs::write(state.join("other.meta"), "backend=tmux\n").unwrap();
        assert_eq!(
            read_bindings(home.path()),
            [binding("atl-12", "reef", "t4")]
        );
        assert!(read_bindings(&home.path().join("missing")).is_empty());
    }
}
