use std::path::Path;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};

pub const TASK_LIST: &str = "backlog.md";

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
}
