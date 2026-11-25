# Fathom for agents

This document is for a coding agent that has been pointed at this repository by someone who wants to fork Fathom or build on it.
Read it top to bottom once, then use it as a map while you read the code.
It lists every capability, where it lives, the data it reads and writes, and above all the behaviors, invariants and design decisions that the code alone does not explain.

For the user-facing tour, see [What Fathom does](features.md).
For step-by-step usage, the [README](../README.md) is the reference; this document links to it rather than repeating every detail.
For themes, [docs/themes.md](themes.md) is the contract and is shipped inside the app.

Paths below are relative to the repository root.

## 1. The mental model

Fathom is a Tauri 2 desktop app for macOS and Linux: a Rust backend in `src-tauri/` and a React 19 UI in `src/`.
It is a board over an agent's task list, not a task manager of its own.

- **It shows one task source at a time.**
  With a Firstmate home set in Settings, it reads Firstmate's task list through Firstmate's own scripts.
  With the home empty, it reads its own backlog from its SQLite database, which agents fill through Fathom's MCP server.
- **It stores only the user's layer.**
  Fathom's database holds the arrangement (columns, card places, row names), what the user has read, settings, stable task numbers, board requests, a disposable snapshot and, on the backlog, the backlog tasks themselves.
  It never writes task data into Firstmate.
- **It hosts terminals, it does not run them.**
  Every terminal (the chat agent, workers, the Bosun helper, shells) runs inside herdr-core, an external terminal multiplexer daemon.
  Fathom attaches to those terminals, so agents keep running when Fathom quits.
- **It is agent-agnostic.**
  There is no Claude- or Codex-specific logic in the board.
  Working or idle comes from herdr-core's terminal status, and agents integrate through MCP and terminal labels.

```text
            +-----------------------------  Fathom app (one binary)  -----------------------------+
            |  React UI (src/)  <-- Tauri commands + events + byte channels -->  Rust (src-tauri/) |
            +--------------------------------------------|------------------------------------------+
                 |                    |                  |                  |                 |
        SQLite fathom.sqlite   Firstmate home      herdr-core (hc)       gh CLI         theme folders
        (user layer, backlog)  (scripts, files)    (terminals, events)   (PR status)    (~/.config/fathom/themes)
                 ^
                 |  same file, separate process
        fathom --mcp  (stdio MCP server used by agents and by Bosun)
```

## 2. Repository map

| Path | What it is |
| --- | --- |
| `src-tauri/src/lib.rs` | Entry point: dispatches the headless modes, registers every Tauri command, the `fathom-theme` scheme and the plugins. |
| `src-tauri/src/state.rs` | `AppState`: owns the database, watchers, herdr-core client, refresh debouncing and every event sent to the UI. |
| `src-tauri/src/commands.rs` | Thin Tauri command wrappers over `AppState`. |
| `src-tauri/src/source.rs` | The task source seam: `Source::Firstmate { home }` or `Source::Backlog`, plus wording that differs between them. |
| `src-tauri/src/tasks.rs`, `toon.rs` | Reads Firstmate tasks through `bin/fm-tasks-axi.sh` and parses its TOON output; maps task state to rows. |
| `src-tauri/src/moves.rs`, `requests.rs` | Card placement and board requests; sends Firstmate move notes through `bin/fm-inbox.sh` and reconciles replies. |
| `src-tauri/src/db.rs`, `db/*.rs` | SQLite store and migrations; `db/backlog.rs` (backlog tasks and requests), `db/numbers.rs` (task numbers), `db/updates.rs` (read marks), `db/shells.rs` (shell tabs). |
| `src-tauri/src/settings.rs` | Every stored setting, its key, default and validation, including fonts and shortcuts. |
| `src-tauri/src/control.rs` | Board operations shared by the window and the MCP server: layout, task views, filters, focus, column and row changes. |
| `src-tauri/src/mcp.rs` | The stdio MCP server (`--mcp`, `--mcp --helper`) built on `rmcp`, its tools and its instructions. |
| `src-tauri/src/herdr.rs` | Every herdr-core call (`ls`, `get`, `events`, `attach`, `send`, `run`) and the pty attach. |
| `src-tauri/src/launch.rs` | Starts agents, workers, Bosun and shells in herdr-core, with labels, the login-shell wrapper and MCP config. |
| `src-tauri/src/workers.rs` | Finds which terminal works on which task and whether it is working or idle; reads Firstmate status logs. |
| `src-tauri/src/shell_tabs.rs` | Shell tabs, the launcher's folder list, and attaching terminals Fathom did not start. |
| `src-tauri/src/context.rs` | Card detail context: status log, recorded PR, task folder, mentioned files, previews and screenshots. |
| `src-tauri/src/pulls.rs` | Live pull request state, checks and reviews through `gh`, with a cache. |
| `src-tauri/src/waits.rs` | Reads Firstmate's `data/waits.json`. |
| `src-tauri/src/updates.rs` | Unread-update marks for both sources. |
| `src-tauri/src/watch.rs` | File watchers on the Firstmate home. |
| `src-tauri/src/snapshot.rs`, `export.rs` | The launch snapshot, and the JSON and CSV export. |
| `src-tauri/src/shell_path.rs` | Reads the login shell's PATH once and finds programs on it. |
| `src-tauri/src/fonts.rs` | Lists installed font families (CoreText on macOS, fontconfig on Linux). |
| `src-tauri/src/themes/` | Theme store, manifest and CSS validation (`mod.rs`), the Nautical token export (`nautical.rs`), and the asset scheme (`scheme.rs`). |
| `src-tauri/src/theme_check.rs`, `theme_watch.rs` | The `fathom theme check` and `fathom theme shot` commands, and the watcher that re-checks changed themes. |
| `src-tauri/migrations/` | Numbered SQL migrations, applied in order and tracked in SQLite's `user_version`. |
| `src/App.tsx` | The window: board, chat, card detail, Bosun drawer, overlays, Settings, filters and panel sizing. |
| `src/api.ts` | Typed wrappers over every Tauri command and event; the TypeScript side of the data model. |
| `src/components/` | UI components: `Board`, `CardDetail` and its `Detail*` tabs, `ChatPanel`, `TabStrip`, `TerminalLauncher`, `WorkerTerminal`, `BosunDrawer`, `SettingsDialog`, `ShotViewer` and others. |
| `src/*.ts` | Pure logic with tests beside it: `board.ts`, `links.ts`, `result.ts`, `waits.ts`, `shortcuts.ts`, `ticketSearch.ts`, `windowSettings.ts`, `terminalInput.ts`, `updates.ts` and more. |
| `src/themes/` | Applying a theme in the window: manifest types, the look, the reset shortcut. |
| `src/themeCheck/` | The in-webview harness the theme check drives: control scan, pixel and contrast checks, scripted interactions. |
| `src/preview/` | The invented fixture board and mocked backend used by `pnpm preview:ui` and by the theme check. |
| `fixtures/themes/` | Fixture themes: five that must pass and four hostile ones that must fail. |
| `index.html`, `preview.html`, `themecheck.html`, `themecheck-app.html` | Vite entry points: the app, the browser preview, the check harness and the check's fixture app. |
| `scripts/` | `release.sh`, `check-fixture-themes.sh`, `check-linux-packages.sh` and the link-preview image renderer. |
| `site/` | The public landing page, deployed separately; not part of the app. |
| `docs/` | Setup guides, the theme guide, and these feature lists. |

## 3. One binary, several modes

`src-tauri/src/lib.rs` decides the mode from the arguments before any window exists.

| Invocation | What it does |
| --- | --- |
| `fathom` | Opens the window. |
| `fathom --default-theme` | Opens the window after switching the stored theme back to Nautical. |
| `fathom --mcp [--db <file>]` | Serves the task MCP server on stdio, with no window. |
| `fathom --mcp --helper [--db <file>]` | Serves the helper MCP server (task tools plus app-control and theme tools). |
| `fathom --helper-asking yes\|no [--db <file>]` | Records whether Bosun's Claude Code is waiting on a permission prompt; called by Bosun's hooks. |
| `fathom --export <dir>` | Writes a `fathom-export-<ms>/` folder with `fathom.json` and one CSV per table. |
| `fathom theme check <folder> [--json]` | Runs the theme check; exits 0 on pass, 1 with problems, 2 on usage or setup errors. |
| `fathom theme shot <folder> [--mode light\|dark] [--size desktop\|min] [--json]` | Renders the fixture board with the theme and writes PNGs to `<folder>/.shots/`. |

For `--mcp`, `--helper-asking` and `theme check` or `theme shot`, the database path is `--db`, else the `FATHOM_DB` environment variable, else the app's own database; the flag wins.
`--export` ignores both and always reads the app's own database.
A binary built with plain `cargo build` carries the release app id, so use `--db` when experimenting so you never touch real data.
The dev build (`pnpm dev`) uses the app id `app.fathom.board.dev` and so a separate database.

There is no Windows support: the data folder resolver returns nothing on other systems, and packaging targets only macOS and Linux.

## 4. Task sources

### The seam

`source::Source::of(home)` returns `Backlog` for an empty home and `Firstmate { home }` otherwise.
On a fresh install the home defaults to `~/Documents/firstmate` only when `bin/fm-tasks-axi.sh` exists there.
A stored terminal label equal to either built-in default is treated as unset, so switching sources picks the right default label.

To add another task source, this seam is where it goes.
Task numbers and unread marks are keyed by a source "home" string (the Firstmate home path, or the empty string for the backlog), so a new source needs its own key.

### Firstmate

- Tasks are read only with `<home>/bin/fm-tasks-axi.sh list --fields hold_kind,hold_until,hold_reason,blocked_by,links,priority,closed` and `show <id> --full`.
  Fathom never parses Firstmate's task file directly, so Firstmate can change how it stores tasks without breaking reads.
  Live refresh still depends on the file name: it watches `data/backlog.md` (section 7), so a Firstmate that stops writing that file leaves the board stale until something else triggers a re-read.
- Every spawn runs with the home as the working folder, `FM_HOME` set, Firstmate override variables (`FM_DATA_OVERRIDE`, `FM_ROOT_OVERRIDE`, `FM_STATE_OVERRIDE`, `FM_WAKE_QUEUE`, `FM_WAKE_QUEUE_LOCK`, `TASKS_AXI_FILE`) cleared, and the login shell's PATH.
- A home that has the wrapper but no `data/` folder holds no tasks yet, so the board is empty rather than an error, and Fathom watches the home until `data/` appears.
- Rows come from state and hold (`tasks::row_for`): `done` is Landed; hold kind `parked` is Deep; hold kind `captain` is Surface without a date and Deep with one, even a past one; `in_flight` is Shallows; anything else is Seabed.
  A finished task of kind `scout` lands with a "Reported" tag.
- The column for a task is its project; columns are seeded the first time a project appears.
- Fathom writes nothing in the home.
  Its only outgoing message is a move request through `bin/fm-inbox.sh note`.
- The crewmate on a task comes from `<home>/state/<task id>.meta` (see section 9), and its progress from `<home>/state/<task id>.status`.
- Waits on other people come from `<home>/data/waits.json` (see section 12).

### Fathom's own backlog

- Stored in the `backlog_tasks` table: generated integer id, title, detail, project, row, created and updated times, and `reported_ms`, the last time an agent reported on it.
- A card's id is the backlog id as a string; the user never sees it, only the task number.
- There is no form in the UI for adding tasks.
  The backlog is filled and kept current by an agent through the MCP server, on purpose: the agent owns the task list, the user steers it.

## 5. The board model

- **Rows** are five fixed keys: `surface`, `shallows`, `deep`, `seabed`, `landed`, shown in that order.
  Their names are a setting (`row_names` table), but every interface that crosses a process boundary (MCP tools, move notes, theme `data-kind` attributes) uses the fixed keys, so renaming never breaks an agent.
  The meanings are: surface needs the user, shallows is in progress, deep is parked or waiting, seabed is queued, landed is done.
- **Columns** have a generated numeric id, an optional project, a name, a position, a width (180 to 640, default 240), a collapsed flag and a deleted flag.
  An added column has no project, so it can never clash with a project name.
- **Card places** store a card's position within its cell and the column the user put it in.
  Moving a card within its row or to another column changes only this table.
- **Task numbers** (`task_numbers`, keyed by source home and card id) give every task a short `#N` across every source.
  The table uses `AUTOINCREMENT`, so a number stays retired even if its row is deleted.
  Existing backlog tasks were numbered in creation order by the migration; Firstmate tasks are numbered the first time Fathom reads them, in list order.
  Numbers are never written into Firstmate.
- **The snapshot** is the last board read, one row in the `snapshot` table, painted at launch before the fresh read finishes.
  It is disposable and never written back anywhere.
- **Collapsed rows**, **row names**, **column folders** (a folder chosen for a backlog column's shell tabs) and **shell tabs** each have their own table.

### Column rules worth knowing

- Deleting an added column removes it.
  Deleting a project column sets its deleted flag so it stays gone on later reads; there is no restore button.
  It comes back only when a new task of that project has no other column to show in.
- Deleting a column that holds cards first moves them to another column or a newly named one, at the end of each row, in one transaction.
  If a card arrives while the confirmation is open, it moves too; if the column looked empty when the dialog opened, a late card stops the delete and the dialog asks where it goes.
- Renaming a project column to an empty name returns it to the project's name; an added column keeps its current name instead.
- Columns added later, by the user or for a new project, always go at the right end.

## 6. The database

- File: `fathom.sqlite` in the app data folder (`~/Library/Application Support/<app id>/` on macOS, `$XDG_DATA_HOME/<app id>/` or `~/.local/share/<app id>/` on Linux).
  The README lists every path, including the launch log.
- Opened in WAL mode with a 5 second busy timeout, because the window and any number of MCP server processes write to it at once.
- Migrations in `src-tauri/migrations/` are listed in `MIGRATIONS` in `src-tauri/src/db.rs`; the applied count is SQLite's `user_version`.
- **Migrations only add, from `0004` on.**
  That is what makes rollback safe: any build that includes `0003` still reads a newer database, so the README's rollback is simply "open the previous version".
  The one exception is `0003_column_ids.sql`, which rebuilt `columns` and `card_places` to key places by column id, so builds from before it cannot read a newer database.
  Keep the add-only property when you add a migration.
- Tables: `columns`, `row_names`, `collapsed_rows`, `settings` (key and JSON value), `snapshot`, `card_places`, `move_requests`, `backlog_tasks`, `shell_tabs`, `column_folders`, `seen_updates`, `update_baselines`, `task_numbers`.
- Settings keys live in `src-tauri/src/settings.rs`: the connection (`home`, `terminalLabel`, `hcSession`, `hcSocket`, `agentFolder`, `chatAgent`), appearance (`themeId`, `theme` for light or dark, fonts, sizes, added fonts), window state (`chatOpen`, `chatWidth`, `detailWidth`), filters (`projectFilter`, `agentFilter`, `focus`, `focusRestore`), Bosun (`helperStarted`, `helperAsking`), `shortcuts` and ticket links (`linearWorkspace`, `ticketPrefixes`).
  Adding a setting needs no migration.
- The selected card and the crewmate view being watched are deliberately not stored: they are navigation, not preferences.
- The design target is a database that stays small (a few MB after a year of use), and Settings shows its size and path.

## 7. Freshness: watchers, events and one poll

Fathom does not poll Firstmate.
Freshness comes from change signals, each feeding one debounced re-read (250 ms) in `state.rs`.

- File watchers (`watch.rs`) on `data/` (only `backlog.md`, the task list file, and `waits.json`) and on `state/` recursively (`.meta`, `.status` and the inbox reply folder).
  When `data/` does not exist yet, a non-recursive watch on the home waits for it to appear and then arms the `data/` watch.
- herdr-core's event stream (`hc events --json`), restarted after a 2 second delay if it drops.
  Activity events (`created`, `finished`, `removed`, `restarted`, `status`, `turn`) re-read the board; those plus `labels` and `lost` re-read the workers, debounced at 80 ms.
- One poll: `PRAGMA data_version` every 250 ms.
  It changes only when another connection commits, so it is cheap, and it is how the window sees writes from MCP server processes.
  It exists because macOS sends no file events for writes to an open WAL database.
  The same check re-reads settings, which is how Bosun's changes appear in the window within a moment.

Events to the UI (constants in `state.rs` and `theme_watch.rs`): `board://updated`, `herdr://status`, `herdr://terminals`, `workers://updated`, `terminal://ended`, `settings://updated`, `helper://updated`, `updates://updated`, `themes://updated`.

### Launch speed

At launch the UI calls `cached_board` and paints the snapshot, then calls `read_board`.
Every launch appends one line to `launch.log` with the time to a populated board, whether it came from the cache, and the card count.
The goal is under 0.5 s on a warm start; keep the cached path cheap if you change startup.

## 8. Board requests: how a drag asks for a move

A drag never moves a task by itself.
The task list belongs to the agent, so a change of row becomes a request that the agent answers.

- Every drop saves the arrangement at once (optimistic in the UI, then `place_card`).
- Only a change of row creates a request, stored in `move_requests` with status `sending`, then `asked`.
- **Firstmate:** Fathom runs `bin/fm-inbox.sh note --request-id fathom-move-<task id>-<ms>` with the one-line body `Fathom board request: move <task id> "<card title>" from <row> to <row>`.
  The request id makes a resend idempotent on Firstmate's side.
  Replies are read with `bin/fm-inbox.sh receipts --all-replies` on each re-read and matched by the note id Fathom stored.
  The request ends `landed` when the task's own row matches, `answered` when Firstmate replied instead (the card returns to its real row and shows the reply), or `failed` when the note could not be saved (the card shows "not sent" with "Send again" and "Cancel").
- **Backlog:** the request waits in the same table.
  If a chat terminal is attached, Fathom sends it one line such as `1 board request waiting` with herdr-core's `send`, counting every waiting request; otherwise the request waits for the agent's next `list_requests`.
  The agent accepts by moving the task (`move_task` or `answer_request`), or declines with a reason that the card then shows.
- A new request for a card supersedes any open one for the same card (`superseded`), so only the latest drop counts.
  On the backlog, a drop back into the task's own row is recorded as already satisfied (`landed`), so the card settles and no nudge goes out.
- Dismissing an answer in the card panel sets `dismissed`.
- Row keys in requests are always the fixed keys, whatever the rows are called.

The card waits in the target row marked "asked" so the user sees their intent immediately, while the truth stays with the agent.

## 9. herdr-core integration

All herdr-core calls live in `src-tauri/src/herdr.rs`, so a herdr-core change touches one place.
Fathom talks only to herdr-core, never to the Herdr desktop app.

- The program is `herdr-core`, else `hc`, found on the login shell's PATH (another tool may own the name `hc`).
- Session and socket come from Settings as `HC_SESSION` and `HC_SOCKET`; ambient `HC_*` variables are removed so Fathom never accidentally targets the terminal it was started from.
- Attaching runs `hc attach` inside a pty with `TERM=xterm-256color` and streams raw bytes plus JSON size frames to the UI over a Tauri channel.
- A view is a slot that holds at most one attach: `chat`, `worker` (the crewmate overlay), `agent` (the card's Agent tab), `helper` (Bosun) and `shell:<terminal>` (each shell tab).
  The Agent tab has its own view so opening or closing the crewmate overlay never detaches it.
- On exit Fathom detaches everything and stops the event stream; the terminals keep running.

### Two clients on one terminal

The Herdr app and Fathom can attach to the same terminal.
herdr-core resizes a terminal to the last interactive client that attached, resized or typed, and sends the same bytes to every client with no size marker.
Fathom sizes the terminal to its panel on attach, on panel resize and on chat font change, and a key press or paste takes the size back.
When another client takes the size, Fathom attaches again at herdr-core's current size before dropping the old attach, then switches the panel to the new size before drawing the fresh repaint, so the screen is never laid out at the wrong size.
The README section "Two clients on one terminal" records the measured herdr-core behavior this relies on.

### Terminal labels

| Label | Meaning |
| --- | --- |
| `fathom.role=chat` | A chat terminal Fathom opened. |
| `fathom.agent=claude\|codex\|firstmate` | Which agent a chat or worker terminal runs. |
| `fathom.role=worker` with `fathom.task=<backlog id>` | A worker Fathom started on a backlog task. |
| `fathom.role=helper` | Bosun. |
| `fathom.role=shell` with `fathom.folder=<folder>` | A shell tab. |
| `firstmate.role=primary` | Firstmate's own terminal, the default chat label on a Firstmate board. |

Fathom finds every terminal it cares about by label, which is how it reattaches after a restart without storing terminal ids for the chat or Bosun.

## 10. Launching agents, workers, Bosun and shells

`src-tauri/src/launch.rs` owns every launch.

- Launches use herdr-core's `run --bg --json --no-parent --cwd <folder>` with the labels above.
- **Programs are resolved on the login shell's PATH and passed by full path**, because herdr-core runs programs in its own environment, not Fathom's.
- **Every agent starts through the user's login interactive shell**: `<shell> -l -i -c 'exec "$0" "$@"' <program> <args>`.
  That gives the agent and its hooks the same environment as a terminal the user opens, including PATH entries that rc files add (version managers for Node, for example).
  Arguments pass as positional parameters, never through a shell string, so paths with spaces arrive unchanged.
  fish gets `exec $argv`, and an unknown shell falls back to `/bin/sh`.
  A side effect: herdr-core lists these terminals under the shell's name.
- The login shell's PATH is read once at startup (`shell_path.rs`), because an app opened from Finder or a desktop launcher does not inherit it.

| Launch | How |
| --- | --- |
| Claude Code chat | In the agent folder, with `--mcp-config <data dir>/fathom-mcp.json`, a file pointing at Fathom's own binary with `--mcp --db <database>`. |
| Codex chat | In the agent folder, with `-c mcp_servers.fathom.command=...` and `-c mcp_servers.fathom.args=[...]` for that run only. |
| Firstmate chat | Plain `claude` in the Firstmate home, with no Fathom MCP server. |
| Worker (`start_worker`) | Claude Code in the given folder or the agent folder, with an opening prompt naming the task number, then `--mcp-config`. |
| Bosun | See section 11. |
| Shell tab | `$SHELL -l` (else the account's shell) in the chosen folder. |

**Fathom never changes Claude Code's or Codex's own configuration.**
Everything it needs is passed per launch, and registering Fathom's MCP server globally is left to the user.

A worker is refused for a missing task, a landed task, or a task that already has a live worker.
Workers exist only for backlog tasks; on a Firstmate board, Firstmate starts its own crewmates.

## 11. Bosun, the helper

Bosun is Claude Code in a herdr-core terminal labelled `fathom.role=helper`, started in a `bosun` folder beside the database, shown in a drawer under the board.

- Command line: `--model haiku`, `--mcp-config` and `--strict-mcp-config` for `fathom --mcp --helper` alone, `--allowedTools` for the fathom tools, delegation and reading the themes folder, an `--agents` definition, a `--settings` file and `--append-system-prompt` with a short helper prompt.
- The settings file puts `delete_column`, `delete_theme` and `set_connection` under Claude Code's ask-first permissions, and adds hooks: a `permission_prompt` notification runs `fathom --helper-asking yes`, and later hook events run `--helper-asking no`.
  That is how the drawer's dot turns yellow while Claude Code waits for the user.
- Theme work is delegated to a `theme-designer` subagent on Sonnet with only the theme tools and `Read`; everything else stays on Haiku for speed and cost.
- The helper prompt takes Bosun's name from the active theme's `text.helper`, from Bosun's next start.
- Fathom never types into Bosun's terminal and never reads answers from it.
  Bosun changes Fathom only through MCP tools, and the window sees the change through the `data_version` poll.
- Before starting, Fathom checks that `claude` is on the login PATH and that `claude auth status` does not report signed out, and shows install or sign-in guidance otherwise.
- After the first start, opening the drawer starts Bosun by itself.
  Bosun keeps running when Fathom quits and is found again by its label.
- Bosun's server leaves out `start_worker` on purpose: a worker is a new paid session working in a repository, and Bosun's tools run without asking.

## 12. The MCP server

`fathom --mcp` is a stdio MCP server named `fathom`, implemented with `rmcp` in `src-tauri/src/mcp.rs`.
It opens no window and exits when the client closes the connection.
Read the README's "The MCP server" and "The helper tools" sections for the full tool tables; this section covers what is not obvious from them.

- **Two tool sets.**
  `--mcp` serves the task tools plus `start_worker` with instructions for agents that keep a task list.
  `--mcp --helper` serves the task tools plus the app-control and theme tools, without `start_worker`, with instructions for Bosun.
- **Task tools:** `list_tasks`, `add_task`, `update_task`, `move_task`, `list_requests`, `answer_request`, and on the plain server `start_worker`.
- **Helper tools:** `get_board_layout`, `get_settings`, `list_fonts`, `rename_column`, `move_column`, `set_column_view`, `add_column`, `delete_column`, `rename_row`, `set_row_view`, `show_projects`, `show_all_projects`, `set_agent_filter`, `focus_tasks`, `clear_focus`, `set_theme`, `set_fonts`, `set_panels`, `set_connection`.
- **Theme tools:** `get_theme_guide`, `list_themes`, `get_theme`, `use_theme`, `save_theme`, `delete_theme`, `shot_theme`.
- **`list_tasks` reads whichever source the board shows**, Firstmate included, and reports each task's number, its Firstmate name if any, its column and its agent state (`none`, `inactive` or `active`).
- **Only backlog tasks can be changed.**
  `update_task`, `move_task` and `start_worker` take a number (`42` or `"#42"`); a Firstmate task's number is refused with a message saying Fathom cannot change it, so the MCP server can never edit Firstmate's list.
- **Helper tools write through `control.rs`**, the same code the window's own controls use, so a tool can never leave the board in a state the UI could not produce.
- **Row keys are fixed** in every tool, whatever the rows are called.
- **The server instructions are part of the product.**
  They tell an agent to keep its task list in Fathom, to answer board requests when it sees the nudge line, to use `start_worker` instead of its own subagents for work the user should see, and, as a worker, to keep its task current: shallows when it starts, progress in the detail, surface with a question, landed when done.
  Changing them changes how agents behave on the board.
- **Agent states.**
  An agent counts as `active` only while herdr-core reports its terminal as working; idle or waiting for a permission answer counts as `inactive`.
  The agent filter and the sailor use the same signal, so they never disagree.

## 13. Crewmates and workers on cards

- **Firstmate boards** bind a task to a terminal through `<home>/state/<task id>.meta`.
  Only records with `backend=hc` and exactly one `hc_session` and `hc_terminal` count, and the sailor shows only when that session is the one set in Settings and herdr-core lists the terminal as live.
- **Backlog boards** bind through the `fathom.task=<id>` label; Firstmate boards ignore that label.
- The sailor's visor glows and blinks while the terminal's status is `working` and dims otherwise; reduced motion turns the blink into a steady glow.
- Clicking the sailor opens the terminal in an overlay attached like the chat; Escape closes the overlay rather than reaching the terminal, and closing only detaches.
- The card's Agent tab exists only while the card has a live worker; it shows the worker's terminal and a composer whose "To" switch sends either to the worker (text as typed) or to the chat agent (prefixed with the card).
- Wording differs by source: "crewmate" on Firstmate boards, "worker" on the backlog.

## 14. Card details

The detail panel (`src/components/CardDetail.tsx`) has Overview, Links, Files and Activity tabs, plus Agent while a worker is on the card, and a message box at the bottom.
The message box sends `<card title> (<task id>): <text>` to the chat terminal with `hc send`, which pastes the text and presses Enter.

- **Overview** starts with a Result section (`src/result.ts`) when the task left something to show: a headline labelled Result, Answer, Verdict, Recommendation, Your call, or Watch for watch tasks, then screenshots, pull requests, up to three points from the report's lead section, a decision decoded into lettered options, or the latest status line for watch tasks.
  Picking options prefills the message box; nothing is sent without the user.
  Overview also shows the waits, the hold or move request, the note rendered as Markdown, key links and facts.
- **Screenshots** come from the task folder (`<home>/data/<task id>/`), `~/Documents/screenshots/<task id>/` and task-id-prefixed files in `~/Documents/screenshots`, and are tagged from file name tokens (before or after, a width, light or dark, and the rest as the state).
  The full-window viewer (`ShotViewer.tsx`) offers flip, slider and side-by-side compare, a states by theme matrix, and fit or 1:1.
- **Links** (`src/links.ts`) is the one link detector every tab uses: GitHub pull requests, issues, repos and commits, Linear URLs, Slack threads and channels, other web links and local paths, grouped and given readable labels, never raw URLs.
  Bare ticket ids such as `ENG-1234` become links only when Settings has a Linear workspace and ticket prefixes.
- **Pull request status** (`pulls.rs`) asks `gh` for state, checks and reviews off the UI thread, with a 60 second cache (15 seconds for unknown) and a 15 second timeout.
  Without `gh`, a network or a sign-in, it shows "Status unknown"; opening a card never waits on it.
- **Files** lists the task folder and every existing local file mentioned in the note, hold reason or status log, with previews.
- **Activity** is the status log, live and archived, newest first.
- **Preview safety:** Markdown never renders raw HTML or scripts and never loads its images, previewed images are inline data URLs within the window's content security policy, HTML files open in the default app, and text over 256 KB is truncated.
- Files, Activity and screenshots need a Firstmate home, because they come from its records; on the backlog those tabs say so.

### Waiting on others

Firstmate may write `<home>/data/waits.json` (format in the README).
Fathom reads it in one small module (`waits.rs`), never writes it, and treats a missing or malformed file as "no waits".
Odd entries are cleaned rather than rejected: an unknown kind becomes `other`, names are trimmed and deduplicated, a bad `need` means all, and a leading `@` on a login is dropped.
For a pull request review, each person's state comes live from GitHub through `gh`, matched to names by the `people` map, and falls back to the recorded state when GitHub is unreachable.
Waits change only what is shown; they never move a card.

## 15. Unread updates

- A card lights up when its agent has reported something the user has not read.
  The mark for a Firstmate task is the last line of `state/<task id>.status`; for a backlog task it is `reported_ms`, set when an agent changes the title, detail or project or moves the task.
  Adding a task does not count, and neither does a move that answers the user's own board request.
- The user's own actions in Fathom never count as an update.
- Opening a card and then closing it, or opening another card, stores its current mark in `seen_updates`.
  An update that arrives while the card is open counts as read when it closes.
- **Baseline:** the first time Fathom sees a source home, everything already reported is recorded as read (`update_baselines`), so an existing board does not light up all at once.
- Marks are kept per source home, so switching homes never mixes them.
- Collapsed columns and rows light up through their counts while they hold an unread card; a card hidden by a filter lights nothing.
- The unread color is reserved: no other bar or badge uses it, and the theme guide asks themes to keep unread cards distinct.

## 16. Filters, focus and counts

- **Project filter:** shows only the named projects' columns.
  "Add column" hides while it is on, so a new column never lands out of sight.
- **Agent filter:** `all`, `withAgent` or `withActiveAgent`, from the same signals as the sailor.
- **Focus:** shows only the named tasks and the columns that hold them.
  Focusing first shows every project and sets the agent filter to all, so every named task that exists shows; unmatched names come back under `unknown`.
  The filters from before the focus are saved under `focusRestore`, which the Settings dialog never writes.
  Clearing the focus restores them, unless the user changed a filter during the focus, in which case the explicit change wins.
  A second focus keeps the filters from before the first.
  This is what makes "show everything again" end fully open in any call order.
- **Counts:** the header counts always count every card and project, so a hidden task that needs the user still raises the count.
  Column totals and collapsed row counts follow the filters.
- **Expand all** opens every folded column and collapsed row, and switching it off folds back exactly what it opened.
- Dropping a card while filters hide some cards places it beside the shown card it was dropped next to, keeping hidden cards in place.

### Ticket search

The "Search tickets" field in the header (`src/components/TicketSearch.tsx`, logic in `src/ticketSearch.ts`) finds a task by number (with or without `#`), Firstmate name or title, ignoring case, and opens its card detail.
It deliberately searches every card on the board in board order, including cards in folded columns, collapsed rows and cards hidden by the project filter, the agent filter or a focus, because the point is to reach a task you cannot currently see.
It is purely a view over the cards already loaded and calls no backend command.
Its list is fixed-positioned so it stays inside the window, and opens upward when a theme puts the header at the bottom.

## 17. Terminals in the window

The chat, crewmate overlay, Agent tab, Bosun and shell tabs all use xterm.js through `src/liveTerminal.ts`.

- Scrollback holds 10,000 lines; an attach starts from herdr-core's repaint of the current screen, so earlier output is not in the scrollback.
- When the program asks for mouse input, the wheel goes to the program; in a full-screen program without mouse input, the wheel sends arrow keys.
- Shift+Enter sends `ESC[13;2u` while the program has kitty keyboard mode on and `ESC[27;2;13~` otherwise, matching herdr-core's own key encoder; Fathom tracks the kitty mode from the program's output (`src/terminalInput.ts`).
- Programs may write the clipboard with OSC 52, but Fathom never answers a request to read it, and the Tauri capability only grants clipboard writes.
- Dropping files on the chat types their escaped paths as a paste, without Enter; a drop anywhere else does nothing.
- On Linux, Ctrl+Shift+V and Shift+Insert paste, and Ctrl+V reaches the program.
- Shell tabs stay mounted when hidden, so each keeps its size and scrollback; closing a tab detaches and leaves the shell running, where the launcher can attach it again.
  The launcher leaves out the chat terminal, open tabs, Bosun and workers.

## 18. Keyboard shortcuts

- Configurable (Settings, "Shortcuts"): show or hide the chat, switch light and dark, open Settings.
  Defaults live in `src/shortcutDefaults.json`, which both TypeScript and Rust read.
- Fixed: Bosun (⌘J or Ctrl+J), the terminal launcher (⌘T or Ctrl+Shift+T), tab cycling (Ctrl+Tab and Ctrl+Shift+Tab) and the theme reset (Shift+⌘0 or Ctrl+Shift+0).
- Shortcuts listen in the capture phase on `window`, so they work while a terminal has focus and xterm never sees them.
- They match physical keys (`KeyboardEvent.code`), so layouts and Option-modified characters do not matter.
- A shortcut needs ⌘, ⌥ or ⌃ (Ctrl, Alt or Super on Linux); Shift alone does not count.
  Clashes with another Fathom shortcut and, on macOS, with the standard menu keys (quit, hide, copy, paste and so on) are refused rather than stolen.
- On Linux the defaults use Ctrl+Shift+letter, because terminals pass plain Ctrl+letter to programs.
- The theme reset is installed in `src/main.tsx` before the app renders and stops propagation, so no theme and no other shortcut can block it.

## 19. Window layout and panels

- The window is at least 960 by 600.
- Chat width is 300 to 1400 (default 600); side card detail width is 340 to 900 (default 460).
- `fitPanels` in `src/windowSettings.ts` keeps the board at least 560 pixels wide, or one column if a column is wider: when the window is too narrow, the chat gives way first, then the detail, each down to its minimum.
  Saved widths are kept and come back when the window grows; a drag only lowers a saved width if it made the panel narrower.
- Widening the chat by its handle takes room from the board down to that floor, then from the open card detail.
- Escape closes the card detail, unless focus is in a terminal, a dialog is open, or the key only ends an IME composition.

## 20. Themes

A theme is a folder of data: `theme.json`, `theme.css`, and art, texture and font files.
The full contract, including every part name, control id and token, is [docs/themes.md](themes.md); Fathom writes it into the themes folder as `GUIDE.md` on every start so agents editing themes directly always have the version that matches the app.

- **Where:** `~/.config/fathom/themes/<id>/`, or `$XDG_CONFIG_HOME/fathom/themes/<id>/` on Linux.
  Nautical is built in and read-only; "Duplicate Nautical" writes its tokens into a new folder as a starting point.
- **Never code.**
  The CSS is linted (no `@import`, no remote URLs, no script hooks such as `expression(` or `javascript:`), asset types are allow-listed, files are capped at 4 MB each and 16 MB in total, decorative text cannot contain markup, and font lists cannot smuggle CSS.
  The window's content security policy allows no remote loads anyway.
- **Served from a checked copy.**
  Assets reach the window through the `fathom-theme` URI scheme, which serves only the last copy that passed its check, with a restrictive policy of its own.
- **Stable selectors.**
  Components carry `data-part`, `data-kind`, `data-state` and `data-control` attributes; themes select those, never class names.
  Fathom's own styles sit in the cascade layer `app`, and `theme.css` loads unlayered after them, so theme rules win without `!important`.
  Every color is a token; `src/colorLiterals.test.ts` fails the build on a color literal outside a `:root` token declaration.
  `src/themes/guide.test.ts` fails if the guide's lists of parts, controls or tokens drift from what the app renders.
- **Layout through options, not CSS.**
  Anything that moves where the user clicks, drags or resizes (chat side, rows or lanes, header on top or as a rail, side or overlay detail, structural sizes) is a declared option in `theme.json` that Fathom implements, including drop targeting and resize directions.
  Button and control labels are never themable; only decorative text slots are.
- **The check** (`theme_check.rs` plus `src/themeCheck/`) renders the invented fixture board offscreen, in each mode the theme declares, at 1600 by 1000 and at 960 by 600.
  It compares every control with Nautical's on the same fixture: present, visible, reachable by a click at its middle, labelled, and judged from pixels as well as the DOM; text must stay readable (at least 3:1 wherever Nautical reaches it).
  It then plays interactions: dragging cards (including edge scrolling), reordering projects, resizing panels, closing the detail with Escape, raising the helper drawer, switching modes and pressing the reset shortcut.
  Nautical's baselines are cached per build.
  A check runs on a snapshot copy of the folder, and the result is cached by a hash of the folder, so an unchanged theme is not re-checked.
- **The watcher** re-checks a theme 800 ms after its folder settles, in a subprocess of Fathom's own binary.
  When a change fails, Fathom keeps showing the last version that passed and Settings shows how many problems the check found.
  A symlinked theme folder is checked under its link name; on macOS edits inside it are not seen, so it is re-checked at start or when anything else in the folder changes.
- **Privacy:** checks and screenshots only ever render the invented fixture, never the real board, so theme work never sends a real task, terminal or name to a model.
- **Escape hatches:** Shift+⌘0 or Ctrl+Shift+0, `fathom --default-theme`, and `use_theme nautical` always return to Nautical.
- The check cannot catch every abuse; the guide states the rules it cannot fully verify, such as never covering a control's label and keeping unread cards distinct.
- Fixture themes in `fixtures/themes` are the regression suite: Phosphor, Switchboard, Riso, Plain and Painted text must pass; hostile-hidden, hostile-white, hostile-cover and hostile-paint must fail.

## 21. Settings and data

The Settings dialog has sections for Firstmate (home, chat terminal label, agent folder), Ticket links, herdr-core (session and socket), Appearance (theme, fonts, sizes), Shortcuts, Row names and Your data (size, path and export), with the installed version in its footer.
Changes preview at once while it is open; Save keeps them and Cancel puts them back.

Export writes `fathom.json` plus `backlog_tasks.csv`, `card_places.csv`, `columns.csv`, `move_requests.csv`, `row_names.csv`, `settings.csv`, `snapshot_cards.csv` and `task_numbers.csv` into a new `fathom-export-<ms>` folder.
It leaves out `collapsed_rows`, `shell_tabs`, `column_folders`, `seen_updates` and `update_baselines`.
Deleting the database resets Fathom and affects nothing outside it.

## 22. Build, test and release

- `pnpm dev` runs `tauri dev` with hot reload under the dev app id.
- `pnpm preview:ui` serves the UI in a browser with the invented fixture and a mocked backend (`src/preview/`).
  URL flags reproduce states without herdr-core or Firstmate; the README lists them.
  Use it for UI work and screenshots.
- `pnpm check` runs both TypeScript projects, vitest, `cargo fmt --check`, clippy with `-D warnings` and `cargo test`.
  CI runs it on Ubuntu 24.04 for every pull request and every push to `main`, then runs `scripts/check-fixture-themes.sh` under `xvfb-run`, and builds the Linux packages on Ubuntu 22.04.
- Tests that need outside state are ignored by default: a real Firstmate home, and herdr-core "lab" tests that use a throwaway session and stub `claude` and `codex` scripts, never the real tools or the user's sessions.
  The README shows how to run them.
- `pnpm release` builds into `release/<version>/` and refuses to overwrite an existing version: an ad-hoc-signed `Fathom.app` on macOS, a `.deb` and an AppImage on Linux.
- Pushing a `v<version>` tag publishes a GitHub Release with `Fathom_universal.dmg`, `Fathom_amd64.deb` and `Fathom_amd64.AppImage`; the names carry no version so `releases/latest/download/<name>` always works.
  The workflow refuses a tag that does not match the version in `tauri.conf.json` and `package.json`, and signs and notarizes only when the Apple secrets are present.
- Pure logic lives in small `src/*.ts` modules with a `*.test.ts` beside each; components are tested by server-rendering them.
  Follow that split when you add UI behavior.

## 23. Design decisions and why

These are the choices a reader of the code would most likely second-guess.

1. **The agent's task list is the truth; Fathom stores only the user's layer.**
   Each fact lives in one place, so the board can never drift from what the agent believes, and deleting Fathom's database loses only arrangement and preferences.
2. **Read through the source's own commands, write only requests.**
   Fathom reads Firstmate's tasks through its scripts and never parses its task list or edits its files, so Firstmate can change its storage without breaking reads and its own rules decide what a move means.
   Live refresh still watches `data/backlog.md` by name.
3. **A drag is a request, not a move.**
   The agent may know why a task cannot move, so it answers; the card shows the user's intent at once as "asked".
4. **Deep is the user's.**
   A dated hold stays in Deep even after its date passes; only the user takes a card out of Deep.
   This deliberately differs from treating a passed date as live again.
5. **No polling of the task source.**
   File and herdr-core events drive every re-read; the one poll is SQLite's `data_version`, which is cheap and exists only because macOS does not report writes to an open WAL database.
6. **Terminals live in herdr-core, and the chat is the agent's real session.**
   Nothing is mirrored or re-rendered from logs; what the user types is what the agent reads, and agents survive Fathom quitting.
7. **Everything is found by label, nothing by remembered id.**
   Restarts, crashes and other clients cannot strand Fathom on a stale terminal.
8. **Agents start through the login interactive shell, by full path.**
   An app opened from the desktop and a daemon-run program both miss the user's PATH; this makes agent hooks behave exactly as in the user's own terminal.
9. **Fathom never edits agent configuration.**
   MCP servers are passed per launch, so installing or removing Fathom never changes how Claude Code or Codex behave elsewhere.
10. **Stable numbers live only in Fathom.**
    One number space across every source gives users and agents a short shared handle without asking any source to store it.
11. **Bosun is a separate agent with a separate tool set, on a small model.**
    App-control tools never reach worker agents, risky tools ask first, Bosun cannot spend usage by starting workers, and design work goes to a stronger model only when needed.
12. **Bosun is a drawer under the board**, so each change lands in view right above the line the user typed.
13. **Header counts ignore filters**, so a hidden project that needs the user still shows up in the count.
14. **Migrations only add from `0004` on**, so rolling back to any build that includes `0003` is just opening it; `0003` (column ids) is the one migration that rebuilt tables.
15. **Themes are data checked against the built-in theme**, with a reset that nothing can block, so an agent can restyle the whole app without ever making it unusable, and a failed edit never replaces a working theme.
16. **Agents only ever see an invented board** during theme work, so no real task reaches a model through it.
17. **Unread starts from a baseline**, so a new install or a new home does not light up every card.
18. **Fathom ships outside the Mac App Store**, because the App Sandbox forbids running the user's installed programs, which is Fathom's core job; [docs/mac-app-store.md](mac-app-store.md) has the analysis.

## 24. Deliberately left out

- An add-task form, or any editing of tasks in the UI: agents own task content.
- Editing Firstmate's task list, waits or files directly.
- A restore button for deleted project columns.
- Stopping or restarting workers from the board, workers on Firstmate boards, and workers for agents other than Claude Code.
- Remembering the selected card or the watched crewmate across launches.
- Accounts, cloud sync, sharing and phone access: Fathom itself has no accounts or sync, while Bosun and connected agents talk to their own model providers.
- Registering Fathom's MCP server with any agent globally; that is the user's choice.
- Themable control labels, scripts in themes, and remote theme assets.
- Windows, and the Mac App Store.

## 25. Edge cases and known limits

- A dev build and a release build pointed at the same herdr-core session both read `fathom.task=<id>` labels, and their backlog ids come from different databases, so one could show the other's worker.
- Firstmate crewmates show a sailor only when Firstmate runs them on its herdr-core backend in the same session as Fathom's settings.
- A Firstmate home without `tasks-axi` installed shows the error banner over the cached board.
- With the Herdr app owning a terminal's size, the panel may show blank space or scroll until the user types or resizes.
- The theme check takes about a minute and has a 300 second timeout; only one check runs per theme at a time.
- Screenshot and file discovery is capped (200 folder entries, 200 mentioned files, 5000 images) and image previews are capped at 12 MB.
- Team review requests and pending reviews are not shown for waits.

## 26. Where to start for common changes

- **A new MCP tool:** add it to the right `#[tool_router]` block in `src-tauri/src/mcp.rs`, put shared logic in `control.rs` so the window can use it too, update the server instructions if agents need to know when to call it, and add it to the README's tool table.
  If Bosun should ask before using it, add it to `HELPER_ASKS_FIRST` in `launch.rs`.
- **A new setting:** add its key, default and validation in `src-tauri/src/settings.rs`, its field in `src/api.ts`, and its control in `SettingsDialog.tsx`; no migration is needed.
- **A new table or column:** add a numbered file in `src-tauri/migrations/`, list it in `MIGRATIONS` in `db.rs`, keep it additive, and add it to `export.rs` if it holds user data worth taking away.
- **A new UI control:** give it a `data-control` id and its element a `data-part` name, use tokens for every color, and add the names to `docs/themes.md`, or `src/themes/guide.test.ts` fails.
  The theme check will then require every theme to keep it visible, reachable and labelled.
- **A new task source:** add a `Source` variant in `source.rs` with its own home key, implement reading cards and, if it supports them, move requests and status marks, and keep writes to the source behind explicit requests.
- **A new agent in the chat panel:** add it to `launch::Agent` and `src/agents.ts`, with how it receives Fathom's MCP server for one run only.
- **A UI state to reproduce:** add a flag to the preview fixture in `src/preview/` so it can be checked in the browser and by the theme check.
