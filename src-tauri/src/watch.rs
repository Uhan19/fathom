use std::path::Path;
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};

pub const TASK_LIST: &str = "backlog.md";
const STATE_DIR: &str = "state";
const META_EXTENSION: &str = "meta";
const STATUS_EXTENSION: &str = "status";
const INBOX_DIR: &str = "inbox";
const REPLIES_DIR: &str = ".replies";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StateChange {
    Workers,
    Replies,
    Updates,
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

pub fn poll_store(
    interval: Duration,
    changed_elsewhere: impl Fn() -> Option<bool> + Send + 'static,
    on_change: impl Fn() + Send + 'static,
) {
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(interval);
            match changed_elsewhere() {
                None => return,
                Some(true) => on_change(),
                Some(false) => {}
            }
        }
    });
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
    if named(parent, STATE_DIR) {
        let extension = path.extension()?;
        if extension == META_EXTENSION {
            return Some(StateChange::Workers);
        }
        if extension == STATUS_EXTENSION {
            return Some(StateChange::Updates);
        }
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
    fn reports_store_writes_from_other_connections_only() {
        use crate::db::Db;
        use crate::db::backlog::NewTask;
        use std::sync::{Arc, Mutex};

        let dir = tempfile::tempdir().unwrap();
        let app = Arc::new(Mutex::new(Db::open(dir.path()).unwrap()));
        let store = app.lock().unwrap().path().to_path_buf();
        let (tx, rx) = mpsc::channel();
        let watched = Arc::downgrade(&app);
        poll_store(
            Duration::from_millis(20),
            move || {
                let db = watched.upgrade()?;
                let changed = db.lock().unwrap().changed_elsewhere();
                Some(changed.unwrap_or(false))
            },
            move || {
                let _ = tx.send(());
            },
        );

        app.lock().unwrap().set_setting("home", "").unwrap();
        assert!(rx.recv_timeout(Duration::from_millis(300)).is_err());

        let other = Db::open_file(&store).unwrap();
        other
            .add_task(
                &NewTask {
                    title: "Chart the reef".into(),
                    project: "reef-map".into(),
                    ..NewTask::default()
                },
                1,
            )
            .unwrap();
        assert!(rx.recv_timeout(Duration::from_secs(2)).is_ok());
        assert!(rx.recv_timeout(Duration::from_millis(300)).is_err());

        drop(app);
        std::thread::sleep(Duration::from_millis(100));
    }

    #[test]
    fn classifies_meta_records_status_logs_and_inbox_replies() {
        let home = Path::new("/fm");
        let at = |p: &str| classify(&home.join(p));
        assert_eq!(at("state/atl-12.meta"), Some(StateChange::Workers));
        assert_eq!(at("state/inbox/.replies/n-1"), Some(StateChange::Replies));
        assert_eq!(at("state/atl-12.status"), Some(StateChange::Updates));
        assert_eq!(at("state/deeper/atl-12.status"), None);
        assert_eq!(at("state/atl-12"), None);
        assert_eq!(at("state/inbox/n-1.note"), None);
        assert_eq!(at("state/deeper/atl-12.meta"), None);
        assert_eq!(at("data/inbox/.replies/n-1"), None);
    }

    #[test]
    fn reports_meta_reply_and_status_changes_under_the_state_folder() {
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
        while rx.recv_timeout(Duration::from_millis(300)).is_ok() {}
        std::fs::write(
            home.path().join("state/atl-12.status"),
            "working [at=1]: setup done\n",
        )
        .unwrap();
        assert_eq!(
            rx.recv_timeout(Duration::from_secs(5)),
            Ok(StateChange::Updates)
        );
    }
}
