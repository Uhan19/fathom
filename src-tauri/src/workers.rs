use std::collections::{BTreeMap, HashMap};
use std::path::Path;

use serde::Serialize;

use crate::herdr::Terminal;
use crate::launch::TASK_KEY;
use crate::source::Source;

const META_EXTENSION: &str = "meta";
const STATUS_EXTENSION: &str = "status";
const STATE_DIR: &str = "state";
const HC_BACKEND: &str = "hc";
pub const LIVE: &str = "live";
const WORKING: &str = "working";
const DEFAULT_SESSION: &str = "default";
const REQUIRED_KEYS: [&str; 3] = ["backend", "hc_session", "hc_terminal"];

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum WorkerStatus {
    Working,
    Idle,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentState {
    #[serde(rename = "none")]
    NoAgent,
    Inactive,
    Active,
}

impl AgentState {
    pub fn has_agent(self) -> bool {
        self != AgentState::NoAgent
    }

    pub fn is_active(self) -> bool {
        self == AgentState::Active
    }
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
    let Ok(entries) = std::fs::read_dir(home.join(STATE_DIR)) else {
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

pub fn read_status_marks(home: &Path) -> Result<BTreeMap<String, String>, String> {
    let state = home.join(STATE_DIR);
    let entries =
        std::fs::read_dir(&state).map_err(|e| format!("cannot read {}: {e}", state.display()))?;
    Ok(entries
        .flatten()
        .filter(|entry| entry.file_type().is_ok_and(|t| t.is_file()))
        .filter_map(|entry| {
            let path = entry.path();
            if path.extension()? != STATUS_EXTENSION {
                return None;
            }
            let task_id = path.file_stem()?.to_str().filter(|id| is_atom(id))?;
            let log = std::fs::read(&path).ok()?;
            Some((
                task_id.to_string(),
                status_mark(&String::from_utf8_lossy(&log))?,
            ))
        })
        .collect())
}

pub fn status_mark(log: &str) -> Option<String> {
    let lines: Vec<&str> = log
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect();
    Some(format!("{} {}", lines.len(), lines.last()?))
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

pub fn board_workers(
    source: &Source,
    session: &str,
    terminals: &BTreeMap<String, Terminal>,
) -> Vec<Worker> {
    match source {
        Source::Firstmate { home } => live_workers(&read_bindings(home), session, terminals),
        Source::Backlog => task_workers(terminals),
    }
}

pub fn agent_states(workers: &[Worker]) -> HashMap<String, AgentState> {
    let mut states: HashMap<String, AgentState> = HashMap::new();
    for worker in workers {
        let state = match worker.status {
            WorkerStatus::Working => AgentState::Active,
            WorkerStatus::Idle => AgentState::Inactive,
        };
        let known = states.entry(worker.task_id.clone()).or_insert(state);
        *known = (*known).max(state);
    }
    states
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
            Some(worker_on(&b.task_id, terminal))
        })
        .collect()
}

pub fn task_workers(terminals: &BTreeMap<String, Terminal>) -> Vec<Worker> {
    terminals
        .values()
        .filter(|t| t.state == LIVE)
        .filter_map(|t| {
            let task: i64 = t.labels.get(TASK_KEY)?.trim().parse().ok()?;
            Some(worker_on(&task.to_string(), t))
        })
        .collect()
}

fn worker_on(task_id: &str, terminal: &Terminal) -> Worker {
    Worker {
        task_id: task_id.to_string(),
        terminal: terminal.address.clone(),
        status: if terminal.status == WORKING {
            WorkerStatus::Working
        } else {
            WorkerStatus::Idle
        },
    }
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

    fn labeled(address: &str, state: &str, status: &str, labels: &[(&str, &str)]) -> Terminal {
        Terminal {
            labels: labels
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
            ..terminal(address, state, status)
        }
    }

    #[test]
    fn live_terminals_labeled_with_a_fathom_task_are_its_workers() {
        let terminals: BTreeMap<String, Terminal> = [
            labeled(
                "t1",
                "live",
                "working",
                &[("fathom.task", "7"), ("fathom.agent", "claude")],
            ),
            labeled("t2", "live", "idle", &[("fathom.task", "8")]),
            labeled("t3", "live", "blocked", &[("fathom.task", " 9 ")]),
            labeled("t4", "finished", "working", &[("fathom.task", "10")]),
            labeled("t5", "live", "working", &[("fathom.task", "reef")]),
            labeled("t6", "live", "working", &[("fathom.role", "chat")]),
            labeled("t7", "live", "working", &[("firstmate.task", "11")]),
        ]
        .into_iter()
        .map(|t| (t.address.clone(), t))
        .collect();
        let seen: Vec<(String, String, WorkerStatus)> = task_workers(&terminals)
            .into_iter()
            .map(|w| (w.task_id, w.terminal, w.status))
            .collect();
        assert_eq!(
            seen,
            [
                ("7".into(), "t1".into(), WorkerStatus::Working),
                ("8".into(), "t2".into(), WorkerStatus::Idle),
                ("9".into(), "t3".into(), WorkerStatus::Idle),
            ]
        );
    }

    #[test]
    fn a_working_worker_makes_the_agent_active_and_an_idle_one_inactive() {
        let worker = |task: &str, status: WorkerStatus| Worker {
            task_id: task.into(),
            terminal: "t1".into(),
            status,
        };
        let states = agent_states(&[
            worker("7", WorkerStatus::Idle),
            worker("7", WorkerStatus::Working),
            worker("8", WorkerStatus::Idle),
        ]);
        assert_eq!(states["7"], AgentState::Active);
        assert_eq!(states["8"], AgentState::Inactive);
        assert!(!states.contains_key("9"));
        assert!(AgentState::Inactive.has_agent());
        assert!(!AgentState::NoAgent.has_agent());
    }

    #[test]
    fn a_firstmate_home_binds_by_meta_file_and_ignores_fathom_task_labels() {
        let home = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(home.path().join("state")).unwrap();
        std::fs::write(home.path().join("state/atl-12.meta"), GOOD).unwrap();
        let terminals: BTreeMap<String, Terminal> = [
            labeled("t4", "live", "working", &[]),
            labeled("t5", "live", "working", &[("fathom.task", "atl-13")]),
            labeled("t6", "live", "idle", &[("fathom.task", "3")]),
        ]
        .into_iter()
        .map(|t| (t.address.clone(), t))
        .collect();
        assert_eq!(
            live_workers(&read_bindings(home.path()), "reef", &terminals),
            [Worker {
                task_id: "atl-12".into(),
                terminal: "t4".into(),
                status: WorkerStatus::Working,
            }]
        );
    }

    #[test]
    fn a_status_mark_counts_the_reported_lines_and_keeps_the_last() {
        assert_eq!(
            status_mark("working [at=1]: setup done\n\nblocked [at=2]: needs a key\n"),
            Some("2 blocked [at=2]: needs a key".into())
        );
        assert_eq!(
            status_mark("working [at=1]: setup done"),
            Some("1 working [at=1]: setup done".into())
        );
        assert_eq!(status_mark(""), None);
        assert_eq!(status_mark(" \n\n"), None);
    }

    #[test]
    fn status_marks_are_read_from_status_logs_in_the_state_folder() {
        let home = tempfile::tempdir().unwrap();
        let state = home.path().join("state");
        std::fs::create_dir_all(state.join("nested.status")).unwrap();
        std::fs::write(state.join("atl-12.status"), "working [at=1]: started\n").unwrap();
        std::fs::write(state.join("atl-13.status"), "").unwrap();
        std::fs::write(state.join("atl-12.meta"), GOOD).unwrap();
        std::fs::write(state.join("bad name.status"), "done [at=2]: shipped\n").unwrap();
        let marks = read_status_marks(home.path()).unwrap();
        assert_eq!(
            marks.into_iter().collect::<Vec<_>>(),
            [("atl-12".into(), "1 working [at=1]: started".into())]
        );

        let mut log = std::fs::OpenOptions::new()
            .append(true)
            .open(state.join("atl-12.status"))
            .unwrap();
        std::io::Write::write_all(&mut log, b"done [at=3]: PR https://example.com/pull/3\n")
            .unwrap();
        assert_eq!(
            read_status_marks(home.path()).unwrap()["atl-12"],
            "2 done [at=3]: PR https://example.com/pull/3"
        );
        assert!(read_status_marks(&home.path().join("missing")).is_err());
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
