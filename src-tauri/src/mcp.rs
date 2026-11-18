use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use rmcp::handler::server::router::tool::ToolRouter;
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::{Implementation, ServerCapabilities, ServerConfig};
use rmcp::{ServerHandler, ServiceExt, tool, tool_handler, tool_router};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::control;
use crate::db::backlog::{NewTask, TaskChange};
use crate::db::{Db, MoveTo};
use crate::fonts;
use crate::herdr::Herdr;
use crate::launch::{self, Agent, FathomServer, Launch};
use crate::settings::{self, CHAT_WIDTH, DETAIL_WIDTH, Surface, Theme, WindowChange};
use crate::shell_path;
use crate::source::Source;
use crate::state::{connection_of, now_ms};
use crate::tasks::Row;
use crate::workers::LIVE;

pub const MCP_FLAG: &str = "--mcp";
pub const DB_FLAG: &str = "--db";
pub const HELPER_FLAG: &str = "--helper";
pub const HELPER_ASKING_FLAG: &str = "--helper-asking";
const YES: &str = "yes";
const NO: &str = "no";
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

const HELPER_INSTRUCTIONS: &str = "\
Fathom is the user's task board app. These tools change how Fathom shows the board and its settings; they never change tasks.
Columns are projects (or custom columns the user added); rows are surface, shallows, seabed, deep and landed.
Read get_board_layout before changing columns, rows or the project filter, and get_settings before changing settings.
Refer to columns by the id from get_board_layout.
show_projects hides every column except the named projects; show_all_projects shows every column again.
Fathom shows each change within a moment, so there is nothing to refresh.";

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

#[derive(Debug, Deserialize, JsonSchema)]
pub struct RenameColumn {
    pub id: i64,
    pub name: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct MoveColumn {
    pub id: i64,
    #[schemars(description = "New position, 0 is the leftmost column")]
    pub index: usize,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct SetColumnView {
    pub id: i64,
    #[schemars(description = "Width in pixels, 180 to 640")]
    pub width: Option<i64>,
    #[schemars(description = "true folds the column to a narrow strip")]
    pub collapsed: Option<bool>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct AddColumn {
    pub name: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct DeleteColumn {
    pub id: i64,
    #[schemars(
        description = "Id of the column that takes this column's cards. A column with cards needs this or move_to_new_column"
    )]
    pub move_to_column: Option<i64>,
    #[schemars(description = "Name of a new column that takes this column's cards")]
    pub move_to_new_column: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct RenameRow {
    pub row: Row,
    pub name: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ShowProjects {
    #[schemars(description = "Project names to keep on the board; every other column is hidden")]
    pub projects: Vec<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct SetTheme {
    pub theme: Theme,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct SetFonts {
    #[schemars(
        description = "Terminal font: a preset key or name from list_fonts, or an installed font family"
    )]
    pub chat_font: Option<String>,
    pub chat_font_size: Option<u16>,
    #[schemars(
        description = "Board font: a preset key or name from list_fonts, or an installed font family"
    )]
    pub board_font: Option<String>,
    pub board_font_size: Option<u16>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct SetPanels {
    #[schemars(description = "true shows the chat panel beside the board")]
    pub chat_open: Option<bool>,
    #[schemars(description = "Chat panel width in pixels, 300 to 1400")]
    pub chat_width: Option<u32>,
    #[schemars(description = "Card detail panel width in pixels, 340 to 900")]
    pub detail_width: Option<u32>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct SetConnection {
    #[schemars(description = "Firstmate home folder; empty uses Fathom's own backlog")]
    pub home: Option<String>,
    #[schemars(description = "Label of the chat terminal, as key=value")]
    pub terminal_label: Option<String>,
    #[schemars(description = "herdr-core session name; empty uses the default")]
    pub hc_session: Option<String>,
    #[schemars(description = "herdr-core socket path; empty uses the default")]
    pub hc_socket: Option<String>,
    #[schemars(description = "Folder new Claude Code and Codex chats start in")]
    pub agent_folder: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FontList {
    chat: SurfaceFonts,
    board: SurfaceFonts,
    installed: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SurfaceFonts {
    presets: Vec<settings::FontPreset>,
    added: Vec<String>,
    min_size: u16,
    max_size: u16,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SettingsView {
    #[serde(flatten)]
    settings: settings::Settings,
    chat_width_range: [u32; 2],
    detail_width_range: [u32; 2],
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
    helper: bool,
    router: ToolRouter<Fathom>,
}

impl Fathom {
    pub fn new(db: Db, host: Host) -> Fathom {
        Fathom {
            db: Mutex::new(db),
            host,
            helper: false,
            router: Fathom::task_tools() + Fathom::start_tools(),
        }
    }

    pub fn helper(db: Db, host: Host) -> Fathom {
        Fathom {
            db: Mutex::new(db),
            host,
            helper: true,
            router: Fathom::task_tools() + Fathom::helper_tools(),
        }
    }

    fn change_settings(
        &self,
        change: impl FnOnce(&mut settings::Settings) -> Result<(), String>,
    ) -> Result<String, String> {
        reply(settings::update(&self.db.lock().unwrap(), change).map(settings_view))
    }
}

fn settings_view(settings: settings::Settings) -> SettingsView {
    let span = |range: &std::ops::RangeInclusive<u32>| [*range.start(), *range.end()];
    SettingsView {
        settings,
        chat_width_range: span(&CHAT_WIDTH.range),
        detail_width_range: span(&DETAIL_WIDTH.range),
    }
}

fn surface_fonts(surface: Surface, added: Vec<String>) -> SurfaceFonts {
    let sizes = settings::font_sizes(surface);
    SurfaceFonts {
        presets: settings::font_presets(surface).to_vec(),
        added,
        min_size: *sizes.start(),
        max_size: *sizes.end(),
    }
}

fn replace(target: &mut String, value: Option<String>) {
    if let Some(value) = value {
        *target = value.trim().to_string();
    }
}

#[tool_router(router = helper_tools)]
impl Fathom {
    #[tool(
        description = "Read the board layout: columns in order (id, name, project, width, collapsed), row names, the project names and the current project filter."
    )]
    fn get_board_layout(&self) -> Result<String, String> {
        reply(control::board_layout(&self.db.lock().unwrap()))
    }

    #[tool(
        description = "Read Fathom's settings: theme, fonts and sizes, panel widths, the project filter and the connection settings."
    )]
    fn get_settings(&self) -> Result<String, String> {
        reply(settings::load(&self.db.lock().unwrap()).map(settings_view))
    }

    #[tool(
        description = "List the font choices for the chat terminal and the board, their size ranges and the installed font families."
    )]
    fn list_fonts(&self) -> Result<String, String> {
        let current = settings::load(&self.db.lock().unwrap())?;
        reply(Ok(FontList {
            chat: surface_fonts(Surface::Chat, current.chat_added_fonts),
            board: surface_fonts(Surface::Board, current.board_added_fonts),
            installed: fonts::installed_families(),
        }))
    }

    #[tool(description = "Rename a column.")]
    fn rename_column(&self, Parameters(p): Parameters<RenameColumn>) -> Result<String, String> {
        reply(control::rename_column(
            &self.db.lock().unwrap(),
            p.id,
            &p.name,
        ))
    }

    #[tool(description = "Move a column to a new position.")]
    fn move_column(&self, Parameters(p): Parameters<MoveColumn>) -> Result<String, String> {
        reply(control::move_column(
            &mut self.db.lock().unwrap(),
            p.id,
            p.index,
        ))
    }

    #[tool(description = "Change a column's width or fold it. Leave out what stays the same.")]
    fn set_column_view(&self, Parameters(p): Parameters<SetColumnView>) -> Result<String, String> {
        reply(control::set_column_view(
            &self.db.lock().unwrap(),
            p.id,
            p.width,
            p.collapsed,
        ))
    }

    #[tool(description = "Add an empty custom column at the right end of the board.")]
    fn add_column(&self, Parameters(p): Parameters<AddColumn>) -> Result<String, String> {
        reply(control::add_column(&self.db.lock().unwrap(), &p.name))
    }

    #[tool(
        description = "Delete a column. A column that still has cards needs move_to_column, the column that takes them."
    )]
    fn delete_column(&self, Parameters(p): Parameters<DeleteColumn>) -> Result<String, String> {
        let home = settings::load(&self.db.lock().unwrap())?.home;
        let move_to = match (p.move_to_column, p.move_to_new_column) {
            (Some(_), Some(_)) => {
                return Err("give move_to_column or move_to_new_column, not both".into());
            }
            (Some(id), None) => Some(MoveTo::Column { id }),
            (None, Some(name)) => Some(MoveTo::NewColumn { name }),
            (None, None) => None,
        };
        reply(control::delete_column(
            &self.db,
            &Source::of(&home),
            p.id,
            move_to.as_ref(),
        ))
    }

    #[tool(description = "Rename a row. An empty name brings back the row's default name.")]
    fn rename_row(&self, Parameters(p): Parameters<RenameRow>) -> Result<String, String> {
        reply(control::rename_row(
            &self.db.lock().unwrap(),
            p.row,
            &p.name,
        ))
    }

    #[tool(description = "Show only the named projects' columns and hide every other column.")]
    fn show_projects(&self, Parameters(p): Parameters<ShowProjects>) -> Result<String, String> {
        reply(control::show_projects(&self.db.lock().unwrap(), &p.projects).map(settings_view))
    }

    #[tool(description = "Show every project's column again.")]
    fn show_all_projects(&self) -> Result<String, String> {
        reply(control::show_all_projects(&self.db.lock().unwrap()).map(settings_view))
    }

    #[tool(description = "Switch between the light and dark theme.")]
    fn set_theme(&self, Parameters(p): Parameters<SetTheme>) -> Result<String, String> {
        let change = WindowChange {
            theme: Some(p.theme),
            ..WindowChange::default()
        };
        reply(settings::change_window(&self.db.lock().unwrap(), &change).map(settings_view))
    }

    #[tool(
        description = "Change the chat and board fonts and sizes. Leave out what stays the same."
    )]
    fn set_fonts(&self, Parameters(p): Parameters<SetFonts>) -> Result<String, String> {
        self.change_settings(|s| {
            for (surface, font) in [(Surface::Chat, p.chat_font), (Surface::Board, p.board_font)] {
                if let Some(font) = font {
                    settings::set_font(s, surface, &font, fonts::installed_families)?;
                }
            }
            s.chat_font_size = p.chat_font_size.unwrap_or(s.chat_font_size);
            s.board_font_size = p.board_font_size.unwrap_or(s.board_font_size);
            Ok(())
        })
    }

    #[tool(
        description = "Show or hide the chat panel and change the chat and card detail widths. Leave out what stays the same."
    )]
    fn set_panels(&self, Parameters(p): Parameters<SetPanels>) -> Result<String, String> {
        let change = WindowChange {
            theme: None,
            chat_open: p.chat_open,
            chat_width: p.chat_width,
            detail_width: p.detail_width,
        };
        reply(settings::change_window(&self.db.lock().unwrap(), &change).map(settings_view))
    }

    #[tool(
        description = "Change where Fathom reads tasks and finds terminals: the Firstmate home, the chat terminal label, the herdr-core session and socket, and the folder new chats start in. Leave out what stays the same."
    )]
    fn set_connection(&self, Parameters(p): Parameters<SetConnection>) -> Result<String, String> {
        self.change_settings(|s| {
            replace(&mut s.home, p.home);
            replace(&mut s.terminal_label, p.terminal_label);
            replace(&mut s.hc_session, p.hc_session);
            replace(&mut s.hc_socket, p.hc_socket);
            replace(&mut s.agent_folder, p.agent_folder);
            Ok(())
        })
    }
}

#[tool_router(router = task_tools)]
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

#[tool_router(router = start_tools)]
impl Fathom {
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
            (db.task(id)?, settings::load(&db)?, db.path().to_path_buf())
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

#[tool_handler(router = self.router)]
impl ServerHandler for Fathom {
    fn get_info(&self) -> ServerConfig {
        let instructions = if self.helper {
            HELPER_INSTRUCTIONS
        } else {
            INSTRUCTIONS
        };
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new(SERVER_NAME, env!("CARGO_PKG_VERSION")))
            .with_instructions(instructions)
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
            _ => Err(format!(
                "usage: fathom {MCP_FLAG} [{HELPER_FLAG}] [{DB_FLAG} <store file>]"
            )),
        };
    }
    Ok(env
        .filter(|path| !path.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or(default))
}

pub fn wants_helper(args: &[String]) -> bool {
    args.iter().any(|a| a == HELPER_FLAG)
}

pub fn helper_asking(args: &[String]) -> Option<Result<bool, String>> {
    let index = args.iter().position(|a| a == HELPER_ASKING_FLAG)?;
    Some(match args.get(index + 1).map(String::as_str) {
        Some(YES) => Ok(true),
        Some(NO) => Ok(false),
        _ => Err(format!(
            "usage: fathom {HELPER_ASKING_FLAG} {YES}|{NO} [{DB_FLAG} <store file>]"
        )),
    })
}

pub fn record_helper_asking(store: &Path, asking: bool) -> Result<(), String> {
    let db = Db::open_file(store)?;
    if settings::helper_asking(&db)? != asking {
        settings::set_helper_asking(&db, asking)?;
    }
    Ok(())
}

pub fn serve_stdio(store: &Path, helper: bool) -> Result<(), String> {
    let db = Db::open_file(store)?;
    let host = Host::current()?;
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| format!("cannot start the MCP runtime: {e}"))?;
    runtime.block_on(async {
        let server = if helper {
            Fathom::helper(db, host)
        } else {
            Fathom::new(db, host)
        };
        let service = server
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
    use crate::db::backlog::Task;
    use crate::db::{Column, MoveStatus};
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

    const START_TOOLS: [&str; 1] = ["start_worker"];
    const TASK_TOOLS: [&str; 6] = [
        "add_task",
        "answer_request",
        "list_requests",
        "list_tasks",
        "move_task",
        "update_task",
    ];
    const HELPER_TOOLS: [&str; 15] = [
        "add_column",
        "delete_column",
        "get_board_layout",
        "get_settings",
        "list_fonts",
        "move_column",
        "rename_column",
        "rename_row",
        "set_column_view",
        "set_connection",
        "set_fonts",
        "set_panels",
        "set_theme",
        "show_all_projects",
        "show_projects",
    ];

    fn helper_board() -> (tempfile::TempDir, PathBuf, Fathom, Vec<Column>) {
        let dir = tempfile::tempdir().unwrap();
        let store = dir.path().join("board.sqlite");
        let db = Db::open_file(&store).unwrap();
        db.set_setting("home", "").unwrap();
        let server = Fathom::helper(db, no_host());
        add(&server, "Chart the reef", "reef-map", None);
        add(&server, "Paint the hull", "dry-dock", Some(Row::Shallows));
        add(&server, "Trim the sails", "rigging", None);
        let cards = Source::Backlog.read_cards(&server.db).unwrap();
        let columns = server.db.lock().unwrap().ensure_columns(&cards).unwrap();
        (dir, store, server, columns)
    }

    fn column<'a>(columns: &'a [Column], project: &str) -> &'a Column {
        columns
            .iter()
            .find(|c| c.project.as_deref() == Some(project))
            .unwrap()
    }

    fn stored(store: &Path) -> settings::Settings {
        settings::load(&Db::open_file(store).unwrap()).unwrap()
    }

    fn tool_names(server: &Fathom) -> Vec<String> {
        let mut names: Vec<String> = server
            .router
            .list_all()
            .into_iter()
            .map(|t| t.name.to_string())
            .collect();
        names.sort();
        names
    }

    #[test]
    fn the_chat_session_starts_workers_and_bosun_only_changes_the_app() {
        let (_dir, _store, chat) = server();
        let mut chat_tools: Vec<&str> = [TASK_TOOLS.as_slice(), START_TOOLS.as_slice()].concat();
        chat_tools.sort();
        assert_eq!(tool_names(&chat), chat_tools);
        assert!(!chat.helper);

        let (_dir, _store, helper, _) = helper_board();
        let mut helper_tools: Vec<&str> = [TASK_TOOLS.as_slice(), HELPER_TOOLS.as_slice()].concat();
        helper_tools.sort();
        assert_eq!(tool_names(&helper), helper_tools);
    }

    #[test]
    fn the_helper_switch_is_read_from_the_arguments() {
        let args = |list: &[&str]| list.iter().map(|a| a.to_string()).collect::<Vec<_>>();
        assert!(!wants_helper(&args(&["fathom", "--mcp", "--db", "/x"])));
        assert!(wants_helper(&args(&[
            "fathom", "--mcp", "--helper", "--db", "/x"
        ])));
        assert_eq!(helper_asking(&args(&["fathom", "--mcp"])), None);
        assert_eq!(
            helper_asking(&args(&["fathom", "--helper-asking", "yes"])),
            Some(Ok(true))
        );
        assert_eq!(
            helper_asking(&args(&["fathom", "--helper-asking", "no", "--db", "/x"])),
            Some(Ok(false))
        );
        assert!(matches!(
            helper_asking(&args(&["fathom", "--helper-asking", "maybe"])),
            Some(Err(_))
        ));
    }

    #[test]
    fn the_permission_hook_flag_is_written_only_when_it_changes() {
        let (_dir, store, _server) = server();
        let db = Db::open_file(&store).unwrap();
        db.changed_elsewhere().unwrap();
        record_helper_asking(&store, false).unwrap();
        assert!(!db.changed_elsewhere().unwrap());
        record_helper_asking(&store, true).unwrap();
        assert!(db.changed_elsewhere().unwrap());
        assert!(settings::helper_asking(&db).unwrap());
        record_helper_asking(&store, true).unwrap();
        assert!(!db.changed_elsewhere().unwrap());
        record_helper_asking(&store, false).unwrap();
        assert!(!settings::helper_asking(&db).unwrap());
    }

    #[test]
    fn reads_the_board_layout() {
        let (_dir, _store, server, _) = helper_board();
        let layout: Value = ok(server.get_board_layout());
        assert_eq!(
            layout["projects"],
            json!(["dry-dock", "reef-map", "rigging"])
        );
        assert_eq!(layout["columns"].as_array().unwrap().len(), 3);
        assert_eq!(layout["rows"].as_array().unwrap().len(), 5);
        assert_eq!(layout["projectFilter"], json!([]));
    }

    #[test]
    fn renames_moves_and_resizes_columns() {
        let (_dir, store, server, columns) = helper_board();
        let reef = column(&columns, "reef-map").id;

        let renamed: Value = ok(server.rename_column(Parameters(RenameColumn {
            id: reef,
            name: "Reef chart".into(),
        })));
        assert_eq!(renamed["name"], "Reef chart");
        assert_eq!(
            server.rename_column(Parameters(RenameColumn {
                id: 99,
                name: "Ghost".into(),
            })),
            Err("there is no column 99".into())
        );

        let moved: Vec<Column> =
            ok(server.move_column(Parameters(MoveColumn { id: reef, index: 0 })));
        assert_eq!(moved[0].id, reef);

        let folded: Value = ok(server.set_column_view(Parameters(SetColumnView {
            id: reef,
            width: Some(300),
            collapsed: Some(true),
        })));
        assert_eq!(folded["width"], 300);
        assert_eq!(folded["collapsed"], true);
        let too_wide = server.set_column_view(Parameters(SetColumnView {
            id: reef,
            width: Some(5000),
            collapsed: None,
        }));
        assert!(too_wide.unwrap_err().contains("between 180 and 640"));

        let db = Db::open_file(&store).unwrap();
        let saved = db.columns().unwrap();
        assert_eq!(saved[0].name, "Reef chart");
        assert_eq!(saved[0].width, 300);
        assert!(saved[0].collapsed);
    }

    #[test]
    fn adds_and_deletes_columns_and_moves_their_cards() {
        let (_dir, store, server, columns) = helper_board();
        let added: Vec<Column> = ok(server.add_column(Parameters(AddColumn {
            name: "Ideas".into(),
        })));
        let ideas = added.iter().find(|c| c.name == "Ideas").unwrap().id;
        let _: Vec<Column> = ok(server.delete_column(Parameters(DeleteColumn {
            id: ideas,
            move_to_column: None,
            move_to_new_column: None,
        })));

        let reef = column(&columns, "reef-map").id;
        let holding = server.delete_column(Parameters(DeleteColumn {
            id: reef,
            move_to_column: None,
            move_to_new_column: None,
        }));
        assert!(holding.unwrap_err().contains("choose a column to move to"));
        let both = server.delete_column(Parameters(DeleteColumn {
            id: reef,
            move_to_column: Some(column(&columns, "rigging").id),
            move_to_new_column: Some("Later".into()),
        }));
        assert!(both.is_err());

        let left: Vec<Column> = ok(server.delete_column(Parameters(DeleteColumn {
            id: reef,
            move_to_column: None,
            move_to_new_column: Some("Later".into()),
        })));
        assert!(left.iter().all(|c| c.id != reef));
        let later = left.iter().find(|c| c.name == "Later").unwrap().id;
        let db = Db::open_file(&store).unwrap();
        assert!(
            db.columns()
                .unwrap()
                .iter()
                .all(|c| c.id != reef && c.id != ideas)
        );
        assert!(db.places().unwrap().iter().any(|p| p.column == Some(later)));
    }

    #[test]
    fn renames_a_row() {
        let (_dir, store, server, _) = helper_board();
        let rows: Vec<Value> = ok(server.rename_row(Parameters(RenameRow {
            row: Row::Deep,
            name: "Parked".into(),
        })));
        assert!(
            rows.iter()
                .any(|r| r["row"] == "deep" && r["name"] == "Parked")
        );
        let db = Db::open_file(&store).unwrap();
        assert!(
            db.row_names()
                .unwrap()
                .iter()
                .any(|r| r.row == Row::Deep && r.name == "Parked")
        );
    }

    #[test]
    fn shows_only_the_named_projects_until_shown_all() {
        let (_dir, store, server, columns) = helper_board();
        let shown: Value = ok(server.show_projects(Parameters(ShowProjects {
            projects: vec!["Reef-Map".into(), "rigging".into()],
        })));
        assert_eq!(shown["projectFilter"], json!(["reef-map", "rigging"]));
        assert_eq!(stored(&store).project_filter, ["reef-map", "rigging"]);

        let reef = column(&columns, "reef-map").id;
        let _: Value = ok(server.rename_column(Parameters(RenameColumn {
            id: reef,
            name: "Fathom".into(),
        })));
        let by_column_name: Value = ok(server.show_projects(Parameters(ShowProjects {
            projects: vec!["fathom".into()],
        })));
        assert_eq!(by_column_name["projectFilter"], json!(["reef-map"]));

        let unknown = server.show_projects(Parameters(ShowProjects {
            projects: vec!["lighthouse".into()],
        }));
        assert_eq!(
            unknown,
            Err(
                "there is no project \"lighthouse\"; the projects are dry-dock, reef-map, rigging"
                    .into()
            )
        );
        let none = server.show_projects(Parameters(ShowProjects { projects: vec![] }));
        assert_eq!(none, Err("name at least one project to show".into()));

        let all: Value = ok(server.show_all_projects());
        assert_eq!(all["projectFilter"], json!([]));
        assert!(stored(&store).project_filter.is_empty());
    }

    #[test]
    fn sets_the_theme_and_the_panels() {
        let (_dir, store, server, _) = helper_board();
        let dark: Value = ok(server.set_theme(Parameters(SetTheme { theme: Theme::Dark })));
        assert_eq!(dark["theme"], "dark");
        assert_eq!(stored(&store).theme, Theme::Dark);

        let panels: Value = ok(server.set_panels(Parameters(SetPanels {
            chat_open: Some(false),
            chat_width: Some(720),
            detail_width: None,
        })));
        assert_eq!(panels["chatOpen"], false);
        assert_eq!(panels["chatWidth"], 720);
        assert_eq!(panels["detailWidth"], DETAIL_WIDTH.default);
        assert_eq!(panels["chatWidthRange"], json!([300, 1400]));
        let narrow = server.set_panels(Parameters(SetPanels {
            chat_open: None,
            chat_width: Some(10),
            detail_width: None,
        }));
        assert_eq!(
            narrow,
            Err("the chat width must be between 300 and 1400 pixels".into())
        );
        assert_eq!(stored(&store).chat_width, 720);
    }

    #[test]
    fn sets_fonts_from_presets_and_checks_sizes() {
        let (_dir, store, server, _) = helper_board();
        let fonts: Value = ok(server.list_fonts());
        let board_preset = fonts["board"]["presets"][1]["key"]
            .as_str()
            .unwrap()
            .to_string();
        let board_name = fonts["board"]["presets"][1]["name"]
            .as_str()
            .unwrap()
            .to_string();
        assert!(fonts["installed"].is_array());

        let changed: Value = ok(server.set_fonts(Parameters(SetFonts {
            chat_font: None,
            chat_font_size: Some(15),
            board_font: Some(board_name.to_uppercase()),
            board_font_size: None,
        })));
        assert_eq!(changed["boardFont"], board_preset);
        assert_eq!(changed["chatFontSize"], 15);
        assert_eq!(stored(&store).board_font, board_preset);

        let huge = server.set_fonts(Parameters(SetFonts {
            chat_font: None,
            chat_font_size: None,
            board_font: None,
            board_font_size: Some(90),
        }));
        assert_eq!(
            huge,
            Err("the board font size must be between 11 and 20".into())
        );
        let missing = server.set_fonts(Parameters(SetFonts {
            chat_font: Some("No Such Font Family 42".into()),
            chat_font_size: None,
            board_font: None,
            board_font_size: None,
        }));
        assert_eq!(
            missing,
            Err("no font named \"No Such Font Family 42\" is installed".into())
        );
    }

    #[test]
    fn sets_the_connection_and_reads_the_settings() {
        let (_dir, store, server, _) = helper_board();
        let changed: Value = ok(server.set_connection(Parameters(SetConnection {
            home: None,
            terminal_label: None,
            hc_session: Some(" crew ".into()),
            hc_socket: None,
            agent_folder: Some("/work/projects".into()),
        })));
        assert_eq!(changed["hcSession"], "crew");
        assert_eq!(changed["agentFolder"], "/work/projects");
        assert_eq!(changed["home"], "");
        let read: Value = ok(server.get_settings());
        assert_eq!(read["hcSession"], "crew");
        assert_eq!(stored(&store).agent_folder, "/work/projects");
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

    #[tokio::test]
    async fn the_helper_switch_adds_the_app_control_tools_and_instructions() {
        let (_dir, store, server, _) = helper_board();
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
        let instructions = init["result"]["instructions"].as_str().unwrap();
        assert!(instructions.contains("show_projects hides every column"));
        assert!(!instructions.contains("Keep your task list in Fathom"));
        assert!(!instructions.contains("start_worker"));
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
        assert_eq!(
            tools["result"]["tools"].as_array().unwrap().len(),
            TASK_TOOLS.len() + HELPER_TOOLS.len()
        );
        let themed = call(
            &mut lines,
            &mut write,
            json!({"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {
                "name": "set_theme",
                "arguments": {"theme": "dark"}
            }}),
        )
        .await;
        assert_eq!(themed["result"]["isError"], false);
        assert_eq!(stored(&store).theme, Theme::Dark);
        drop(write);
        drop(lines);
        running.await.unwrap();
    }
}
