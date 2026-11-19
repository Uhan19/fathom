use std::collections::{BTreeSet, HashMap};
use std::path::Path;

use serde::Serialize;

use crate::db::shells::ShellTab;
use crate::db::{Column, Db};
use crate::herdr::{Herdr, Terminal};
use crate::launch;
use crate::workers::Worker;

const PROJECTS_DIR: &str = "projects";
const HOME_NAME: &str = "~";
const NAME_SEPARATOR: &str = " · ";

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFolder {
    pub column: i64,
    pub name: String,
    pub path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LauncherFolders {
    pub projects: Vec<ProjectFolder>,
    pub home: String,
}

pub fn firstmate_folders(home: &Path, columns: &[Column]) -> Vec<ProjectFolder> {
    let projects = home.join(PROJECTS_DIR);
    columns
        .iter()
        .filter_map(|column| {
            let project = column.project.as_deref().filter(|p| is_plain_name(p))?;
            let folder = std::fs::canonicalize(projects.join(project)).ok()?;
            folder.is_dir().then(|| ProjectFolder {
                column: column.id,
                name: column.name.clone(),
                path: Some(folder.display().to_string()),
            })
        })
        .collect()
}

pub fn backlog_folders(
    columns: &[Column],
    remembered: &HashMap<i64, String>,
) -> Vec<ProjectFolder> {
    columns
        .iter()
        .map(|column| ProjectFolder {
            column: column.id,
            name: column.name.clone(),
            path: remembered.get(&column.id).cloned(),
        })
        .collect()
}

fn is_plain_name(project: &str) -> bool {
    let mut parts = Path::new(project).components();
    matches!(
        (parts.next(), parts.next()),
        (Some(std::path::Component::Normal(_)), None)
    )
}

pub fn tab_name(program: &str, folder: &Path, home: Option<&Path>) -> String {
    let place = if home == Some(folder) {
        HOME_NAME.to_string()
    } else {
        base_name(folder).unwrap_or_else(|| folder.display().to_string())
    };
    format!("{program}{NAME_SEPARATOR}{place}")
}

pub fn shell_tab(
    terminal: &Terminal,
    shell: &Path,
    folder: &Path,
    home: Option<&Path>,
) -> ShellTab {
    ShellTab {
        terminal: terminal.address.clone(),
        name: tab_name(
            &base_name(shell).unwrap_or_else(|| shell.display().to_string()),
            folder,
            home,
        ),
        folder: folder.display().to_string(),
    }
}

pub fn attached_tab(terminal: &Terminal, home: Option<&Path>) -> ShellTab {
    let program = [&terminal.agent, &terminal.name, &terminal.address]
        .into_iter()
        .find(|name| !name.trim().is_empty())
        .cloned()
        .unwrap_or_default();
    ShellTab {
        terminal: terminal.address.clone(),
        name: tab_name(&program, Path::new(&terminal.cwd), home),
        folder: terminal.cwd.clone(),
    }
}

fn base_name(path: &Path) -> Option<String> {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(String::from)
}

pub fn restore(herdr: &Herdr, db: &Db) -> Result<Vec<ShellTab>, String> {
    let live: BTreeSet<String> = herdr.list()?.into_iter().map(|t| t.address).collect();
    db.keep_shell_tabs(&live)
}

pub fn attachable(
    herdr: &Herdr,
    chat_label: &str,
    workers: &[Worker],
) -> Result<Vec<Terminal>, String> {
    let mut hidden: BTreeSet<String> = workers.iter().map(|w| w.terminal.clone()).collect();
    for label in [chat_label, &launch::chat_label(), &launch::helper_label()] {
        if label.contains('=') {
            hidden.extend(herdr.labeled(label)?.into_iter().map(|t| t.address));
        }
    }
    Ok(herdr
        .list()?
        .into_iter()
        .filter(|terminal| !hidden.contains(&terminal.address))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::herdr::Connection;
    use crate::herdr::tests::FAKE_HC;
    use crate::workers::WorkerStatus;
    use std::os::unix::fs::PermissionsExt;
    use std::path::PathBuf;
    use std::sync::Arc;

    const FAKE_HC_SCRIPT: &str = r#"#!/bin/sh
for arg in "$@"; do printf '%s\n' "$arg"; done >> "$0.args"
printf '%s\n' '<end>' >> "$0.args"
row() { printf '{"address":"%s","agent":"%s","cwd":"/work","state":"live"}' "$1" "$2"; }
case "$*" in
  "ls --json --label fathom.role=chat") printf '{"terminals":[%s]}\n' "$(row t1 claude)" ;;
  "ls --json --label crew.role=lead") printf '{"terminals":[%s]}\n' "$(row t2 codex)" ;;
  "ls --json --label fathom.role=helper") printf '{"terminals":[%s]}\n' "$(row t3 claude)" ;;
  "ls --json --label "*) printf '{"terminals":[]}\n' ;;
  "ls --json") printf '{"terminals":[%s,%s,%s,%s,%s,%s]}\n' "$(row t1 claude)" "$(row t2 codex)" "$(row t3 claude)" "$(row t4 claude)" "$(row t5 zsh)" "$(row t6 sleep)" ;;
  *) exit 1 ;;
esac
"#;

    fn fake_herdr() -> (tempfile::TempDir, Herdr) {
        let bin = tempfile::tempdir().unwrap();
        let script = bin.path().join("hc");
        std::fs::write(&script, FAKE_HC_SCRIPT).unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        FAKE_HC.with(|fake| *fake.borrow_mut() = Some(script));
        (bin, Herdr::new(Connection::default(), Arc::new(|_| {})))
    }

    fn addresses(terminals: Vec<Terminal>) -> Vec<String> {
        terminals.into_iter().map(|t| t.address).collect()
    }

    #[test]
    fn the_attach_list_leaves_out_the_chat_bosun_and_workers() {
        let (_bin, herdr) = fake_herdr();
        let worker = Worker {
            task_id: "12".into(),
            terminal: "t4".into(),
            status: WorkerStatus::Working,
        };
        let listed = attachable(&herdr, "crew.role=lead", &[worker]).unwrap();
        assert_eq!(addresses(listed), ["t5", "t6"]);
        let listed = attachable(&herdr, "fathom.role=chat", &[]).unwrap();
        assert_eq!(addresses(listed), ["t2", "t4", "t5", "t6"]);
    }

    #[test]
    fn restoring_keeps_live_tabs_and_drops_a_gone_terminal() {
        let (_bin, herdr) = fake_herdr();
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path()).unwrap();
        let tab = |terminal: &str| ShellTab {
            terminal: terminal.into(),
            name: "zsh · work".into(),
            folder: "/work".into(),
        };
        for terminal in ["t5", "t40", "t6"] {
            db.add_shell_tab(&tab(terminal)).unwrap();
        }
        assert_eq!(restore(&herdr, &db).unwrap(), [tab("t5"), tab("t6")]);
        assert_eq!(db.shell_tabs().unwrap(), [tab("t5"), tab("t6")]);
    }

    fn column(id: i64, project: Option<&str>, name: &str) -> Column {
        Column {
            id,
            project: project.map(String::from),
            name: name.into(),
            position: id,
            width: 240,
            collapsed: false,
        }
    }

    #[test]
    fn firstmate_folders_follow_the_column_project_into_the_home_projects_folder() {
        let home = tempfile::tempdir().unwrap();
        let elsewhere = tempfile::tempdir().unwrap();
        let projects = home.path().join(PROJECTS_DIR);
        std::fs::create_dir_all(projects.join("harbor")).unwrap();
        let reef = elsewhere.path().join("reef-checkout");
        std::fs::create_dir_all(&reef).unwrap();
        std::os::unix::fs::symlink(&reef, projects.join("reef-map")).unwrap();
        std::fs::write(projects.join("notes"), "not a folder").unwrap();
        let columns = [
            column(1, Some("reef-map"), "Reef"),
            column(2, Some("lagoon"), "Lagoon"),
            column(3, None, "Ideas"),
            column(4, Some("harbor"), "reef-map"),
            column(5, Some("notes"), "Notes"),
            column(6, Some("../harbor"), "Escape"),
        ];
        let folders = firstmate_folders(home.path(), &columns);
        let real = |path: &Path| Some(std::fs::canonicalize(path).unwrap().display().to_string());
        assert_eq!(
            folders,
            [
                ProjectFolder {
                    column: 1,
                    name: "Reef".into(),
                    path: real(&reef),
                },
                ProjectFolder {
                    column: 4,
                    name: "reef-map".into(),
                    path: real(&projects.join("harbor")),
                },
            ]
        );
    }

    #[test]
    fn the_own_backlog_lists_every_column_with_its_remembered_folder() {
        let columns = [column(1, Some("reef"), "Reef"), column(2, None, "Harbor")];
        let remembered = HashMap::from([(2, "/work/harbor".to_string())]);
        assert_eq!(
            backlog_folders(&columns, &remembered),
            [
                ProjectFolder {
                    column: 1,
                    name: "Reef".into(),
                    path: None,
                },
                ProjectFolder {
                    column: 2,
                    name: "Harbor".into(),
                    path: Some("/work/harbor".into()),
                },
            ]
        );
    }

    #[test]
    fn a_shell_tab_is_named_by_the_shell_and_the_folder() {
        let terminal = Terminal {
            address: "t4".into(),
            ..Terminal::default()
        };
        let home = PathBuf::from("/home/demo");
        let tab = shell_tab(
            &terminal,
            Path::new("/bin/zsh"),
            Path::new("/work/reef"),
            Some(&home),
        );
        assert_eq!(
            tab,
            ShellTab {
                terminal: "t4".into(),
                name: "zsh · reef".into(),
                folder: "/work/reef".into(),
            }
        );
        let at_home = shell_tab(&terminal, Path::new("/usr/bin/fish"), &home, Some(&home));
        assert_eq!(at_home.name, "fish · ~");
    }

    #[test]
    fn an_attached_terminal_is_named_by_its_agent_or_command_and_folder() {
        let terminal = |agent: &str, name: &str| Terminal {
            address: "t8".into(),
            agent: agent.into(),
            name: name.into(),
            cwd: "/work/harbor".into(),
            ..Terminal::default()
        };
        let named = |t: Terminal| attached_tab(&t, None).name;
        assert_eq!(named(terminal("codex", "probe")), "codex · harbor");
        assert_eq!(named(terminal("", "probe")), "probe · harbor");
        assert_eq!(named(terminal("", "")), "t8 · harbor");
        assert_eq!(
            attached_tab(&terminal("sleep", ""), None).folder,
            "/work/harbor"
        );
    }

    const STUB_SHELL: &str = r#"#!/bin/sh
for arg in "$@"; do printf '%s\n' "$arg"; done > "$0.args"
pwd -P > "$0.cwd"
echo "stub shell ready"
while IFS= read -r line; do
  [ "$line" = exit ] && exit 0
  echo "GOT:$line"
done
"#;

    fn lab_herdr() -> Herdr {
        let connection = Connection {
            session: std::env::var("FATHOM_LAB_SESSION").expect("FATHOM_LAB_SESSION"),
            socket: std::env::var("FATHOM_LAB_SOCKET").expect("FATHOM_LAB_SOCKET"),
        };
        Herdr::new(connection, Arc::new(|_| {}))
    }

    fn stub_shell(dir: &Path) -> PathBuf {
        let path = dir.join("stub-zsh");
        std::fs::write(&path, STUB_SHELL).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        path
    }

    fn type_line(herdr: &Herdr, terminal: &str, line: &str, expect: Option<&str>) {
        use crate::herdr::View;
        use crate::herdr::tests::{screen_sink, wait_for};
        let view = View::Shell(terminal.into());
        let (screen, sink) = screen_sink();
        herdr.attach(view.clone(), terminal, 100, 30, sink).unwrap();
        let seen =
            |text: &str| String::from_utf8_lossy(&screen.lock().unwrap().bytes).contains(text);
        wait_for("the stub shell's greeting", || seen("stub shell ready"));
        herdr
            .write_input(&view, format!("{line}\r").as_bytes())
            .unwrap();
        if let Some(text) = expect {
            wait_for("the echoed line", || seen(text));
        }
        herdr.detach(&view);
    }

    #[test]
    #[ignore = "needs FATHOM_LAB_SESSION and FATHOM_LAB_SOCKET pointing at a throwaway herdr-core session"]
    fn a_shell_tab_opens_echoes_and_restores_in_a_lab() {
        use crate::herdr::tests::wait_for;

        let herdr = lab_herdr();
        let bin = tempfile::tempdir().unwrap();
        let folder = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let db = Db::open(data.path()).unwrap();
        let shell = crate::shell_path::choose_shell(
            Some(stub_shell(bin.path()).display().to_string()),
            None,
        );

        let kept = launch::open_shell(&herdr, folder.path(), &shell).unwrap();
        let folder_text = folder.path().display().to_string();
        let shell_label = format!("{}={}", launch::ROLE_KEY, launch::SHELL_ROLE);
        let folder_label = format!("{}={folder_text}", launch::FOLDER_KEY);
        for label in [&shell_label, &folder_label] {
            let listed = herdr.run(&["ls", "--json", "--label", label]).unwrap();
            assert!(
                listed.contains(&format!(r#""address":"{}""#, kept.address)),
                "{label}: {listed}"
            );
        }
        let got: serde_json::Value =
            serde_json::from_str(&herdr.run(&["get", &kept.address, "--json"]).unwrap()).unwrap();
        assert_eq!(got["labels"][launch::ROLE_KEY], launch::SHELL_ROLE, "{got}");
        assert_eq!(
            got["labels"][launch::FOLDER_KEY],
            folder_text.as_str(),
            "{got}"
        );
        assert_eq!(
            got["argv"],
            serde_json::json!([shell.display().to_string(), "-l"]),
            "{got}"
        );
        assert_eq!(
            Path::new(&kept.cwd).canonicalize().unwrap(),
            folder.path().canonicalize().unwrap()
        );
        let args_file = bin.path().join("stub-zsh.args");
        wait_for("the stub shell to record its args", || args_file.exists());
        assert_eq!(std::fs::read_to_string(&args_file).unwrap(), "-l\n");
        assert_eq!(
            std::fs::read_to_string(bin.path().join("stub-zsh.cwd"))
                .unwrap()
                .trim(),
            folder.path().canonicalize().unwrap().display().to_string()
        );

        type_line(
            &herdr,
            &kept.address,
            "typed-in-a-tab",
            Some("GOT:typed-in-a-tab"),
        );
        let read = herdr.run(&["read", &kept.address]).unwrap();
        assert!(read.contains("GOT:typed-in-a-tab"), "{read}");

        let ended = launch::open_shell(&herdr, folder.path(), &shell).unwrap();
        let kept_tab = shell_tab(&kept, &shell, folder.path(), None);
        db.add_shell_tab(&kept_tab).unwrap();
        db.add_shell_tab(&shell_tab(&ended, &shell, folder.path(), None))
            .unwrap();
        type_line(&herdr, &ended.address, "exit", None);
        wait_for("the exited shell to leave hc ls", || {
            herdr
                .list()
                .unwrap()
                .iter()
                .all(|t| t.address != ended.address)
        });

        assert_eq!(
            restore(&herdr, &db).unwrap(),
            std::slice::from_ref(&kept_tab)
        );
        assert_eq!(db.shell_tabs().unwrap(), [kept_tab]);

        herdr.run(&["kill", &kept.address]).unwrap();
    }
}
