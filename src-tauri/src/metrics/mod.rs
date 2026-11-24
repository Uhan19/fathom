pub mod memory;
mod procs;

use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use serde::Deserialize;
use tauri::{AppHandle, Emitter};

use crate::herdr::Terminal;
use crate::launch;
use crate::state::{AppState, now_ms};
use crate::workers::LIVE;
use memory::{MemorySample, Roots, TerminalRoot, WorkerRoot};

pub const EVENT_MEMORY: &str = "metrics://memory";
const MEMORY_EVERY: Duration = Duration::from_secs(3);

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
    let roots = if connected {
        herdr_roots(state)
    } else {
        Roots {
            fathom: vec![std::process::id()],
            ..Roots::default()
        }
    };
    Ok(memory::group(
        &machine,
        &roots,
        connected,
        now_ms(),
        &procs::args_of,
    ))
}

fn herdr_roots(state: &AppState) -> Roots {
    let terminals = state.herdr.terminals();
    let chat_label = state.settings.lock().unwrap().terminal_label.clone();
    let titles = card_titles(state);
    let mut fathom = vec![std::process::id()];
    fathom.extend(
        terminals
            .values()
            .filter(|t| is_live(t) && has_label(t, &launch::helper_label()))
            .map(|t| t.pid),
    );
    let workers = state
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
        .collect();
    Roots {
        fathom,
        orchestrator: orchestrator(&terminals, &chat_label),
        workers,
    }
}

fn orchestrator(terminals: &BTreeMap<String, Terminal>, chat_label: &str) -> Option<TerminalRoot> {
    let find = |label: &str| {
        terminals
            .values()
            .find(|t| is_live(t) && has_label(t, label))
    };
    find(chat_label)
        .or_else(|| find(&launch::chat_label()))
        .map(|t| TerminalRoot {
            terminal: t.address.clone(),
            pid: t.pid,
        })
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

    #[test]
    fn the_orchestrator_is_the_labelled_chat_terminal_or_fathoms_own_chat() {
        let terminals: BTreeMap<String, Terminal> = [
            terminal("t1", 11, &[("firstmate.role", "primary")]),
            terminal("t2", 12, &[("fathom.role", "chat")]),
            terminal("t3", 0, &[("crew.role", "lead")]),
        ]
        .into_iter()
        .map(|t| (t.address.clone(), t))
        .collect();
        let found = |label: &str| orchestrator(&terminals, label).map(|o| o.terminal);
        assert_eq!(found("firstmate.role=primary").as_deref(), Some("t1"));
        assert_eq!(found("team.role=lead").as_deref(), Some("t2"));
        assert_eq!(found("crew.role=lead").as_deref(), Some("t2"));
    }
}
