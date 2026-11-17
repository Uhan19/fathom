use std::path::Path;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};

pub const TASK_LIST: &str = "backlog.md";
const STATE_DIR: &str = "state";
const META_EXTENSION: &str = "meta";
const INBOX_DIR: &str = "inbox";
const REPLIES_DIR: &str = ".replies";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StateChange {
    Workers,
    Replies,
}

pub fn watch_task_list(
    home: &Path,
    on_change: impl Fn() + Send + 'static,
) -> Result<RecommendedWatcher, String> {
    let data = home.join("data");
    let mut watcher = notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
        if let Ok(event) = result
            && event
                .paths
                .iter()
                .any(|p| p.file_name().is_some_and(|n| n == TASK_LIST))
        {
            on_change();
        }
    })
    .map_err(|e| format!("cannot start the file watcher: {e}"))?;
    watcher
        .watch(&data, RecursiveMode::NonRecursive)
        .map_err(|e| format!("cannot watch {}: {e}", data.display()))?;
    Ok(watcher)
}

pub fn watch_state(
    home: &Path,
    on_change: impl Fn(StateChange) + Send + 'static,
) -> Result<RecommendedWatcher, String> {
    let state = home.join(STATE_DIR);
    let mut watcher = notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
        let Ok(event) = result else { return };
        let mut changes: Vec<StateChange> =
            event.paths.iter().filter_map(|p| classify(p)).collect();
        changes.dedup();
        for change in changes {
            on_change(change);
        }
    })
    .map_err(|e| format!("cannot start the file watcher: {e}"))?;
    watcher
        .watch(&state, RecursiveMode::Recursive)
        .map_err(|e| format!("cannot watch {}: {e}", state.display()))?;
    Ok(watcher)
}

fn classify(path: &Path) -> Option<StateChange> {
    let parent = path.parent()?;
    let named = |dir: &Path, name: &str| dir.file_name().is_some_and(|n| n == name);
    if named(parent, STATE_DIR) && path.extension().is_some_and(|e| e == META_EXTENSION) {
        return Some(StateChange::Workers);
    }
    let inbox = parent.parent()?;
    if named(parent, REPLIES_DIR)
        && named(inbox, INBOX_DIR)
        && inbox.parent().is_some_and(|s| named(s, STATE_DIR))
    {
        return Some(StateChange::Replies);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    #[test]
    fn reports_changes_to_the_task_list_only() {
        let home = tempfile::tempdir().unwrap();
        let data = home.path().join("data");
        std::fs::create_dir_all(&data).unwrap();
        std::fs::write(data.join(TASK_LIST), "first").unwrap();
        let (tx, rx) = mpsc::channel();
        let _watcher = watch_task_list(home.path(), move || {
            let _ = tx.send(());
        })
        .unwrap();
        std::thread::sleep(Duration::from_millis(300));
        while rx.try_recv().is_ok() {}
        std::fs::write(data.join("other.md"), "noise").unwrap();
        assert!(rx.recv_timeout(Duration::from_millis(800)).is_err());
        std::fs::write(data.join(TASK_LIST), "second").unwrap();
        assert!(rx.recv_timeout(Duration::from_secs(5)).is_ok());
    }

    #[test]
    fn classifies_meta_records_and_inbox_replies() {
        let home = Path::new("/fm");
        let at = |p: &str| classify(&home.join(p));
        assert_eq!(at("state/atl-12.meta"), Some(StateChange::Workers));
        assert_eq!(at("state/inbox/.replies/n-1"), Some(StateChange::Replies));
        assert_eq!(at("state/atl-12.status"), None);
        assert_eq!(at("state/inbox/n-1.note"), None);
        assert_eq!(at("state/deeper/atl-12.meta"), None);
        assert_eq!(at("data/inbox/.replies/n-1"), None);
    }

    #[test]
    fn reports_meta_and_reply_changes_under_the_state_folder() {
        let home = tempfile::tempdir().unwrap();
        let replies = home.path().join("state/inbox/.replies");
        std::fs::create_dir_all(&replies).unwrap();
        let (tx, rx) = mpsc::channel();
        let _watcher = watch_state(home.path(), move |change| {
            let _ = tx.send(change);
        })
        .unwrap();
        std::thread::sleep(Duration::from_millis(300));
        while rx.try_recv().is_ok() {}
        std::fs::write(home.path().join("state/atl-12.meta"), "backend=hc").unwrap();
        assert_eq!(
            rx.recv_timeout(Duration::from_secs(5)),
            Ok(StateChange::Workers)
        );
        while rx.recv_timeout(Duration::from_millis(300)).is_ok() {}
        std::fs::write(replies.join("n-1"), "id=n-1").unwrap();
        assert_eq!(
            rx.recv_timeout(Duration::from_secs(5)),
            Ok(StateChange::Replies)
        );
    }
}
