use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use rmcp::handler::server::router::tool::ToolRouter;
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::{Implementation, ServerCapabilities, ServerConfig};
use rmcp::{ServerHandler, ServiceExt, tool, tool_handler, tool_router};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::control::{self, TaskRef};
use crate::db::backlog::{NewTask, Task, TaskChange};
use crate::db::numbers::BACKLOG_HOME;
use crate::db::{Db, MoveRequest, MoveStatus, MoveTo};
use crate::fonts;
use crate::herdr::{Connection, Herdr, Terminal};
use crate::launch::{self, Agent, FathomServer, Launch};
use crate::settings::{self, AgentFilter, CHAT_WIDTH, DETAIL_WIDTH, Surface, Theme, WindowChange};
use crate::shell_path;
use crate::source::Source;
use crate::state::{connection_of, now_ms};
use crate::tasks::Row;
use crate::workers::{self, LIVE};

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
Each task has a number such as #42 that never changes; tools that take a task take that number.
Add a task for each piece of work with add_task, keep its title and detail current with update_task, and move it with move_task whenever its state changes.
Use a short, stable project name per repository or area so the board can group tasks.
Rows: surface means the task needs the user, shallows means in progress, seabed means queued (the default), deep means parked or waiting on something, and landed means done.
The user plans by dragging cards on the board. A drag never moves a task by itself: it becomes a board request that you answer.
When you see a line such as \"1 board request waiting\", call list_requests and answer every request.
Accept a request with answer_request or by moving the task to the requested row with move_task.
Decline with answer_request and a short reason; the board shows that reason to the user.
To hand a task to a worker, call start_worker with its number instead of using your own subagents.
Each worker is its own Claude Code session in its own terminal: the user sees it as a sailor on the card and can open its terminal.
Keep your own subagents for quick lookups that finish inside your current turn.
If you were started as the worker for a task, keep that task current: move it to shallows when you begin, add progress and findings to its detail with update_task, move it to surface with the question in its detail when you need the user, and move it to landed when the work is done.";

pub fn worker_prompt(number: i64) -> String {
    format!(
        "You are the Fathom worker for task #{number}. \
Read the task with the fathom list_tasks tool, move it to shallows with move_task, then do the work it describes in this folder. \
Report through the fathom tools as you go: add progress and findings to the task's detail with update_task, keeping the original request at the top. \
If you need the user, put the question in the detail and move the task to surface. \
When the work is done, write a short summary in the detail and move the task to landed."
    )
}

const HELPER_INSTRUCTIONS: &str = "\
Fathom is the user's task board app. These tools change how Fathom shows the board and its settings; they never change tasks.
Columns are projects (or custom columns the user added); rows are surface, shallows, seabed, deep and landed.
Each task has a number such as #42 that never changes, and a task from Firstmate also has a name such as reef-chart-fix. Tools that take a task accept the number (42 or #42) or the name.
When you mention a task to the user, give its number and name before its title, as in #42 reef-chart-fix.
Read get_board_layout before changing columns, rows or the filters, and get_settings before changing settings.
Refer to columns by the id from get_board_layout.
show_projects hides every column except the named projects; show_all_projects shows every column again.
set_row_view collapses rows to a thin band that still shows the row's name and card count, or expands them again; get_board_layout gives each row's collapsed state.
When asked to show or filter the board by rows, collapse every other row and expand the asked ones: \"only show what is in progress\" means expand shallows and collapse the rest.
Each task has one of three agent states, the agent field from list_tasks: none means no agent is on it, inactive means it has an agent that is not active (idle, or waiting for a permission answer), and active means it has an active agent that is working right now.
A task or column \"with an active agent\" means active only; \"with an agent\" means inactive or active.
set_agent_filter hides cards by their agent: withAgent shows only tasks with an agent, withActiveAgent only tasks with an active agent, and all shows every card again. The window keeps it in step with the agents, and it combines with the project filter.
When asked to show only tasks or cards with an agent or an active agent, use set_agent_filter; get_board_layout gives the current agentFilter.
get_board_layout gives each column its tasks, tasksWithAgent and tasksWithActiveAgent counts.
When asked for only the columns with an active agent, call show_projects with the project of every column whose tasksWithActiveAgent is above 0; for columns with any agent, use tasksWithAgent instead.
Custom columns have no project, so show_projects cannot keep them; say so when one of them has an agent.
If get_board_layout has an agentError, Fathom could not read the agents; tell the user instead of guessing.
focus_tasks shows only the given tasks until clear_focus; it also shows every project and sets the agent filter to all, so the board shows exactly those tasks. Use it when asked to focus on, bring up or show only certain tasks.
focus_tasks returns the tasks it could not find under unknown; tell the user about them. If a focused task sits in a collapsed row or column, expand that row or column.
get_board_layout gives the numbers of the focused tasks under focus.
When asked to show everything again, undo every filter: expand every row with set_row_view, call show_all_projects, set the agent filter to all and call clear_focus.
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

#[derive(Debug, Clone, PartialEq, Deserialize, JsonSchema)]
#[serde(untagged)]
pub enum TaskKey {
    Number(i64),
    Text(String),
}

impl TaskKey {
    fn text(&self) -> String {
        match self {
            TaskKey::Number(number) => number.to_string(),
            TaskKey::Text(text) => text.clone(),
        }
    }

    fn task(&self) -> Result<TaskRef, String> {
        TaskRef::parse(&self.text())
    }
}

const TASK_KEY: &str = "The task's number, such as 42 or #42, or its name";

#[derive(Debug, Deserialize, JsonSchema)]
pub struct UpdateTask {
    #[schemars(description = TASK_KEY)]
    pub task: TaskKey,
    pub title: Option<String>,
    pub detail: Option<String>,
    pub project: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct MoveTask {
    #[schemars(description = TASK_KEY)]
    pub task: TaskKey,
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
    #[schemars(description = TASK_KEY)]
    pub task: TaskKey,
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
pub struct SetRowView {
    #[schemars(description = "Rows to change")]
    pub rows: Vec<Row>,
    #[schemars(description = "true collapses the rows to a thin band, false expands them")]
    pub collapsed: bool,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct SetAgentFilter {
    #[schemars(
        description = "all shows every card, withAgent only cards with an agent, withActiveAgent only cards with an active agent"
    )]
    pub filter: AgentFilter,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ShowProjects {
    #[schemars(description = "Project names to keep on the board; every other column is hidden")]
    pub projects: Vec<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct FocusTasks {
    #[schemars(
        description = "Tasks to show, each by number (42 or #42) or name; every other card is hidden"
    )]
    pub tasks: Vec<TaskKey>,
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
    pub number: i64,
    pub terminal: String,
    pub folder: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RequestView {
    request_id: String,
    number: Option<i64>,
    title: String,
    from_row: Row,
    to_row: Row,
    created_ms: i64,
    status: MoveStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    answer: Option<String>,
}

fn request_view(db: &Db, request: MoveRequest) -> Result<RequestView, String> {
    Ok(RequestView {
        number: db.number_named(BACKLOG_HOME, &request.card_id)?,
        request_id: request.request_id,
        title: request.title,
        from_row: request.from_row,
        to_row: request.to_row,
        created_ms: request.created_ms,
        status: request.status,
        answer: request.answer,
    })
}

fn task_reply(task: Result<Task, String>) -> Result<String, String> {
    reply(task.map(|task| control::backlog_view(&task)))
}

pub type FindProgram = Box<dyn Fn(&str) -> Option<PathBuf> + Send + Sync>;
pub type ListTerminals = Box<dyn Fn(&Connection) -> Result<Vec<Terminal>, String> + Send + Sync>;

pub struct Host {
    pub program: PathBuf,
    pub shell: Option<PathBuf>,
    pub find: FindProgram,
    pub terminals: ListTerminals,
}

impl Host {
    pub fn current() -> Result<Host, String> {
        Ok(Host {
            program: std::env::current_exe()
                .map_err(|e| format!("cannot find Fathom's own program: {e}"))?,
            shell: shell_path::login_shell().map(PathBuf::from),
            find: Box::new(|program| shell_path::find_first(&[program])),
            terminals: Box::new(|connection| {
                Herdr::new(connection.clone(), Arc::new(|_| {})).list()
            }),
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

impl Fathom {
    fn source(&self) -> Result<Source, String> {
        Ok(Source::of(&settings::load(&self.db.lock().unwrap())?.home))
    }

    fn backlog_id(&self, task: &TaskKey) -> Result<i64, String> {
        control::backlog_task_id(&self.db.lock().unwrap(), &task.task()?)
    }

    fn board(&self) -> Result<(Source, control::Agents), String> {
        let settings = settings::load(&self.db.lock().unwrap())?;
        let source = Source::of(&settings.home);
        let agents = (self.host.terminals)(&connection_of(&settings)).map(|listed| {
            let terminals = listed.into_iter().map(|t| (t.address.clone(), t)).collect();
            workers::agent_states(&workers::board_workers(
                &source,
                &settings.hc_session,
                &terminals,
            ))
        });
        Ok((source, agents))
    }
}

#[tool_router(router = helper_tools)]
impl Fathom {
    #[tool(
        description = "Read the board layout: columns in order (id, name, project, width, collapsed, and how many tasks, tasks with an agent and tasks with an active agent each holds), rows (name and collapsed), the project names, the current project filter and the current agent filter."
    )]
    fn get_board_layout(&self) -> Result<String, String> {
        let (source, agents) = self.board()?;
        reply(control::board_layout(&self.db, &source, &agents))
    }

    #[tool(
        description = "Read Fathom's settings: theme, fonts and sizes, panel widths, the project filter, the agent filter and the connection settings."
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
            &self.source()?,
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

    #[tool(
        description = "Collapse one or more rows to a thin band, or expand them again. Leave out the rows that stay the same."
    )]
    fn set_row_view(&self, Parameters(p): Parameters<SetRowView>) -> Result<String, String> {
        reply(control::set_row_view(
            &self.db.lock().unwrap(),
            &p.rows,
            p.collapsed,
        ))
    }

    #[tool(
        description = "Show every card, only cards with an agent, or only cards with an active agent."
    )]
    fn set_agent_filter(
        &self,
        Parameters(p): Parameters<SetAgentFilter>,
    ) -> Result<String, String> {
        reply(control::set_agent_filter(&self.db.lock().unwrap(), p.filter).map(settings_view))
    }

    #[tool(description = "Show only the named projects' columns and hide every other column.")]
    fn show_projects(&self, Parameters(p): Parameters<ShowProjects>) -> Result<String, String> {
        reply(control::show_projects(&self.db.lock().unwrap(), &p.projects).map(settings_view))
    }

    #[tool(description = "Show every project's column again.")]
    fn show_all_projects(&self) -> Result<String, String> {
        reply(control::show_all_projects(&self.db.lock().unwrap()).map(settings_view))
    }

    #[tool(
        description = "Focus the board on the given tasks: the board shows only their cards until clear_focus. It also shows every project and sets the agent filter to all. Returns the focused tasks and, under unknown, the entries that match no task on the board."
    )]
    fn focus_tasks(&self, Parameters(p): Parameters<FocusTasks>) -> Result<String, String> {
        let (source, agents) = self.board()?;
        let wanted: Vec<String> = p.tasks.iter().map(TaskKey::text).collect();
        reply(control::focus_tasks(&self.db, &source, &wanted, &agents))
    }

    #[tool(description = "Clear the task focus so the board shows every card again.")]
    fn clear_focus(&self) -> Result<String, String> {
        reply(control::clear_focus(&self.db.lock().unwrap()).map(settings_view))
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
    #[tool(
        description = "List the tasks the board shows, optionally only one project or one row. Each task has its number, its name when it comes from Firstmate, its column and its agent state: none, inactive (has an agent that is not active) or active (has an active agent)."
    )]
    fn list_tasks(&self, Parameters(p): Parameters<ListTasks>) -> Result<String, String> {
        let (source, agents) = self.board()?;
        reply(control::board_tasks(
            &self.db,
            &source,
            p.project.as_deref(),
            p.row,
            &agents,
        ))
    }

    #[tool(description = "Add a task to the backlog.")]
    fn add_task(&self, Parameters(p): Parameters<AddTask>) -> Result<String, String> {
        let task = NewTask {
            title: p.title,
            detail: p.detail.unwrap_or_default(),
            project: p.project,
            row: p.row,
        };
        task_reply(self.db.lock().unwrap().add_task(&task, now_ms()))
    }

    #[tool(
        description = "Change a task's title, detail or project. Leave out what stays the same."
    )]
    fn update_task(&self, Parameters(p): Parameters<UpdateTask>) -> Result<String, String> {
        let id = self.backlog_id(&p.task)?;
        let change = TaskChange {
            title: p.title,
            detail: p.detail,
            project: p.project,
        };
        task_reply(self.db.lock().unwrap().update_task(id, &change, now_ms()))
    }

    #[tool(
        description = "Move a task to a row. This also answers any board request asking for that row."
    )]
    fn move_task(&self, Parameters(p): Parameters<MoveTask>) -> Result<String, String> {
        let id = self.backlog_id(&p.task)?;
        task_reply(self.db.lock().unwrap().move_task(id, p.row, now_ms()))
    }

    #[tool(description = "List board requests the user made by dragging cards, oldest first.")]
    fn list_requests(&self) -> Result<String, String> {
        let db = self.db.lock().unwrap();
        reply(
            db.task_requests()?
                .into_iter()
                .map(|request| request_view(&db, request))
                .collect::<Result<Vec<_>, _>>(),
        )
    }

    #[tool(
        description = "Answer a board request: accept moves the task to the requested row, decline needs a short reason."
    )]
    fn answer_request(&self, Parameters(p): Parameters<AnswerRequest>) -> Result<String, String> {
        let mut db = self.db.lock().unwrap();
        if p.accept {
            return task_reply(db.accept_request(&p.request_id, now_ms()));
        }
        let declined =
            db.decline_request(&p.request_id, p.reason.as_deref().unwrap_or_default())?;
        reply(request_view(&db, declined))
    }
}

#[tool_router(router = start_tools)]
impl Fathom {
    #[tool(
        description = "Start a Claude Code worker on a task in its own terminal. The worker reads the task, does the work and reports by updating the task. Use this instead of your own subagents for work the user should see on the board."
    )]
    fn start_worker(&self, Parameters(p): Parameters<StartWorker>) -> Result<String, String> {
        let id = self.backlog_id(&p.task)?;
        reply(self.start(id, p.folder))
    }
}

impl Fathom {
    fn start(&self, id: i64, folder: Option<String>) -> Result<StartedWorker, String> {
        let (task, settings, store) = {
            let db = self.db.lock().unwrap();
            (db.task(id)?, settings::load(&db)?, db.path().to_path_buf())
        };
        let number = task
            .number
            .ok_or_else(|| format!("task {id} has no number"))?;
        if task.row == Row::Landed {
            return Err(format!("task #{number} is already done"));
        }
        let herdr = Herdr::new(connection_of(&settings), Arc::new(|_| {}));
        if let Some(live) = herdr
            .labeled(&launch::task_label(id))?
            .into_iter()
            .find(|t| t.state == LIVE)
        {
            return Err(format!(
                "task #{number} already has a live worker in terminal {}",
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
        let prompt = worker_prompt(number);
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
            number,
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
        listing_host(Ok(vec![]))
    }

    fn listing_host(listed: Result<Vec<Terminal>, String>) -> Host {
        Host {
            program: PathBuf::from("/opt/fathom/fathom"),
            shell: None,
            find: Box::new(|_| None),
            terminals: Box::new(move |_| listed.clone()),
        }
    }

    const EARLIER_HOME: &str = "/work/earlier-firstmate";
    const EARLIER_TASKS: i64 = 10;

    fn backlog_db(store: &Path) -> Db {
        let db = Db::open_file(store).unwrap();
        db.set_setting("home", "").unwrap();
        let mut earlier: Vec<crate::tasks::Card> = (1..=EARLIER_TASKS)
            .map(|n| card(&format!("earlier-{n}"), "reef-map", Row::Seabed))
            .collect();
        db.number_cards(EARLIER_HOME, &mut earlier).unwrap();
        db
    }

    fn backlog_id(store: &Path, number: i64) -> i64 {
        let db = Db::open_file(store).unwrap();
        control::backlog_task_id(&db, &TaskRef::Number(number)).unwrap()
    }

    fn number_of(task: &Value) -> i64 {
        task["number"].as_i64().unwrap()
    }

    fn server() -> (tempfile::TempDir, PathBuf, Fathom) {
        let dir = tempfile::tempdir().unwrap();
        let store = dir.path().join("board.sqlite");
        let server = Fathom::new(backlog_db(&store), no_host());
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

    fn drag(store: &Path, number: i64, to_row: Row, now_ms: i64) {
        let id = backlog_id(store, number);
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
        let number = number_of(&add(&server, "Chart the reef", "reef-map", None));
        assert_eq!(number, EARLIER_TASKS + 1);
        let updated: Value = ok(server.update_task(Parameters(UpdateTask {
            task: TaskKey::Text(format!("#{number}")),
            title: None,
            detail: Some("Start at the north buoy".into()),
            project: None,
        })));
        assert_eq!(updated["title"], "Chart the reef");
        assert_eq!(updated["detail"], "Start at the north buoy");
        assert_eq!(updated["project"], "reef-map");
        assert_eq!(updated["number"], number);
        assert!(updated.get("id").is_none());
        let ghost = |task: TaskKey| {
            server.update_task(Parameters(UpdateTask {
                task,
                title: Some("Ghost".into()),
                detail: None,
                project: None,
            }))
        };
        assert_eq!(ghost(TaskKey::Number(99)), Err("no task #99".into()));
        assert_eq!(
            ghost(TaskKey::Number(3)),
            Err("#3 is the Firstmate task earlier-3, which Fathom cannot change".into())
        );
        assert_eq!(
            ghost(TaskKey::Text("chart-reef".into())),
            Err(
                "Fathom's own tasks have no name; give the task's number instead of chart-reef"
                    .into()
            )
        );
        assert_eq!(
            ghost(TaskKey::Text("#reef".into())),
            Err("#reef is not a task number".into())
        );
    }

    #[test]
    fn moves_a_task_between_rows() {
        let (_dir, _store, server) = server();
        let number = number_of(&add(&server, "Chart the reef", "reef-map", None));
        let moved: Value = ok(server.move_task(Parameters(MoveTask {
            task: TaskKey::Number(number),
            row: Row::Landed,
        })));
        assert_eq!(moved["row"], "landed");
        assert_eq!(list(&server, None, Some(Row::Landed)).len(), 1);
    }

    #[test]
    fn a_board_request_is_listed_until_a_move_to_its_row_answers_it() {
        let (_dir, store, server) = server();
        let number = number_of(&add(&server, "Chart the reef", "reef-map", None));
        drag(&store, number, Row::Surface, 10);

        let waiting: Vec<Value> = ok(server.list_requests());
        assert_eq!(waiting.len(), 1);
        assert_eq!(waiting[0]["number"], number);
        assert!(waiting[0].get("cardId").is_none());
        assert_eq!(waiting[0]["toRow"], "surface");
        assert_eq!(list(&server, None, None)[0]["row"], "seabed");

        let _: Value = ok(server.move_task(Parameters(MoveTask {
            task: TaskKey::Text(number.to_string()),
            row: Row::Surface,
        })));
        assert!(ok::<Vec<Value>>(server.list_requests()).is_empty());
        let db = Db::open_file(&store).unwrap();
        assert_eq!(db.all_requests().unwrap()[0].status, MoveStatus::Landed);
    }

    #[test]
    fn accepting_a_request_moves_the_task() {
        let (_dir, store, server) = server();
        let number = number_of(&add(&server, "Chart the reef", "reef-map", None));
        drag(&store, number, Row::Shallows, 10);
        let request_id = format!("fathom-move-{}-10", backlog_id(&store, number));
        let accepted: Value = ok(server.answer_request(Parameters(AnswerRequest {
            request_id: request_id.clone(),
            accept: true,
            reason: None,
        })));
        assert_eq!(accepted["row"], "shallows");
        assert_eq!(accepted["number"], number);
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
        let number = number_of(&add(&server, "Chart the reef", "reef-map", None));
        drag(&store, number, Row::Landed, 10);
        let request_id = format!("fathom-move-{}-10", backlog_id(&store, number));
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
        assert_eq!(declined["number"], number);
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
                crate::test_support::write_script(&script, body);
            }
            crate::herdr::tests::FAKE_HC.with(|fake| *fake.borrow_mut() = Some(bin.join("hc")));
            let store = data.join("fathom.sqlite");
            let db = backlog_db(&store);
            db.set_setting("hcSession", LAB_SESSION).unwrap();
            db.set_setting("hcSocket", "/run/reef-lab.sock").unwrap();
            db.set_setting("agentFolder", &folder.display().to_string())
                .unwrap();
            let found = bin.clone();
            let host = Host {
                program: PathBuf::from("/opt/fathom/fathom"),
                shell: Some(bin.join("zsh")),
                find: Box::new(move |program| Some(found.join(program)).filter(|p| p.is_file())),
                terminals: Box::new(|connection| {
                    Herdr::new(connection.clone(), Arc::new(|_| {})).list()
                }),
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
            number_of(&add(&self.server, title, "reef-map", row))
        }

        fn id(&self, number: i64) -> i64 {
            backlog_id(&self.store, number)
        }

        fn start(&self, number: i64, folder: Option<&Path>) -> Result<String, String> {
            self.server.start_worker(Parameters(StartWorker {
                task: TaskKey::Number(number),
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
        let number = lab.task("Chart the reef", None);
        let id = lab.id(number);
        assert_ne!(id, number);
        let started: Value = ok(lab.start(number, None));
        let folder = lab.folder.display().to_string();
        assert_eq!(
            started,
            json!({"number": number, "terminal": "t9", "folder": folder})
        );

        let config = lab.store.with_file_name("fathom-mcp.json");
        let prompt = worker_prompt(number);
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
        assert!(prompt.contains(&format!("worker for task #{number}")));
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
        assert_eq!(lab.start(42, None), Err("no task #42".into()));
        let done = lab.task("Book the crane", Some(Row::Landed));
        assert_eq!(
            lab.start(done, None),
            Err(format!("task #{done} is already done"))
        );
        assert!(lab.calls().is_empty());
    }

    #[test]
    fn start_worker_refuses_a_task_that_already_has_a_live_worker() {
        let lab = WorkerLab::new();
        let number = lab.task("Chart the reef", Some(Row::Shallows));
        let id = lab.id(number);
        lab.list(json!([
            {"address": "t2", "state": "finished", "labels": {"fathom.task": id.to_string()}},
            {"address": "t3", "state": "live", "labels": {"fathom.task": id.to_string()}},
        ]));
        assert_eq!(
            lab.start(number, None),
            Err(format!(
                "task #{number} already has a live worker in terminal t3"
            ))
        );
        assert_eq!(lab.calls().len(), 1);

        lab.list(json!([
            {"address": "t2", "state": "finished", "labels": {"fathom.task": id.to_string()}},
        ]));
        let started: Value = ok(lab.start(number, None));
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
    const HELPER_TOOLS: [&str; 19] = [
        "add_column",
        "clear_focus",
        "delete_column",
        "focus_tasks",
        "get_board_layout",
        "get_settings",
        "list_fonts",
        "move_column",
        "rename_column",
        "rename_row",
        "set_agent_filter",
        "set_column_view",
        "set_connection",
        "set_fonts",
        "set_panels",
        "set_row_view",
        "set_theme",
        "show_all_projects",
        "show_projects",
    ];

    fn helper_board() -> (tempfile::TempDir, PathBuf, Fathom, Vec<Column>) {
        let dir = tempfile::tempdir().unwrap();
        let store = dir.path().join("board.sqlite");
        let server = Fathom::helper(backlog_db(&store), no_host());
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
        assert_eq!(layout["rows"][1]["collapsed"], false);
        assert_eq!(layout["projectFilter"], json!([]));
        assert_eq!(layout["agentFilter"], "all");
    }

    #[test]
    fn the_layout_includes_a_project_the_window_has_not_read_yet() {
        let (_dir, _store, server, _) = helper_board();
        add(&server, "Raise the mast", "mast-works", None);
        let layout: Value = ok(server.get_board_layout());
        assert_eq!(
            layout["projects"],
            json!(["dry-dock", "mast-works", "reef-map", "rigging"])
        );
        let mast = &layout["columns"][3];
        assert_eq!(mast["project"], "mast-works");
        let shown: Value = ok(server.show_projects(Parameters(ShowProjects {
            projects: vec!["mast-works".into()],
        })));
        assert_eq!(shown["projectFilter"], json!(["mast-works"]));
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
            db.rows()
                .unwrap()
                .iter()
                .any(|r| r.row == Row::Deep && r.name == "Parked")
        );
    }

    fn collapsed_rows(layout: &Value) -> Vec<String> {
        layout["rows"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|r| r["collapsed"] == true)
            .map(|r| r["row"].as_str().unwrap().to_string())
            .collect()
    }

    #[test]
    fn collapses_and_expands_rows() {
        let (_dir, store, server, _) = helper_board();
        let others = vec![Row::Surface, Row::Deep, Row::Seabed, Row::Landed];
        let rows: Value = ok(server.set_row_view(Parameters(SetRowView {
            rows: others,
            collapsed: true,
        })));
        assert_eq!(
            collapsed_rows(&json!({ "rows": rows })),
            ["surface", "deep", "seabed", "landed"]
        );
        let layout: Value = ok(server.get_board_layout());
        assert_eq!(
            collapsed_rows(&layout),
            ["surface", "deep", "seabed", "landed"]
        );

        let _: Value = ok(server.set_row_view(Parameters(SetRowView {
            rows: Row::ALL.to_vec(),
            collapsed: false,
        })));
        let reopened = Db::open_file(&store).unwrap();
        assert!(reopened.rows().unwrap().iter().all(|r| !r.collapsed));

        let none = server.set_row_view(Parameters(SetRowView {
            rows: vec![],
            collapsed: true,
        }));
        assert_eq!(none, Err("name at least one row".into()));
    }

    #[test]
    fn sets_the_agent_filter_and_reports_it() {
        let (_dir, store, server, _) = helper_board();
        let set: Value = ok(server.set_agent_filter(Parameters(SetAgentFilter {
            filter: AgentFilter::WithActiveAgent,
        })));
        assert_eq!(set["agentFilter"], "withActiveAgent");
        assert_eq!(stored(&store).agent_filter, AgentFilter::WithActiveAgent);
        let layout: Value = ok(server.get_board_layout());
        assert_eq!(layout["agentFilter"], "withActiveAgent");
        let read: Value = ok(server.get_settings());
        assert_eq!(read["agentFilter"], "withActiveAgent");

        let shown: Value = ok(server.show_projects(Parameters(ShowProjects {
            projects: vec!["rigging".into()],
        })));
        assert_eq!(shown["agentFilter"], "withActiveAgent");
        assert_eq!(shown["projectFilter"], json!(["rigging"]));

        let all: Value = ok(server.set_agent_filter(Parameters(SetAgentFilter {
            filter: AgentFilter::All,
        })));
        assert_eq!(all["agentFilter"], "all");
        assert_eq!(stored(&store).project_filter, ["rigging"]);
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

    const LAB_SESSION: &str = "reef-lab";

    fn card(id: &str, project: &str, row: Row) -> crate::tasks::Card {
        crate::tasks::Card {
            id: id.into(),
            title: format!("Task {id}"),
            state: "open".into(),
            kind: "ship".into(),
            project: project.into(),
            row,
            hold_kind: String::new(),
            hold_until: String::new(),
            hold_reason: String::new(),
            blocked_by: vec![],
            links: vec![],
            closed: String::new(),
            number: None,
        }
    }

    struct FirstmateBoard {
        _dir: tempfile::TempDir,
        server: Fathom,
    }

    fn firstmate_board(host: Host) -> FirstmateBoard {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path().join("home");
        let state = home.join("state");
        std::fs::create_dir_all(&state).unwrap();
        for (task, terminal) in [("atl-1", "t1"), ("atl-2", "t2")] {
            std::fs::write(
                state.join(format!("{task}.meta")),
                format!("backend=hc\nhc_session={LAB_SESSION}\nhc_terminal={terminal}\n"),
            )
            .unwrap();
        }
        let db = Db::open_file(&dir.path().join("board.sqlite")).unwrap();
        db.set_setting("home", &home.display().to_string()).unwrap();
        db.set_setting("hcSession", LAB_SESSION).unwrap();
        db.save_snapshot(&crate::db::Snapshot {
            taken_at_ms: 1,
            home: home.display().to_string(),
            cards: vec![
                card("atl-1", "reef-map", Row::Shallows),
                card("atl-2", "dry-dock", Row::Seabed),
                card("atl-3", "rigging", Row::Seabed),
            ],
        })
        .unwrap();
        FirstmateBoard {
            _dir: dir,
            server: Fathom::helper(db, host),
        }
    }

    #[test]
    fn list_tasks_reads_the_tasks_a_firstmate_board_shows() {
        let board = firstmate_board(no_host());
        let all = list(&board.server, None, None);
        let names: Vec<&str> = all.iter().map(|t| t["name"].as_str().unwrap()).collect();
        assert_eq!(names, ["atl-1", "atl-2", "atl-3"]);
        let numbers: Vec<i64> = all.iter().map(number_of).collect();
        assert_eq!(numbers, [1, 2, 3]);
        assert!(all.iter().all(|t| t.get("id").is_none()));
        let reef = list(&board.server, Some("reef-map"), None);
        assert_eq!(reef.len(), 1);
        assert_eq!(reef[0]["title"], "Task atl-1");
        assert_eq!(list(&board.server, None, Some(Row::Seabed)).len(), 2);
    }

    fn focus(server: &Fathom, tasks: &[TaskKey]) -> Result<String, String> {
        server.focus_tasks(Parameters(FocusTasks {
            tasks: tasks.to_vec(),
        }))
    }

    fn text(task: &str) -> TaskKey {
        TaskKey::Text(task.into())
    }

    #[test]
    fn focus_tasks_takes_numbers_and_names_and_returns_the_unknown_ones() {
        let board = firstmate_board(no_host());
        let server = &board.server;
        let _: Value = ok(server.get_board_layout());
        let _: Value = ok(server.show_projects(Parameters(ShowProjects {
            projects: vec!["rigging".into()],
        })));
        let _: Value = ok(server.set_agent_filter(Parameters(SetAgentFilter {
            filter: AgentFilter::WithAgent,
        })));

        let focused: Value = ok(focus(
            server,
            &[
                text("#2"),
                text("atl-3"),
                text("ghost-task"),
                TaskKey::Number(99),
                text("#x"),
                text("ATL-3"),
                TaskKey::Number(2),
            ],
        ));
        let shown: Vec<(i64, &str)> = focused["focus"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| (number_of(t), t["name"].as_str().unwrap()))
            .collect();
        assert_eq!(shown, [(2, "atl-2"), (3, "atl-3")]);
        assert_eq!(focused["focus"][0]["columnName"], "dry-dock");
        assert_eq!(focused["unknown"], json!(["ghost-task", "99", "#x"]));

        let layout: Value = ok(server.get_board_layout());
        assert_eq!(layout["focus"], json!([2, 3]));
        assert_eq!(layout["projectFilter"], json!([]));
        assert_eq!(layout["agentFilter"], "all");
        let settings: Value = ok(server.get_settings());
        assert_eq!(settings["focus"], json!([2, 3]));

        let cleared: Value = ok(server.clear_focus());
        assert_eq!(cleared["focus"], json!([]));
        let layout: Value = ok(server.get_board_layout());
        assert_eq!(layout["focus"], json!([]));
    }

    #[test]
    fn focus_tasks_keeps_the_focus_when_nothing_matches() {
        let board = firstmate_board(no_host());
        let server = &board.server;
        let _: Value = ok(focus(server, &[text("atl-1")]));
        assert_eq!(
            focus(server, &[text("ghost-task"), TaskKey::Number(42)]),
            Err("none of these tasks is on the board: ghost-task, 42".into())
        );
        assert_eq!(
            focus(server, &[text("  ")]),
            Err("name at least one task to focus on".into())
        );
        assert_eq!(
            focus(server, &[]),
            Err("name at least one task to focus on".into())
        );
        let layout: Value = ok(server.get_board_layout());
        assert_eq!(layout["focus"], json!([1]));
    }

    #[test]
    fn focus_on_the_own_backlog_goes_by_number_only() {
        let (_dir, store, server, _) = helper_board();
        let tasks = list(&server, None, None);
        let reef = number_of(&tasks[0]);
        let hull = number_of(&tasks[1]);
        assert!(tasks.iter().all(|t| t.get("name").is_none()));
        let focused: Value = ok(focus(
            &server,
            &[TaskKey::Number(reef), text(&format!("#{hull}")), text("1")],
        ));
        assert_eq!(focused["focus"][0]["title"], "Chart the reef");
        assert_eq!(focused["focus"][1]["title"], "Paint the hull");
        assert_eq!(focused["unknown"], json!(["1"]));
        assert_eq!(stored(&store).focus, [reef, hull]);
    }

    fn lab_terminal(address: &str, status: &str, labels: &[(&str, &str)]) -> Terminal {
        Terminal {
            address: address.into(),
            state: LIVE.into(),
            status: status.into(),
            labels: labels
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
            ..Terminal::default()
        }
    }

    fn agents_by_task(server: &Fathom) -> Vec<(String, String, String)> {
        list(server, None, None)
            .iter()
            .map(|t| {
                let id = match &t["name"] {
                    Value::String(name) => name.clone(),
                    _ => format!("#{}", number_of(t)),
                };
                let column = t["columnName"].as_str().unwrap().to_string();
                (id, column, t["agent"].as_str().unwrap().to_string())
            })
            .collect()
    }

    fn agent_counts(server: &Fathom) -> Vec<(String, u64, u64, u64)> {
        let layout: Value = ok(server.get_board_layout());
        layout["columns"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| {
                let count = |key: &str| c[key].as_u64().unwrap();
                (
                    c["project"].as_str().unwrap().to_string(),
                    count("tasks"),
                    count("tasksWithAgent"),
                    count("tasksWithActiveAgent"),
                )
            })
            .collect()
    }

    fn visible_after_showing_columns_with(server: &Fathom, count: &str) -> Vec<String> {
        let layout: Value = ok(server.get_board_layout());
        let projects: Vec<String> = layout["columns"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|c| c[count].as_u64().unwrap() > 0)
            .map(|c| c["project"].as_str().unwrap().to_string())
            .collect();
        let shown: Value = ok(server.show_projects(Parameters(ShowProjects { projects })));
        visible(server, &shown)
    }

    fn visible(server: &Fathom, settings: &Value) -> Vec<String> {
        let filter: Vec<String> =
            serde_json::from_value(settings["projectFilter"].clone()).unwrap();
        let layout: Value = ok(server.get_board_layout());
        let mut shown: Vec<String> = layout["columns"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|c| c["project"].as_str().map(String::from))
            .filter(|p| filter.is_empty() || filter.contains(p))
            .collect();
        shown.sort();
        shown
    }

    fn strings_of(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    fn assert_three_agent_states(server: &Fathom, working: &str, idle: &str, free: &str) {
        let row = |id: &str, column: &str, agent: &str| (id.into(), column.into(), agent.into());
        assert_eq!(
            agents_by_task(server),
            [
                row(working, "reef-map", "active"),
                row(idle, "dry-dock", "inactive"),
                row(free, "rigging", "none"),
            ]
        );
        let mut counts = agent_counts(server);
        counts.sort();
        assert_eq!(
            counts,
            [
                ("dry-dock".into(), 1, 1, 0),
                ("reef-map".into(), 1, 1, 1),
                ("rigging".into(), 1, 0, 0),
            ]
        );

        assert_eq!(
            visible_after_showing_columns_with(server, "tasksWithActiveAgent"),
            strings_of(&["reef-map"])
        );
        assert_eq!(
            visible_after_showing_columns_with(server, "tasksWithAgent"),
            strings_of(&["dry-dock", "reef-map"])
        );
        let all: Value = ok(server.show_all_projects());
        assert_eq!(
            visible(server, &all),
            strings_of(&["dry-dock", "reef-map", "rigging"])
        );
    }

    #[test]
    fn bosun_sees_no_agent_an_inactive_agent_and_an_active_agent_on_a_firstmate_board() {
        let board = firstmate_board(listing_host(Ok(vec![
            lab_terminal("t1", "working", &[]),
            lab_terminal("t2", "idle", &[]),
            lab_terminal("t3", "working", &[("fathom.task", "3")]),
        ])));
        assert_three_agent_states(&board.server, "atl-1", "atl-2", "atl-3");
    }

    #[test]
    fn bosun_sees_the_same_agent_states_on_fathoms_own_backlog() {
        let lab = WorkerLab::new();
        let working = lab.task("Chart the reef", Some(Row::Shallows));
        let blocked = number_of(&add(&lab.server, "Paint the hull", "dry-dock", None));
        let free = number_of(&add(&lab.server, "Trim the sails", "rigging", None));
        let label = |number: i64| lab.id(number).to_string();
        lab.list(json!([
            {"address": "t1", "state": "live", "status": "working", "labels": {"fathom.task": label(working)}},
            {"address": "t2", "state": "live", "status": "blocked", "labels": {"fathom.task": label(blocked)}},
            {"address": "t3", "state": "finished", "status": "working", "labels": {"fathom.task": label(free)}},
        ]));
        assert_three_agent_states(
            &lab.server,
            &format!("#{working}"),
            &format!("#{blocked}"),
            &format!("#{free}"),
        );
        assert_eq!(list(&lab.server, None, None)[0]["detail"], "");
    }

    #[test]
    fn unreadable_terminals_leave_agent_states_out_and_say_why() {
        let board = firstmate_board(listing_host(Err("hc is not running".into())));
        let layout: Value = ok(board.server.get_board_layout());
        assert_eq!(layout["agentError"], "hc is not running");
        let reef = &layout["columns"][0];
        assert_eq!(reef["tasks"], 1);
        assert!(reef.get("tasksWithAgent").is_none());
        assert!(reef.get("tasksWithActiveAgent").is_none());
        let tasks = list(&board.server, None, None);
        assert_eq!(tasks.len(), 3);
        assert!(tasks.iter().all(|t| t.get("agent").is_none()));
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
                .contains("call start_worker with its number instead of using your own subagents")
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
        assert_eq!(
            serde_json::from_str::<Value>(text).unwrap()["number"],
            EARLIER_TASKS + 1
        );

        let failed = call(
            &mut lines,
            &mut write,
            json!({"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {
                "name": "move_task",
                "arguments": {"task": 99, "row": "landed"}
            }}),
        )
        .await;
        assert_eq!(failed["result"]["isError"], true);
        assert_eq!(failed["result"]["content"][0]["text"], "no task #99");

        let moved = call(
            &mut lines,
            &mut write,
            json!({"jsonrpc": "2.0", "id": 5, "method": "tools/call", "params": {
                "name": "move_task",
                "arguments": {"task": format!("#{}", EARLIER_TASKS + 1), "row": "landed"}
            }}),
        )
        .await;
        let text = moved["result"]["content"][0]["text"].as_str().unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(text).unwrap()["row"],
            "landed"
        );

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
        assert!(instructions.contains("\"with an active agent\" means active only"));
        assert!(instructions.contains("\"with an agent\" means inactive or active"));
        assert!(instructions.contains("collapse every other row and expand the asked ones"));
        assert!(instructions.contains("expand every row with set_row_view"));
        assert!(instructions.contains("use set_agent_filter"));
        assert!(instructions.contains("focus_tasks shows only the given tasks"));
        assert!(instructions.contains("call clear_focus"));
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
        let folded = call(
            &mut lines,
            &mut write,
            json!({"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {
                "name": "set_row_view",
                "arguments": {"rows": ["deep", "landed"], "collapsed": true}
            }}),
        )
        .await;
        assert_eq!(folded["result"]["isError"], false);
        let collapsed: Vec<Row> = Db::open_file(&store)
            .unwrap()
            .rows()
            .unwrap()
            .into_iter()
            .filter(|r| r.collapsed)
            .map(|r| r.row)
            .collect();
        assert_eq!(collapsed, [Row::Deep, Row::Landed]);
        let filtered = call(
            &mut lines,
            &mut write,
            json!({"jsonrpc": "2.0", "id": 5, "method": "tools/call", "params": {
                "name": "set_agent_filter",
                "arguments": {"filter": "withAgent"}
            }}),
        )
        .await;
        assert_eq!(filtered["result"]["isError"], false);
        assert_eq!(stored(&store).agent_filter, AgentFilter::WithAgent);
        let first = EARLIER_TASKS + 1;
        let focused = call(
            &mut lines,
            &mut write,
            json!({"jsonrpc": "2.0", "id": 6, "method": "tools/call", "params": {
                "name": "focus_tasks",
                "arguments": {"tasks": [first, format!("#{}", first + 2), "reef-chart"]}
            }}),
        )
        .await;
        let text = focused["result"]["content"][0]["text"].as_str().unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(text).unwrap()["unknown"],
            json!(["reef-chart"])
        );
        assert_eq!(stored(&store).focus, [first, first + 2]);
        assert_eq!(stored(&store).agent_filter, AgentFilter::All);
        drop(write);
        drop(lines);
        running.await.unwrap();
    }
}
