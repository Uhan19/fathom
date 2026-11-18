# Fathom

Fathom is a macOS desktop board for an agent's tasks.
It reads Firstmate's task list when a Firstmate home is set, and otherwise keeps its own backlog that any agent fills through Fathom's MCP server.
Each task is a card, each project starts as a column, and each row shows how deep the work sits.
You can add your own columns, drag columns into the order you like, and delete ones you no longer need.
It shows the board, opens card details, and embeds an agent's live terminal as a chat panel.
When no terminal is there yet, the chat panel opens Claude Code, Codex or Firstmate for you through herdr-core.
Cards can be dragged to arrange them, and a drag to another row asks the agent to move the task.
A small sailor on a card shows that a crewmate is on the task: its red visor glows and blinks while it works and dims while idle.
Clicking the sailor opens that crewmate's live terminal.

## Requirements

- macOS, Rust (stable), Node 22 or newer, and pnpm.
- For Firstmate's tasks: Firstmate installed, with `bin/fm-tasks-axi.sh` and `bin/fm-inbox.sh` in its home.
- `hc` (herdr-core) and `tasks-axi` on your login shell's PATH.
- To open an agent from the chat panel: `claude` or `codex` on your login shell's PATH.

## Run the dev build

```sh
pnpm install
pnpm dev
```

`pnpm dev` runs `tauri dev` with hot reload under the app id `app.fathom.board.dev` and the name "Fathom Dev".
It keeps its own database, so dev runs never touch the release build's data.

`pnpm preview:ui` opens the UI in a browser with an invented fixture and mocked backend calls.
It is handy for layout work without herdr-core or Firstmate.
Add `?nolabel`, `?error` or `?empty` to the URL to see the terminal picker, a read error, or an empty board.
Add `?agent=claude`, `?agent=codex` or `?agent=firstmate` to see the chat attached to a terminal Fathom opened for that agent, and `?missing=codex` (or another tool name) with `?nolabel` to see opening fail because the tool is missing.
Add `?other=120x45` to see the chat while another client owns a 120 by 45 terminal; a key press in the panel takes the size back.
Add `?kitty` to have the mocked terminal turn on kitty keyboard mode, so Shift+Enter sends the kitty form.
Add `?backlog` to see a board of Fathom's own backlog, with one pending and one declined board request.
Add `?late` to have a card arrive in a column at the moment you confirm deleting it, or `?deletefail` to see a delete fail.

## Run the checks

```sh
pnpm check
```

This runs the TypeScript compiler, the vitest suite, `cargo fmt --check`, `cargo clippy -D warnings`, and `cargo test`.

Three Rust tests are ignored by default because they need outside state:

- `tasks::home_tests::reads_a_real_home` reads a Firstmate home copy set in `FATHOM_TEST_HOME`.
- `herdr::tests::sizes_types_and_sends_into_a_lab_terminal` attaches to a throwaway herdr-core session set in `FATHOM_LAB_SESSION` and `FATHOM_LAB_SOCKET`.
  The labeled terminal (`FATHOM_LAB_LABEL`, default `firstmate.role=primary`) must echo each line it reads as `GOT:<line>`.
  It checks the attach and panel sizes reach the terminal, types a line, sends a card message, follows a second client's size by attaching again, and takes the size back.
  Never point it at a session you use.
- `launch::tests::opens_each_agent_in_a_lab` opens Claude Code, Codex and Firstmate in the same throwaway session through the launch module.
  It starts stub `claude` and `codex` scripts from a temporary folder, never the real tools, and checks each terminal's labels, folder, command line and MCP config file, that the chat lookup finds it, and that a board-request nudge reaches it.

```sh
FATHOM_LAB_SESSION=<lab session> FATHOM_LAB_SOCKET=<lab socket> FATHOM_LAB_LABEL=<label> \
  cargo test --manifest-path src-tauri/Cargo.toml --lib -- --ignored types_and_sends
FATHOM_LAB_SESSION=<lab session> FATHOM_LAB_SOCKET=<lab socket> \
  cargo test --manifest-path src-tauri/Cargo.toml --lib -- --ignored opens_each_agent
```

## Build a release

```sh
pnpm release
```

The script reads the version from `src-tauri/tauri.conf.json` and builds `release/<version>/Fathom.app` with an ad-hoc signature.
It refuses to overwrite an existing version, so bump the version first.
It keeps the newest two versions, deletes older ones, and installs nothing.
`release/` is ignored by git.

Open the app from Finder or with `open release/<version>/Fathom.app`.
The first launch of a new build can take several seconds while macOS checks the new binary; later launches paint from the cache.

## Roll back

Quit Fathom and open the previous version from `release/`.

```sh
open release/<previous version>/Fathom.app
```

Both versions share the same database, and migrations only ever add, so an older build still reads it.

## Where the data lives

| What | Release build | Dev build |
| --- | --- | --- |
| Database | `~/Library/Application Support/app.fathom.board/fathom.sqlite` | `~/Library/Application Support/app.fathom.board.dev/fathom.sqlite` |
| Launch timing log | `~/Library/Logs/app.fathom.board/launch.log` | `~/Library/Logs/app.fathom.board.dev/launch.log` |

The database holds Fathom's own backlog and what Fathom adds on top of either task source:

- backlog tasks (generated id, title, detail, project, row, created and updated times), used when no Firstmate home is set,
- columns (generated id, project or none for an added column, name, order, width, collapsed, deleted),
- row names,
- settings,
- card places: a card's order within its cell and the column the user put it in (by column id),
- move requests (board requests) and what became of them,
- a disposable snapshot of the last board, used to paint the next launch at once.

Migrations live in `src-tauri/migrations` and are numbered; the applied version is SQLite's `user_version`.

Settings shows the data size and path.
"Export as JSON and CSV" in Settings writes everything Fathom stores into a new folder.
The same export runs from the command line:

```sh
release/<version>/Fathom.app/Contents/MacOS/fathom --export <directory>
```

Deleting the database resets Fathom; nothing in Firstmate's home is affected.

Every launch appends one line to `launch.log` with the time from process start to a populated board, whether it came from the cache or a fresh read, and the card count.
The goal is under 0.5 s on a warm start.

## How the board is read

Fathom reads one task source.
With a Firstmate home set in Settings it reads Firstmate's task list, as described below.
With the home left empty it reads its own backlog; see [Fathom's own backlog](#fathoms-own-backlog).

- Fathom reads tasks only through `<firstmate home>/bin/fm-tasks-axi.sh list` and `show`.
  It never parses `data/backlog.md`.
- Fathom never writes files in Firstmate's home itself.
  The only thing it sends is a move request, through `bin/fm-inbox.sh note`.
- It watches the task list file and listens to herdr-core events; either one triggers a re-read.
  Firstmate's tasks need no polling loop; only Fathom's own database is polled, as described in [Live refresh](#live-refresh).
- On open it paints the snapshot cache, then refreshes.
- Each task's row comes from its state and hold:

| Task | Row |
| --- | --- |
| done | Landed |
| hold kind `parked` | Deep |
| hold kind `captain` with a date (even a past one) | Deep |
| hold kind `captain` without a date | Surface |
| in flight | Shallows |
| anything else (queued) | Seabed |

- A finished scout (a task of kind `scout`) also lands, and its card carries a "Reported" tag.
- Columns are seeded one per project the first time a project appears; collapse and width are saved per column.
- Every column has a generated numeric id, so an added column can never clash with a project name.
- Clicking a column's name in its header renames the column in Fathom.
  Enter or a click elsewhere saves, Escape cancels, and an empty name returns to the project's name.
  An added column has no project name to return to, so emptying its name keeps the current one.
  The project itself and Firstmate's task list keep their names.

## Fathom's own backlog

A fresh install without Firstmate (no `bin/fm-tasks-axi.sh` under `~/Documents/firstmate`) starts with an empty Firstmate home and uses the backlog stored in Fathom's database.
Clearing the Firstmate home in Settings switches an existing install to it.
Fathom has no form for adding tasks; an agent keeps the backlog through the MCP server below.
Nothing in the backlog cares which agent fills it.

### The MCP server

The app binary doubles as a stdio MCP server named `fathom` when started with `--mcp`.
It answers on stdin and stdout, opens no window, and exits when the client closes the connection.
Its tools show up in Claude Code as `mcp__fathom__*`:

| Tool | What it does |
| --- | --- |
| `list_tasks` | Lists tasks, optionally only one `project` or one `row`. |
| `add_task` | Adds a task with a `title`, a `project`, and optionally a `detail` and a starting `row` (default `seabed`). |
| `update_task` | Changes a task's `title`, `detail` or `project`. |
| `move_task` | Moves a task to a `row`; this also answers any board request asking for that row. |
| `list_requests` | Lists pending board requests, oldest first. |
| `answer_request` | Accepts a request, which moves the task, or declines it with a short `reason`. |

The server's instructions tell the agent to keep its task list in Fathom and to answer board requests.
Rows use the fixed keys `surface` (needs the user), `shallows` (in progress), `deep` (parked or waiting), `seabed` (queued) and `landed` (done).

The server uses the app's database by default.
`--db <file>` or the `FATHOM_DB` environment variable points it at another SQLite file instead, and the flag wins over the variable.
A binary built with plain `cargo build` carries the release app id, so pass `--db` when trying it out.

Register the packaged binary with Claude Code yourself; Fathom never changes Claude Code's configuration:

```sh
claude mcp add --scope user fathom -- "/path/to/Fathom.app/Contents/MacOS/fathom" --mcp
```

Or pass it for one session with `claude --mcp-config fathom-mcp.json`, where `fathom-mcp.json` holds:

```json
{
  "mcpServers": {
    "fathom": {
      "command": "/path/to/Fathom.app/Contents/MacOS/fathom",
      "args": ["--mcp"]
    }
  }
}
```

Release builds live in versioned folders, so point the command at the new build after an upgrade.

### Board requests and the nudge

- Dragging a backlog card to another row stores a board request instead of moving the task.
  The card waits in the new row marked "asked", the same way a Firstmate move does.
- If the chat panel is attached to a terminal, Fathom sends it one line with herdr-core's `send`, such as `1 board request waiting`.
  The count covers every request still waiting.
  Without an attached chat terminal the request just waits for the agent's next `list_requests`.
- The agent answers by moving the task to the requested row, or by declining with a short reason.
  A declined card goes back to its task's row and the card panel shows the reason until you dismiss it.
- Dragging a card back to the row its task is in withdraws the request and sends no nudge.
- Firstmate cards keep using Firstmate's inbox as described in [Arranging cards and asking for moves](#arranging-cards-and-asking-for-moves).

### Live refresh

The MCP server runs as its own process and writes to the same database.
Fathom checks SQLite's `data_version` every 250 ms, a cheap check that changes only when another connection commits.
A change triggers the same debounced re-read the Firstmate watchers use, so the window follows the agent's edits on its own.

## Adding, reordering and deleting columns

- "Add column" after the last column header asks for a name and adds an empty column at the end.
  An added column belongs to no project; drag cards into it to group them however you like.
  It renames, collapses and resizes like any other column.
- Drag a column by its header to move it, with all of its cards in every row, to a new place among the columns.
  A collapsed column drags by its strip the same way.
  The drag starts only after the pointer moves a few pixels, so clicks and renames work as before.
  A dashed line shows where the column will land, and the board scrolls when the pointer nears its edge.
  Escape, or dropping it back where it started, leaves the order unchanged.
  The order is saved and survives restarts; columns added later, by you or for a new project, still go at the end.
- Hovering a column header shows a trash button that deletes the column after a confirmation.
- Deleting a column that still shows cards first moves them, so no card ever drops off the board.
  The dialog says how many cards the column holds and asks where they go: any other column, or a new column you name.
  The cards land at the end of each row of that column, in the order they had.
  Moving and deleting happen together, so if anything fails nothing changes and the dialog shows the error.
  A card that arrives while the dialog is open moves with the rest.
  If the column looked empty when you opened the dialog, a card arriving before you confirm stops the delete and the dialog asks where it goes.
- Deleting an added column removes it for good.
- Deleting a project column hides it and remembers that, so it stays gone on later reads.
  There is no restore button.
  It comes back by itself only when a new task of that project has no other column to show in.
  Adding a column with the same name makes a new added column, not the project column.
- Adding, reordering and deleting columns only change Fathom's database; Firstmate's task list is never touched.

A release build opened from Finder does not inherit your shell's PATH.
Fathom asks your login shell for its PATH once at startup and uses it to find `hc` and `tasks-axi`.

## Arranging cards and asking for moves

- Drag a card by pressing on it and moving at least a few pixels; a plain click still opens the card.
  Escape cancels a drag, and the board scrolls when the pointer nears its edge.
- Moving a card within its cell or to another column only changes Fathom's own layout, kept in the database.
  Firstmate's task list is not touched.
- Dropping a card in another row sends one note to Firstmate's inbox:

  ```text
  Fathom board request: move <task id> "<card title>" from <row> to <row>
  ```

  Rows use fixed keys (`surface`, `shallows`, `deep`, `seabed`, `landed`), whatever names the rows carry in Settings.
  Each drop gets its own request id (`fathom-move-<task id>-<ms>`), passed as `--request-id`, so a resend of the same drop is not a second request.
- The card waits in the new row marked "asked" until Firstmate's task list puts the task there.
- If Firstmate replies to the note instead, the card goes back to the row its task state gives and shows the answer.
  Dismiss in the card panel clears the answer.
- If the note could not be saved, the card is marked "not sent" and the card panel offers "Send again" and "Cancel".
- Replies are read with `bin/fm-inbox.sh receipts --all-replies` whenever the board is re-read, which happens when the task list or Firstmate's reply folder changes.

## Crewmate indicator

- Fathom reads `<firstmate home>/state/<task id>.meta` to find the herdr-core terminal of a task's crewmate.
  Only records with `backend=hc` and exactly one `hc_session` and `hc_terminal` count.
- The sailor shows when that session is the one set in Settings and herdr-core lists the terminal as live.
- Its visor glows and blinks while herdr-core reports the terminal as `working` and stays dimmed for any other status.
  With reduced motion turned on in macOS, the working visor glows without blinking.
- Changes come from herdr-core events and from changes to the `.meta` files; there is no polling loop.
- Clicking the sailor opens the crewmate's terminal in a large view, attached the same way as the chat panel, so you can watch and type.
  The chat panel stays attached to its terminal meanwhile.
- Escape, a click on the dimmed board around the view, or the close button closes the view.
  Escape closes the view rather than reaching the crewmate's terminal.
  Closing only detaches Fathom; the crewmate and its terminal keep running.

## Settings

- Firstmate home, default `~/Documents/firstmate` under your home directory when Firstmate is installed there, otherwise empty.
  Empty means Fathom's own backlog.
- Chat terminal label.
  Empty means the default for the board: `firstmate.role=primary` with a Firstmate home, and Fathom's own `fathom.role=chat` on the backlog.
- Agent folder, default your home directory: the folder Claude Code and Codex start in when the chat panel opens them.
- herdr-core session and socket; empty means herdr-core's defaults.
- Row names.
- Appearance: a font and a size for the chat, and a font and a size for the board.
  "Add an installed font…" in either font menu lists every font family installed on the Mac, each shown in its own face.
  An added font joins that menu and is selected; the same list removes it again.
  Changes show at once while the dialog is open; Save keeps them across launches and Cancel puts them back.

Fathom opens in light mode.
The "Dark mode" button in the header switches the panels, cards and terminals to dark colors, and "Light mode" switches back.
The board rows keep their light bands in both themes.

## Chat panel and herdr-core

All herdr-core calls (`ls`, `get`, `events`, `attach`, `send`) live in `src-tauri/src/herdr.rs`.
Fathom talks only to herdr-core, never to the Herdr app.

The chat panel attaches to the terminal that carries the configured label, or else to a terminal Fathom opened (`fathom.role=chat`).
If none carries either, the panel offers to open a terminal and also lists the terminals herdr-core knows so you can pick one.
Keystrokes in the panel go into that terminal.

### Opening a terminal

The panel offers Claude Code and Codex, and Firstmate as well on a board with a Firstmate home.
It remembers the last agent you opened.
The panel's title names the agent; on the backlog it never says Firstmate.

Fathom starts the agent with `hc run --bg` on its own herdr-core session and labels the terminal `fathom.role=chat` and `fathom.agent=<claude|codex|firstmate>`.
The label makes it the chat terminal, so the panel finds it again after Fathom restarts.
herdr-core runs the program in its own environment, so Fathom looks the command up on your login shell's PATH and starts it by its full path.

- Claude Code starts in the agent folder with `--mcp-config <file>`.
  The file is `fathom-mcp.json` beside Fathom's database and points at Fathom's own binary with `--mcp --db <database>`, so Claude Code gets the [MCP server](#the-mcp-server) for this session only.
- Codex starts in the agent folder with `-c mcp_servers.fathom.command=...` and `-c mcp_servers.fathom.args=[...]`, the same server for this run only.
- Firstmate starts as plain `claude` in the Firstmate home, without Fathom's MCP server.

Fathom never changes Claude Code's or Codex's own configuration.
If herdr-core or the agent's command is missing, the panel says which one, and a missing folder is named too.

### Scrolling

- The mouse wheel or trackpad scrolls back through the last 10,000 lines the panel received, in the chat and in a crewmate's view.
  New output does not move a view that is scrolled back; scrolling down or typing returns to the live bottom.
- An attach starts from herdr-core's repaint of the current screen, so lines from before the attach are not in the scrollback.
- When the program asks for mouse input, the wheel goes to the program instead.
  In a full-screen program without mouse input, the wheel presses the up and down arrow keys.

### Keys and the clipboard

- Shift+Enter sends a new line instead of submitting, encoded the way herdr-core's own key encoder does it.
  It sends `ESC[13;2u` while the program has kitty keyboard mode on and `ESC[27;2;13~` otherwise.
  Fathom follows the kitty mode from the program's output, including the mode herdr-core restores when an attach starts.
- Selecting text in the chat with the mouse copies it to the clipboard.
  Option-drag selects text even when the program takes the mouse.
- A program can copy to the clipboard with OSC 52, for example when it handles mouse selection itself.
  Fathom never answers a program's request to read the clipboard.
- Dropping files from Finder onto the chat panel types their full paths, as a paste, without pressing Enter.
  Each path is escaped with backslashes the way macOS terminal apps do it, and the paths are separated and followed by a space.
  A file dropped anywhere else in the window does nothing.

The message box on a card sends `<card title> (<task id>): <text>` to the same terminal with `hc send`.

### Two clients on one terminal

With the Herdr app and Fathom both attached to Firstmate's terminal, herdr-core behaves like this (measured on herdr-core 0.1.20):

- An interactive client resizes the terminal to its own size when it attaches, resizes, or types.
  The last active client wins.
- A resize that keeps the same size does not take the size back; typing does.
- `hc attach --observe` never resizes, but it also never types.
- When every client detaches, the terminal returns to its own size.
- herdr-core sends the same output bytes to every client, with no size marker in the stream, and repaints the whole screen for a client that attaches.

Fathom sizes the terminal to its chat panel, the same way the Herdr app does.
It sets the size when it attaches, when the panel is resized, and when the chat font changes, and a key press or paste in the panel takes the size back.

When the Herdr app takes the size, the size event and the program's redraw reach Fathom on separate channels, so the redraw could land at the wrong size.
Fathom avoids that by attaching again at herdr-core's current size before it drops the old attach.
The panel switches to the new size first and then draws the fresh repaint, so the screen is never laid out for the wrong size.
Attaching at the current size changes nothing for the Herdr app.
While the Herdr app owns the size, the panel shows blank space or scrolls, and the view follows the cursor.
When the Herdr app leaves, the size stays where it was until you press a key in the panel or resize it.
