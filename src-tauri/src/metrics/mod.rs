pub mod memory;
mod procs;

use std::collections::{BTreeMap, HashMap};
use std::path::Path;
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use serde::Deserialize;
use tauri::{AppHandle, Emitter};

use crate::herdr::Terminal;
use crate::launch;
use crate::source::Source;
use crate::state::{AppState, now_ms};
use crate::workers::LIVE;
use memory::{Machine, MemorySample, Roots, TerminalRoot, WorkerRoot};

pub const EVENT_MEMORY: &str = "metrics://memory";
const MEMORY_EVERY: Duration = Duration::from_secs(3);
const SESSION_LOCK: &str = "state/.lock";
const MAX_ANCESTRY: usize = 64;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Demand {
    pub dashboard: bool,
    pub badges: bool,
}

#[derive(Default)]
pub struct Metrics {
    demand: Mutex<Demand>,
    wake: Condvar,
    latest: Mutex<Option<MemorySample>>,
}

impl Metrics {
    pub fn start(app: AppHandle, state: Arc<AppState>) -> Arc<Metrics> {
        let metrics = Arc::new(Metrics::default());
        let sampler = Arc::clone(&metrics);
        std::thread::spawn(move || sampler.run_memory(&app, &state));
        metrics
    }

    pub fn set_demand(&self, demand: Demand) {
        *self.demand.lock().unwrap() = demand;
        self.wake.notify_all();
    }

    pub fn memory(&self, state: &AppState) -> Result<MemorySample, String> {
        if let Some(latest) = self.latest.lock().unwrap().clone() {
            return Ok(latest);
        }
        sample_memory(state)
    }

    fn run_memory(&self, app: &AppHandle, state: &AppState) {
        let mut demand = *self.demand.lock().unwrap();
        loop {
            if demand.dashboard || (demand.badges && !state.workers().is_empty()) {
                match sample_memory(state) {
                    Ok(sample) => {
                        let _ = app.emit(EVENT_MEMORY, &sample);
                        *self.latest.lock().unwrap() = Some(sample);
                    }
                    Err(error) => eprintln!("fathom: cannot read memory: {error}"),
                }
            } else {
                *self.latest.lock().unwrap() = None;
            }
            let guard = self.demand.lock().unwrap();
            let (guard, _) = self.wake.wait_timeout(guard, MEMORY_EVERY).unwrap();
            demand = *guard;
        }
    }
}

pub fn sample_memory(state: &AppState) -> Result<MemorySample, String> {
    let machine = procs::machine()?;
    let connected = state.herdr_status.lock().unwrap().connected;
    let terminals = if connected {
        state.herdr.terminals()
    } else {
        BTreeMap::new()
    };
    let roots = roots(state, &terminals, &machine);
    Ok(memory::group(
        &machine,
        &roots,
        connected,
        now_ms(),
        &procs::args_of,
    ))
}

fn roots(state: &AppState, terminals: &BTreeMap<String, Terminal>, machine: &Machine) -> Roots {
    let chat_label = state.settings.lock().unwrap().terminal_label.clone();
    let titles = card_titles(state);
    let mut fathom = vec![std::process::id()];
    fathom.extend(
        terminals
            .values()
            .filter(|t| is_live(t) && has_label(t, &launch::helper_label()))
            .map(|t| t.pid),
    );
    let workers = if terminals.is_empty() {
        vec![]
    } else {
        state
            .workers()
            .into_iter()
            .filter_map(|worker| {
                let terminal = terminals.get(&worker.terminal).filter(|t| is_live(t))?;
                Some(WorkerRoot {
                    title: titles
                        .get(&worker.task_id)
                        .cloned()
                        .unwrap_or_else(|| worker.task_id.clone()),
                    task_id: worker.task_id,
                    terminal: terminal.address.clone(),
                    pid: terminal.pid,
                })
            })
            .collect()
    };
    let helm = match state.source() {
        Source::Firstmate { home } => helm_pid(&home),
        Source::Backlog => None,
    };
    let parents: HashMap<u32, u32> = machine
        .processes
        .iter()
        .map(|p| (p.pid, p.parent))
        .collect();
    Roots {
        fathom,
        orchestrator: orchestrator(helm, &parents, terminals, &chat_label),
        workers,
    }
}

fn helm_pid(home: &Path) -> Option<u32> {
    let lock = std::fs::read_to_string(home.join(SESSION_LOCK)).ok()?;
    lock.lines()
        .next()?
        .trim()
        .parse()
        .ok()
        .filter(|pid| *pid > 1)
}

fn orchestrator(
    helm: Option<u32>,
    parents: &HashMap<u32, u32>,
    terminals: &BTreeMap<String, Terminal>,
    chat_label: &str,
) -> Option<TerminalRoot> {
    let live: Vec<&Terminal> = terminals.values().filter(|t| is_live(t)).collect();
    if let Some(helm) = helm.filter(|pid| parents.contains_key(pid)) {
        let holding = ancestry(helm, parents).find_map(|pid| live.iter().find(|t| t.pid == pid));
        return Some(match holding {
            Some(t) => TerminalRoot {
                terminal: Some(t.address.clone()),
                pid: t.pid,
            },
            None => TerminalRoot {
                terminal: None,
                pid: helm,
            },
        });
    }
    let find = |label: &str| live.iter().find(|t| has_label(t, label));
    find(chat_label)
        .or_else(|| find(&launch::chat_label()))
        .map(|t| TerminalRoot {
            terminal: Some(t.address.clone()),
            pid: t.pid,
        })
}

fn ancestry(pid: u32, parents: &HashMap<u32, u32>) -> impl Iterator<Item = u32> + '_ {
    std::iter::successors(Some(pid), |pid| {
        parents
            .get(pid)
            .copied()
            .filter(|parent| *parent > 1 && parent != pid)
    })
    .take(MAX_ANCESTRY)
}

fn is_live(terminal: &Terminal) -> bool {
    terminal.state == LIVE && terminal.pid > 0
}

fn has_label(terminal: &Terminal, label: &str) -> bool {
    label
        .trim()
        .split_once('=')
        .is_some_and(|(key, value)| terminal.labels.get(key).map(String::as_str) == Some(value))
}

fn card_titles(state: &AppState) -> HashMap<String, String> {
    let home = state.source().home();
    let snapshot = state.db.lock().unwrap().snapshot().ok().flatten();
    snapshot
        .filter(|s| s.home == home)
        .map(|s| s.cards.into_iter().map(|c| (c.id, c.title)).collect())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn terminal(address: &str, pid: u32, labels: &[(&str, &str)]) -> Terminal {
        Terminal {
            address: address.into(),
            state: LIVE.into(),
            pid,
            labels: labels
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
            ..Terminal::default()
        }
    }

    fn terminals(list: Vec<Terminal>) -> BTreeMap<String, Terminal> {
        list.into_iter().map(|t| (t.address.clone(), t)).collect()
    }

    fn labelled() -> BTreeMap<String, Terminal> {
        terminals(vec![
            terminal("t1", 11, &[("firstmate.role", "primary")]),
            terminal("t2", 12, &[("fathom.role", "chat")]),
            terminal("t3", 0, &[("crew.role", "lead")]),
            terminal("t4", 40, &[]),
        ])
    }

    fn parents() -> HashMap<u32, u32> {
        HashMap::from([
            (11, 5),
            (12, 5),
            (40, 5),
            (41, 40),
            (42, 41),
            (77, 1),
            (5, 1),
        ])
    }

    #[test]
    fn without_firstmates_record_the_orchestrator_is_the_labelled_chat_terminal() {
        let found = |label: &str| {
            orchestrator(None, &parents(), &labelled(), label).and_then(|o| o.terminal)
        };
        assert_eq!(found("firstmate.role=primary").as_deref(), Some("t1"));
        assert_eq!(found("team.role=lead").as_deref(), Some("t2"));
        assert_eq!(found("crew.role=lead").as_deref(), Some("t2"));
    }

    #[test]
    fn firstmates_session_lock_names_the_orchestrator_before_any_label() {
        let found = |helm| {
            orchestrator(
                Some(helm),
                &parents(),
                &labelled(),
                "firstmate.role=primary",
            )
        };
        assert_eq!(
            found(42),
            Some(TerminalRoot {
                terminal: Some("t4".into()),
                pid: 40
            })
        );
        assert_eq!(
            found(77),
            Some(TerminalRoot {
                terminal: None,
                pid: 77
            })
        );
        assert_eq!(found(999).and_then(|o| o.terminal).as_deref(), Some("t1"));
    }

    #[test]
    fn the_session_lock_pid_is_line_one_of_the_homes_lock_file() {
        let home = tempfile::tempdir().unwrap();
        assert_eq!(helm_pid(home.path()), None);
        std::fs::create_dir(home.path().join("state")).unwrap();
        std::fs::write(home.path().join(SESSION_LOCK), "4242\n").unwrap();
        assert_eq!(helm_pid(home.path()), Some(4242));
        std::fs::write(home.path().join(SESSION_LOCK), "win:4242\n").unwrap();
        assert_eq!(helm_pid(home.path()), None);
    }
}
