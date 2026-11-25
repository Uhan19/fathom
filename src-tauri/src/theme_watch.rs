use std::path::{Component, Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter};

use crate::theme_check::{check_args, run_subprocess};
use crate::themes::{SHOTS_DIR, Themes, folder_hash};

pub const EVENT_THEMES: &str = "themes://updated";
const SETTLE: Duration = Duration::from_millis(800);

pub fn start(
    app: AppHandle,
    themes: Themes,
    program: PathBuf,
    db_file: PathBuf,
) -> Result<RecommendedWatcher, String> {
    let (changed, changes) = mpsc::channel::<()>();
    let root = themes.root.clone();
    std::thread::spawn(move || check_changes(&app, &themes, &program, &db_file, &changes));
    let _ = changed.send(());
    let mut watcher = notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
        if let Ok(event) = result
            && event.paths.iter().any(|p| counts(p))
        {
            let _ = changed.send(());
        }
    })
    .map_err(|e| format!("cannot start the themes watcher: {e}"))?;
    watcher
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|e| format!("cannot watch {}: {e}", root.display()))?;
    Ok(watcher)
}

fn counts(path: &Path) -> bool {
    !path
        .components()
        .any(|c| matches!(c, Component::Normal(name) if name == SHOTS_DIR))
}

fn check_changes(
    app: &AppHandle,
    themes: &Themes,
    program: &Path,
    db_file: &Path,
    changes: &mpsc::Receiver<()>,
) {
    while changes.recv().is_ok() {
        loop {
            match changes.recv_timeout(SETTLE) {
                Ok(()) => continue,
                Err(RecvTimeoutError::Timeout) => break,
                Err(RecvTimeoutError::Disconnected) => return,
            }
        }
        let _ = app.emit(EVENT_THEMES, ());
        for id in stale(themes) {
            let folder = themes.root.join(&id);
            if let Err(error) = run_subprocess(program, &check_args(&folder, Some(db_file))) {
                eprintln!("fathom: checking the theme {id} failed: {error}");
            }
            let _ = app.emit(EVENT_THEMES, ());
        }
    }
}

pub fn stale(themes: &Themes) -> Vec<String> {
    themes
        .ids()
        .into_iter()
        .filter(|id| {
            let current = folder_hash(&themes.root.join(id)).ok();
            current.is_some() && themes.record(id).map(|r| r.hash) != current
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::themes::MANIFEST_FILE;

    #[test]
    fn only_themes_whose_content_changed_since_their_check_are_stale() {
        let dir = tempfile::tempdir().unwrap();
        let themes = Themes::new(dir.path().join("themes"), &dir.path().join("data"));
        for id in ["riso", "kelp"] {
            let folder = themes.root.join(id);
            std::fs::create_dir_all(&folder).unwrap();
            std::fs::write(
                folder.join(MANIFEST_FILE),
                r#"{"fathomTheme":1,"name":"T"}"#,
            )
            .unwrap();
            std::fs::write(folder.join("theme.css"), "").unwrap();
        }
        assert_eq!(stale(&themes), vec!["kelp", "riso"]);
        let riso = themes.root.join("riso");
        let hash = folder_hash(&riso).unwrap();
        themes
            .store_result(
                "riso",
                &themes.snapshot("riso", &riso).unwrap().dir,
                &hash,
                vec![],
                1,
            )
            .unwrap();
        assert_eq!(stale(&themes), vec!["kelp"]);
        std::fs::write(riso.join("theme.css"), "body {}").unwrap();
        assert_eq!(stale(&themes), vec!["kelp", "riso"]);
    }

    #[test]
    fn screenshots_never_start_a_check() {
        assert!(counts(Path::new("/t/themes/riso/theme.css")));
        assert!(!counts(Path::new("/t/themes/riso/.shots/board.png")));
    }
}
