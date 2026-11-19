use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::{Implementation, ServerCapabilities, ServerConfig};
use rmcp::{ServerHandler, ServiceExt, tool, tool_handler, tool_router};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::db::Db;
use crate::db::backlog::{NewTask, TaskChange};
use crate::herdr::Herdr;
use crate::launch::{self, Agent, FathomServer, Launch};
use crate::shell_path;
use crate::state::{connection_of, load_settings, now_ms};
use crate::tasks::Row;
use crate::workers::LIVE;

pub const MCP_FLAG: &str = "--mcp";
pub const DB_FLAG: &str = "--db";
const DB_ENV: &str = "FATHOM_DB";
const SERVER_NAME: &str = "fathom";
const INSTRUCTIONS: &str = "\
Fathom is the user's task board. Keep your task list in Fathom instead of a file or a private list.
Add a task for each piece of work with add_task, keep its title and detail current with update_task, and move it with move_task whenever its state changes.
Use a short, stable project name per repository or area so the board can group tasks.
Rows: surface means the task needs the user, shallows means in progress, seabed means queued (the default), deep means parked or waiting on something, and landed means done.
The user plans by dragging cards on the board. A drag never moves a task by itself: it becomes a board request that you answer.
When you see a line such as \"1 board request waiting\", call list_requests and answer every request.
Accept a request with answer_request or by moving the task to the requested row with move_task.
Decline with answer_request and a short reason; the board shows that reason to the user.
To hand a task to a worker, call start_worker with its id instead of using your own subagents.
Each worker is its own Claude Code session in its own terminal: the user sees it as a sailor on the card and can open its terminal.
Keep your own subagents for quick lookups that finish inside your current turn.
If you were started as the worker for a task, keep that task current: move it to shallows when you begin, add progress and findings to its detail with update_task, move it to surface with the question in its detail when you need the user, and move it to landed when the work is done.";

pub fn worker_prompt(task: i64) -> String {
    format!(
        "You are the Fathom worker for task {task}. \
Read the task with the fathom list_tasks tool, move it to shallows with move_task, then do the work it describes in this folder. \
Report through the fathom tools as you go: add progress and findings to the task's detail with update_task, keeping the original request at the top. \
If you need the user, put the question in the detail and move the task to surface. \
When the work is done, write a short summary in the detail and move the task to landed."
    )
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ListTasks {
    #[schemars(description = "Only tasks in this project")]
    pub project: Option<String>,
    #[schemars(description = "Only tasks in this row")]
    pub row: Option<Row>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct AddTask {
    pub title: String,
    pub project: String,
    #[schemars(description = "Longer notes shown when the user opens the card")]
    pub detail: Option<String>,
    #[schemars(description = "Starting row, seabed (queued) when left out")]
    pub row: Option<Row>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct UpdateTask {
    pub id: i64,
    pub title: Option<String>,
    pub detail: Option<String>,
    pub project: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct MoveTask {
    pub id: i64,
    pub row: Row,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct AnswerRequest {
    pub request_id: String,
    #[schemars(description = "true moves the task to the requested row, false declines")]
    pub accept: bool,
    #[schemars(description = "Short reason the board shows when declining")]
    pub reason: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct StartWorker {
    pub id: i64,
    #[schemars(
        description = "Folder the worker starts in, the working folder from Fathom's settings when left out"
    )]
    pub folder: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartedWorker {
    pub task_id: i64,
    pub terminal: String,
    pub folder: String,
}

pub type FindProgram = Box<dyn Fn(&str) -> Option<PathBuf> + Send + Sync>;

pub struct Host {
    pub program: PathBuf,
    pub shell: Option<PathBuf>,
    pub find: FindProgram,
}

impl Host {
    pub fn current() -> Result<Host, String> {
        Ok(Host {
            program: std::env::current_exe()
                .map_err(|e| format!("cannot find Fathom's own program: {e}"))?,
            shell: shell_path::login_shell().map(PathBuf::from),
            find: Box::new(|program| shell_path::find_first(&[program])),
        })
    }
}

pub struct Fathom {
    db: Mutex<Db>,
    host: Host,
}

impl Fathom {
    pub fn new(db: Db, host: Host) -> Fathom {
        Fathom {
            db: Mutex::new(db),
            host,
        }
    }
}

#[tool_router]
impl Fathom {
    #[tool(description = "List backlog tasks, optionally only one project or one row.")]
    fn list_tasks(&self, Parameters(p): Parameters<ListTasks>) -> Result<String, String> {
        reply(self.db.lock().unwrap().tasks(p.project.as_deref(), p.row))
    }

    #[tool(description = "Add a task to the backlog.")]
    fn add_task(&self, Parameters(p): Parameters<AddTask>) -> Result<String, String> {
        let task = NewTask {
            title: p.title,
            detail: p.detail.unwrap_or_default(),
            project: p.project,
            row: p.row,
        };
        reply(self.db.lock().unwrap().add_task(&task, now_ms()))
    }

    #[tool(
        description = "Change a task's title, detail or project. Leave out what stays the same."
    )]
    fn update_task(&self, Parameters(p): Parameters<UpdateTask>) -> Result<String, String> {
        let change = TaskChange {
            title: p.title,
            detail: p.detail,
            project: p.project,
        };
        reply(self.db.lock().unwrap().update_task(p.id, &change, now_ms()))
    }

    #[tool(
        description = "Move a task to a row. This also answers any board request asking for that row."
    )]
    fn move_task(&self, Parameters(p): Parameters<MoveTask>) -> Result<String, String> {
        reply(self.db.lock().unwrap().move_task(p.id, p.row, now_ms()))
    }

    #[tool(description = "List board requests the user made by dragging cards, oldest first.")]
    fn list_requests(&self) -> Result<String, String> {
        reply(self.db.lock().unwrap().task_requests())
    }

    #[tool(
        description = "Answer a board request: accept moves the task to the requested row, decline needs a short reason."
    )]
    fn answer_request(&self, Parameters(p): Parameters<AnswerRequest>) -> Result<String, String> {
        let mut db = self.db.lock().unwrap();
        if p.accept {
            return reply(db.accept_request(&p.request_id, now_ms()));
        }
        reply(db.decline_request(&p.request_id, p.reason.as_deref().unwrap_or_default()))
    }

    #[tool(
        description = "Start a Claude Code worker on a task in its own terminal. The worker reads the task, does the work and reports by updating the task. Use this instead of your own subagents for work the user should see on the board."
    )]
    fn start_worker(&self, Parameters(p): Parameters<StartWorker>) -> Result<String, String> {
        reply(self.start(p.id, p.folder))
    }
}

impl Fathom {
    fn start(&self, id: i64, folder: Option<String>) -> Result<StartedWorker, String> {
        let (task, settings, store) = {
            let db = self.db.lock().unwrap();
            (db.task(id)?, load_settings(&db)?, db.path().to_path_buf())
        };
        if task.row == Row::Landed {
            return Err(format!("task {id} is already done"));
        }
        let herdr = Herdr::new(connection_of(&settings), Arc::new(|_| {}));
        if let Some(live) = herdr
            .labeled(&launch::task_label(id))?
            .into_iter()
            .find(|t| t.state == LIVE)
        {
            return Err(format!(
                "task {id} already has a live worker in terminal {}",
                live.address
            ));
        }
        let folder = folder
            .map(|f| f.trim().to_string())
            .filter(|f| !f.is_empty())
            .unwrap_or(settings.agent_folder);
        let server = FathomServer {
            program: self.host.program.clone(),
            db: store,
        };
        let prompt = worker_prompt(id);
        let terminal = launch::open(
            &herdr,
            &Launch {
                agent: Agent::Claude,
                role: launch::WORKER_ROLE,
                task: Some(id),
                prompt: Some(&prompt),
                cwd: Path::new(&folder),
                server: &server,
                shell: self.host.shell.as_deref(),
            },
            &self.host.find,
        )
        .map_err(|e| e.to_string())?;
        Ok(StartedWorker {
            task_id: id,
            terminal: terminal.address,
            folder,
        })
    }
}

#[tool_handler]
impl ServerHandler for Fathom {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new(SERVER_NAME, env!("CARGO_PKG_VERSION")))
            .with_instructions(INSTRUCTIONS)
    }
}

fn reply<T: Serialize>(result: Result<T, String>) -> Result<String, String> {
    serde_json::to_string(&result?).map_err(|e| e.to_string())
}

pub fn store_path(
    args: &[String],
    env: Option<String>,
    default: PathBuf,
) -> Result<PathBuf, String> {
    if let Some(index) = args.iter().position(|a| a == DB_FLAG) {
        return match args.get(index + 1) {
            Some(path) if !path.starts_with('-') => Ok(PathBuf::from(path)),
            _ => Err(format!("usage: fathom {MCP_FLAG} [{DB_FLAG} <store file>]")),
        };
    }
    Ok(env
        .filter(|path| !path.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or(default))
}

pub fn serve_stdio(store: &Path) -> Result<(), String> {
    let db = Db::open_file(store)?;
    let host = Host::current()?;
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| format!("cannot start the MCP runtime: {e}"))?;
    runtime.block_on(async {
        let service = Fathom::new(db, host)
            .serve(rmcp::transport::stdio())
            .await
            .map_err(|e| e.to_string())?;
        service.waiting().await.map_err(|e| e.to_string())?;
        Ok(())
    })
}

pub fn db_env() -> Option<String> {
    std::env::var(DB_ENV).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::MoveStatus;
    use crate::db::backlog::Task;
    use crate::moves::Placement;
    use crate::source::Source;
    use serde_json::{Value, json};
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

    fn no_host() -> Host {
        Host {
            program: PathBuf::from("/opt/fathom/fathom"),
            shell: None,
            find: Box::new(|_| None),
        }
    }

    fn server() -> (tempfile::TempDir, PathBuf, Fathom) {
        let dir = tempfile::tempdir().unwrap();
        let store = dir.path().join("board.sqlite");
        let server = Fathom::new(Db::open_file(&store).unwrap(), no_host());
        (dir, store, server)
    }

    fn ok<T: serde::de::DeserializeOwned>(result: Result<String, String>) -> T {
        serde_json::from_str(&result.unwrap()).unwrap()
    }

    fn add(server: &Fathom, title: &str, project: &str, row: Option<Row>) -> Value {
        ok(server.add_task(Parameters(AddTask {
            title: title.into(),
            project: project.into(),
            detail: None,
            row,
        })))
    }

    fn drag(store: &Path, id: i64, to_row: Row, now_ms: i64) {
        let db = Mutex::new(Db::open_file(store).unwrap());
        let task: Task = db.lock().unwrap().task(id).unwrap();
        let placement = Placement {
            card_id: task.card_id(),
            title: task.title.clone(),
            column: 1,
            from_row: task.row,
            to_row,
            order: vec![task.card_id()],
        };
        Source::Backlog
            .place(&db, placement, now_ms, None, |_, _| Ok(()))
            .unwrap();
    }

    fn list(server: &Fathom, project: Option<&str>, row: Option<Row>) -> Vec<Value> {
        ok(server.list_tasks(Parameters(ListTasks {
            project: project.map(String::from),
            row,
        })))
    }

    #[test]
    fn the_db_flag_beats_the_env_var_and_the_env_var_beats_the_default() {
        let args = |list: &[&str]| list.iter().map(|a| a.to_string()).collect::<Vec<_>>();
        let default = PathBuf::from("/data/fathom.sqlite");
        assert_eq!(
            store_path(&args(&["fathom", "--mcp"]), None, default.clone()),
            Ok(default.clone())
        );
        assert_eq!(
            store_path(
                &args(&["fathom", "--mcp"]),
                Some("/tmp/a.sqlite".into()),
                default.clone()
            ),
            Ok(PathBuf::from("/tmp/a.sqlite"))
        );
        assert_eq!(
            store_path(
                &args(&["fathom", "--mcp", "--db", "/tmp/b.sqlite"]),
                Some("/tmp/a.sqlite".into()),
                default.clone()
            ),
            Ok(PathBuf::from("/tmp/b.sqlite"))
        );
        assert_eq!(
            store_path(
                &args(&["fathom", "--mcp"]),
                Some(" ".into()),
                default.clone()
            ),
            Ok(default.clone())
        );
        assert!(store_path(&args(&["fathom", "--mcp", "--db"]), None, default).is_err());
    }

    #[test]
    fn adds_and_lists_tasks_by_project_and_row() {
        let (_dir, _store, server) = server();
        let added = add(&server, "Chart the reef", "reef-map", None);
        assert_eq!(added["title"], "Chart the reef");
        assert_eq!(added["row"], "seabed");
        assert_eq!(added["detail"], "");
        add(&server, "Count the buoys", "reef-map", Some(Row::Shallows));
        add(&server, "Paint the hull", "dry-dock", None);

        assert_eq!(list(&server, None, None).len(), 3);
        let reef = list(&server, Some("reef-map"), None);
        assert_eq!(reef.len(), 2);
        let busy = list(&server, Some("reef-map"), Some(Row::Shallows));
        assert_eq!(busy.len(), 1);
        assert_eq!(busy[0]["title"], "Count the buoys");
        assert!(list(&server, Some("lighthouse"), None).is_empty());
    }

    #[test]
    fn adding_a_task_needs_a_title_and_a_project() {
        let (_dir, _store, server) = server();
        let blank = server.add_task(Parameters(AddTask {
            title: " ".into(),
            project: "reef-map".into(),
            detail: None,
            row: None,
        }));
        assert_eq!(blank, Err("a task needs a title".into()));
        let homeless = server.add_task(Parameters(AddTask {
            title: "Chart the reef".into(),
            project: "".into(),
            detail: None,
            row: None,
        }));
        assert_eq!(homeless, Err("a task needs a project".into()));
    }

    #[test]
    fn updates_only_the_given_fields() {
        let (_dir, _store, server) = server();
        let id = add(&server, "Chart the reef", "reef-map", None)["id"]
            .as_i64()
            .unwrap();
        let updated: Value = ok(server.update_task(Parameters(UpdateTask {
            id,
            title: None,
            detail: Some("Start at the north buoy".into()),
            project: None,
        })));
        assert_eq!(updated["title"], "Chart the reef");
        assert_eq!(updated["detail"], "Start at the north buoy");
        assert_eq!(updated["project"], "reef-map");
        let missing = server.update_task(Parameters(UpdateTask {
            id: 99,
            title: Some("Ghost".into()),
            detail: None,
            project: None,
        }));
        assert_eq!(missing, Err("no task 99".into()));
    }

    #[test]
    fn moves_a_task_between_rows() {
        let (_dir, _store, server) = server();
        let id = add(&server, "Chart the reef", "reef-map", None)["id"]
            .as_i64()
            .unwrap();
        let moved: Value = ok(server.move_task(Parameters(MoveTask {
            id,
            row: Row::Landed,
        })));
        assert_eq!(moved["row"], "landed");
        assert_eq!(list(&server, None, Some(Row::Landed)).len(), 1);
    }

    #[test]
    fn a_board_request_is_listed_until_a_move_to_its_row_answers_it() {
        let (_dir, store, server) = server();
        let id = add(&server, "Chart the reef", "reef-map", None)["id"]
            .as_i64()
            .unwrap();
        drag(&store, id, Row::Surface, 10);

        let waiting: Vec<Value> = ok(server.list_requests());
        assert_eq!(waiting.len(), 1);
        assert_eq!(waiting[0]["cardId"], id.to_string());
        assert_eq!(waiting[0]["toRow"], "surface");
        assert_eq!(list(&server, None, None)[0]["row"], "seabed");

        let _: Value = ok(server.move_task(Parameters(MoveTask {
            id,
            row: Row::Surface,
        })));
        assert!(ok::<Vec<Value>>(server.list_requests()).is_empty());
        let db = Db::open_file(&store).unwrap();
        assert_eq!(db.all_requests().unwrap()[0].status, MoveStatus::Landed);
    }

    #[test]
    fn accepting_a_request_moves_the_task() {
        let (_dir, store, server) = server();
        let id = add(&server, "Chart the reef", "reef-map", None)["id"]
            .as_i64()
            .unwrap();
        drag(&store, id, Row::Shallows, 10);
        let request_id = format!("fathom-move-{id}-10");
        let accepted: Value = ok(server.answer_request(Parameters(AnswerRequest {
            request_id: request_id.clone(),
            accept: true,
            reason: None,
        })));
        assert_eq!(accepted["row"], "shallows");
        assert!(ok::<Vec<Value>>(server.list_requests()).is_empty());
        let again = server.answer_request(Parameters(AnswerRequest {
            request_id: request_id.clone(),
            accept: true,
            reason: None,
        }));
        assert_eq!(again, Err(format!("no pending board request {request_id}")));
    }

    #[test]
    fn declining_a_request_needs_a_reason_and_keeps_the_task_in_place() {
        let (_dir, store, server) = server();
        let id = add(&server, "Chart the reef", "reef-map", None)["id"]
            .as_i64()
            .unwrap();
        drag(&store, id, Row::Landed, 10);
        let request_id = format!("fathom-move-{id}-10");
        let unexplained = server.answer_request(Parameters(AnswerRequest {
            request_id: request_id.clone(),
            accept: false,
            reason: Some("  ".into()),
        }));
        assert_eq!(
            unexplained,
            Err("declining a request needs a short reason".into())
        );

        let declined: Value = ok(server.answer_request(Parameters(AnswerRequest {
            request_id,
            accept: false,
            reason: Some("Still waiting on the soundings".into()),
        })));
        assert_eq!(declined["status"], "answered");
        assert_eq!(declined["answer"], "Still waiting on the soundings");
        assert_eq!(list(&server, None, None)[0]["row"], "seabed");
        assert!(ok::<Vec<Value>>(server.list_requests()).is_empty());
    }

    const FAKE_HC: &str = r#"#!/bin/sh
for arg in "$@"; do printf '%s\n' "$arg"; done >> "$0.args"
printf '%s\n' '<end>' >> "$0.args"
printf '%s %s\n' "$HC_SESSION" "$HC_SOCKET" >> "$0.env"
case "$1" in
  ls) if [ -f "$0.listed" ]; then cat "$0.listed"; else printf '{"terminals":[]}\n'; fi ;;
  run) printf '{"address":"t9","state":"live"}\n' ;;
  get) printf '{"address":"%s","state":"live","labels":{"fathom.task":"1"}}\n' "$2" ;;
  *) exit 1 ;;
esac
"#;

    struct WorkerLab {
        _dir: tempfile::TempDir,
        bin: PathBuf,
        folder: PathBuf,
        store: PathBuf,
        server: Fathom,
    }

    impl WorkerLab {
        fn new() -> WorkerLab {
            use std::os::unix::fs::PermissionsExt;
            let dir = tempfile::tempdir().unwrap();
            let bin = dir.path().join("bin");
            let folder = dir.path().join("reef map");
            let data = dir.path().join("Application Support");
            for path in [&bin, &folder, &data] {
                std::fs::create_dir_all(path).unwrap();
            }
            for (tool, body) in [
                ("hc", FAKE_HC),
                ("claude", "#!/bin/sh\n"),
                ("zsh", "#!/bin/sh\n"),
            ] {
                let script = bin.join(tool);
                std::fs::write(&script, body).unwrap();
                std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
            }
            crate::herdr::tests::FAKE_HC.with(|fake| *fake.borrow_mut() = Some(bin.join("hc")));
            let store = data.join("fathom.sqlite");
            let db = Db::open_file(&store).unwrap();
            db.set_setting("hcSession", "reef-lab").unwrap();
            db.set_setting("hcSocket", "/run/reef-lab.sock").unwrap();
            db.set_setting("agentFolder", &folder.display().to_string())
                .unwrap();
            let found = bin.clone();
            let host = Host {
                program: PathBuf::from("/opt/fathom/fathom"),
                shell: Some(bin.join("zsh")),
                find: Box::new(move |program| Some(found.join(program)).filter(|p| p.is_file())),
            };
            WorkerLab {
                _dir: dir,
                bin,
                folder,
                store,
                server: Fathom::new(db, host),
            }
        }

        fn task(&self, title: &str, row: Option<Row>) -> i64 {
            add(&self.server, title, "reef-map", row)["id"]
                .as_i64()
                .unwrap()
        }

        fn start(&self, id: i64, folder: Option<&Path>) -> Result<String, String> {
            self.server.start_worker(Parameters(StartWorker {
                id,
                folder: folder.map(|f| f.display().to_string()),
            }))
        }

        fn calls(&self) -> Vec<Vec<String>> {
            let Ok(text) = std::fs::read_to_string(self.bin.join("hc.args")) else {
                return vec![];
            };
            text.split_terminator("<end>\n")
                .map(|call| call.lines().map(String::from).collect())
                .collect()
        }

        fn list(&self, terminals: Value) {
            std::fs::write(
                self.bin.join("hc.listed"),
                json!({"terminals": terminals}).to_string(),
            )
            .unwrap();
        }
    }

    fn strings(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn start_worker_runs_claude_code_in_a_terminal_labeled_with_the_task() {
        let lab = WorkerLab::new();
        let id = lab.task("Chart the reef", None);
        let started: Value = ok(lab.start(id, None));
        let folder = lab.folder.display().to_string();
        assert_eq!(
            started,
            json!({"taskId": id, "terminal": "t9", "folder": folder})
        );

        let config = lab.store.with_file_name("fathom-mcp.json");
        let prompt = worker_prompt(id);
        let mut run = strings(&[
            "run",
            "--bg",
            "--json",
            "--no-parent",
            "--cwd",
            &folder,
            "--label",
            "fathom.role=worker",
            "--label",
            "fathom.agent=claude",
            "--label",
            &format!("fathom.task={id}"),
            "--",
        ]);
        run.extend(strings(&[
            &lab.bin.join("zsh").display().to_string(),
            "-l",
            "-i",
            "-c",
            launch::POSIX_EXEC,
            &lab.bin.join("claude").display().to_string(),
            &prompt,
            "--mcp-config",
            &config.display().to_string(),
        ]));
        assert_eq!(
            lab.calls(),
            [
                strings(&["ls", "--json", "--label", &format!("fathom.task={id}")]),
                run,
                strings(&["get", "t9", "--json"]),
            ]
        );
        let env = std::fs::read_to_string(lab.bin.join("hc.env")).unwrap();
        assert!(
            env.lines()
                .all(|line| line == "reef-lab /run/reef-lab.sock"),
            "{env}"
        );

        let written: Value =
            serde_json::from_str(&std::fs::read_to_string(config).unwrap()).unwrap();
        assert_eq!(
            written,
            json!({"mcpServers": {"fathom": {
                "command": "/opt/fathom/fathom",
                "args": ["--mcp", "--db", lab.store.display().to_string()],
            }}})
        );
        assert!(prompt.contains(&format!("worker for task {id}")));
        assert!(prompt.contains("move it to shallows"));
        assert!(prompt.contains("move the task to landed"));
    }

    #[test]
    fn start_worker_uses_a_given_folder_over_the_settings() {
        let lab = WorkerLab::new();
        let id = lab.task("Chart the reef", Some(Row::Deep));
        let elsewhere = tempfile::tempdir().unwrap();
        let started: Value = ok(lab.start(id, Some(elsewhere.path())));
        assert_eq!(started["folder"], elsewhere.path().display().to_string());
        let run = &lab.calls()[1];
        assert_eq!(run[5], elsewhere.path().display().to_string());
    }

    #[test]
    fn start_worker_refuses_a_missing_or_finished_task_before_touching_herdr_core() {
        let lab = WorkerLab::new();
        assert_eq!(lab.start(42, None), Err("no task 42".into()));
        let done = lab.task("Book the crane", Some(Row::Landed));
        assert_eq!(
            lab.start(done, None),
            Err(format!("task {done} is already done"))
        );
        assert!(lab.calls().is_empty());
    }

    #[test]
    fn start_worker_refuses_a_task_that_already_has_a_live_worker() {
        let lab = WorkerLab::new();
        let id = lab.task("Chart the reef", Some(Row::Shallows));
        lab.list(json!([
            {"address": "t2", "state": "finished", "labels": {"fathom.task": id.to_string()}},
            {"address": "t3", "state": "live", "labels": {"fathom.task": id.to_string()}},
        ]));
        assert_eq!(
            lab.start(id, None),
            Err(format!(
                "task {id} already has a live worker in terminal t3"
            ))
        );
        assert_eq!(lab.calls().len(), 1);

        lab.list(json!([
            {"address": "t2", "state": "finished", "labels": {"fathom.task": id.to_string()}},
        ]));
        let started: Value = ok(lab.start(id, None));
        assert_eq!(started["terminal"], "t9");
    }

    #[test]
    fn start_worker_names_a_missing_folder_or_claude_code() {
        let lab = WorkerLab::new();
        let id = lab.task("Chart the reef", None);
        let gone = lab.folder.join("gone");
        let missing = lab.start(id, Some(&gone)).unwrap_err();
        assert!(missing.contains("does not exist"), "{missing}");

        std::fs::remove_file(lab.bin.join("claude")).unwrap();
        assert_eq!(
            lab.start(id, None),
            Err("claude is not installed or not on PATH".into())
        );
        assert!(lab.calls().iter().all(|call| call[0] == "ls"));
    }

    async fn call(
        lines: &mut tokio::io::Lines<BufReader<tokio::io::ReadHalf<tokio::io::DuplexStream>>>,
        writer: &mut tokio::io::WriteHalf<tokio::io::DuplexStream>,
        message: Value,
    ) -> Value {
        writer
            .write_all(format!("{message}\n").as_bytes())
            .await
            .unwrap();
        if message.get("id").is_none() {
            return Value::Null;
        }
        let line = lines.next_line().await.unwrap().unwrap();
        serde_json::from_str(&line).unwrap()
    }

    #[tokio::test]
    async fn speaks_mcp_as_the_fathom_server() {
        let (_dir, _store, server) = server();
        let (client, transport) = tokio::io::duplex(64 * 1024);
        let running = tokio::spawn(async move {
            server
                .serve(tokio::io::split(transport))
                .await
                .unwrap()
                .waiting()
                .await
                .unwrap();
        });
        let (read, mut write) = tokio::io::split(client);
        let mut lines = BufReader::new(read).lines();

        let init = call(
            &mut lines,
            &mut write,
            json!({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": {"name": "test-client", "version": "0"}
            }}),
        )
        .await;
        assert_eq!(init["result"]["serverInfo"]["name"], "fathom");
        let instructions = init["result"]["instructions"].as_str().unwrap();
        assert!(instructions.contains("Keep your task list in Fathom"));
        assert!(
            instructions
                .contains("call start_worker with its id instead of using your own subagents")
        );
        assert!(instructions.contains("If you were started as the worker for a task"));
        call(
            &mut lines,
            &mut write,
            json!({"jsonrpc": "2.0", "method": "notifications/initialized"}),
        )
        .await;

        let tools = call(
            &mut lines,
            &mut write,
            json!({"jsonrpc": "2.0", "id": 2, "method": "tools/list"}),
        )
        .await;
        let mut names: Vec<&str> = tools["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["name"].as_str().unwrap())
            .collect();
        names.sort();
        assert_eq!(
            names,
            [
                "add_task",
                "answer_request",
                "list_requests",
                "list_tasks",
                "move_task",
                "start_worker",
                "update_task"
            ]
        );

        let added = call(
            &mut lines,
            &mut write,
            json!({"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {
                "name": "add_task",
                "arguments": {"title": "Chart the reef", "project": "reef-map"}
            }}),
        )
        .await;
        let text = added["result"]["content"][0]["text"].as_str().unwrap();
        assert_eq!(serde_json::from_str::<Value>(text).unwrap()["id"], 1);

        let failed = call(
            &mut lines,
            &mut write,
            json!({"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {
                "name": "move_task",
                "arguments": {"id": 7, "row": "landed"}
            }}),
        )
        .await;
        assert_eq!(failed["result"]["isError"], true);
        assert_eq!(failed["result"]["content"][0]["text"], "no task 7");

        drop(write);
        drop(lines);
        running.await.unwrap();
    }
}
