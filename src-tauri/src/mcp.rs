use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::{Implementation, ServerCapabilities, ServerConfig};
use rmcp::{ServerHandler, ServiceExt, tool, tool_handler, tool_router};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::db::Db;
use crate::db::backlog::{NewTask, TaskChange};
use crate::state::now_ms;
use crate::tasks::Row;

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
Decline with answer_request and a short reason; the board shows that reason to the user.";

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

pub struct Fathom {
    db: Mutex<Db>,
}

impl Fathom {
    pub fn new(db: Db) -> Fathom {
        Fathom { db: Mutex::new(db) }
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
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| format!("cannot start the MCP runtime: {e}"))?;
    runtime.block_on(async {
        let service = Fathom::new(db)
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

    fn server() -> (tempfile::TempDir, PathBuf, Fathom) {
        let dir = tempfile::tempdir().unwrap();
        let store = dir.path().join("board.sqlite");
        let server = Fathom::new(Db::open_file(&store).unwrap());
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
