# Fathom

Fathom is a desktop board for an agent's tasks, for macOS and Linux.
It reads Firstmate's task list when a Firstmate home is set, and otherwise keeps its own backlog that any agent fills through Fathom's MCP server.
Each task is a card, each project starts as a column, and each row shows how deep the work sits.
You can add your own columns, drag columns into the order you like, and delete ones you no longer need.
It shows the board, opens card details, and embeds an agent's live terminal as a chat panel.
When no terminal is there yet, the chat panel opens Claude Code, Codex or Firstmate for you through herdr-core.
Cards can be dragged to arrange them, and a drag to another row asks the agent to move the task.
A small sailor on a card shows that a crewmate is on the task: its red visor glows and blinks while it works and dims while idle.
Clicking the sailor opens that crewmate's live terminal.
While a crewmate is on a card, the card's details also show an Agent tab with the same sailor, where you can watch its terminal and message it directly.
When an agent reports something new on a card you have not read yet, its colored bar turns magenta and blinks until you open the card and close it again.

To skip the manual steps below, paste the [agent setup sheet](docs/agent-setup.md) into Codex, Claude Code or another coding agent on your computer, and it sets Fathom up for you.

## Requirements

- macOS, or Linux on x86_64 or arm64.
- Rust (stable), Node 22 or newer, and pnpm.
- For Firstmate's tasks: Firstmate installed, with `bin/fm-tasks-axi.sh` and `bin/fm-inbox.sh` in its home.
- herdr-core and `tasks-axi` on your login shell's PATH.
  Fathom looks for `herdr-core` first and then for `hc`, so it still works where another program owns the name `hc`.
- To open an agent from the chat panel: `claude` or `codex` on your login shell's PATH.

On Linux, also install Tauri's system packages.
On Debian or Ubuntu:

```sh
sudo apt-get install build-essential curl wget file pkg-config libxdo-dev libssl-dev \
  libayatana-appindicator3-dev librsvg2-dev libwebkit2gtk-4.1-dev
```

herdr-core installs the same way on both systems:

```sh
curl -fsSL https://releases.herdr.dev/core/install.sh | sh
```

On Linux, herdr-core keeps terminals running after Fathom quits through the systemd user manager, which mainstream desktop distributions run.

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
Add `?theme=dark` to start in the dark theme, `?nochat` to start with the chat panel closed, and `?filter=harbor-web,keel-cli` to start with a project filter.
Add `?agents=withAgent` or `?agents=withActiveAgent` to start with that agent filter, and `?rows=deep,landed` to start with those rows collapsed.
Add `?focus=48,57` to start with the board focused on those task numbers.
Add `?unseen` to light the cards that have an update you have not read, and `?folded=pilot-infra,keel-cli` to start with those columns collapsed; `?unseen&folded=pilot-infra&rows=deep` shows a lit card, a lit column header and a lit row band at once.
Add `?bosun=` with `notstarted`, `dormant`, `starting`, `ready`, `working`, `asking`, `signedout`, `missing`, `failed` or `stopped` to see that Bosun state; open the drawer with the Bosun rail under the board.

## Run the checks

```sh
pnpm check
```

This runs the TypeScript compiler, the vitest suite, `cargo fmt --check`, `cargo clippy -D warnings`, and `cargo test`.
GitHub Actions runs the same checks on Ubuntu 24.04 for every pull request and every push to `main`.

Four Rust tests are ignored by default because they need outside state:

- `tasks::home_tests::reads_a_real_home` reads a Firstmate home copy set in `FATHOM_TEST_HOME`.
- `herdr::tests::sizes_types_and_sends_into_a_lab_terminal` attaches to a throwaway herdr-core session set in `FATHOM_LAB_SESSION` and `FATHOM_LAB_SOCKET`.
  The labeled terminal (`FATHOM_LAB_LABEL`, default `firstmate.role=primary`) must echo each line it reads as `GOT:<line>`.
  It checks the attach and panel sizes reach the terminal, types a line, sends a card message, follows a second client's size by attaching again, and takes the size back.
  Never point it at a session you use.
- `launch::tests::opens_each_agent_in_a_lab` opens Claude Code, Codex and Firstmate in the same throwaway session through the launch module.
  It starts stub `claude` and `codex` scripts from a temporary folder, never the real tools, and checks each terminal's labels, folder, command line and MCP config file, that the chat lookup finds it, and that a board-request nudge reaches it.
- `launch::tests::opens_bosun_in_a_lab` opens [Bosun](#bosun) in a throwaway session with a stub `claude`.
  It checks the helper label, the Bosun folder and the command line, that the helper lookup finds the terminal, and that a typed line reaches it.

```sh
FATHOM_LAB_SESSION=<lab session> FATHOM_LAB_SOCKET=<lab socket> FATHOM_LAB_LABEL=<label> \
  cargo test --manifest-path src-tauri/Cargo.toml --lib -- --ignored types_and_sends
FATHOM_LAB_SESSION=<lab session> FATHOM_LAB_SOCKET=<lab socket> \
  cargo test --manifest-path src-tauri/Cargo.toml --lib -- --ignored opens_each_agent
FATHOM_LAB_SESSION=<lab session> FATHOM_LAB_SOCKET=<lab socket> \
  cargo test --manifest-path src-tauri/Cargo.toml --lib -- --ignored opens_bosun
```

## Build a release

```sh
pnpm release
```

The script reads the version from `src-tauri/tauri.conf.json` and builds into `release/<version>/`:

- on macOS, `Fathom.app` with an ad-hoc signature;
- on Linux, a Debian package `Fathom_<version>_<arch>.deb` and an AppImage `Fathom_<version>_<arch>.AppImage`.

Each system builds only its own bundles.
The script refuses to overwrite an existing version, so bump the version first.
It keeps the newest two versions, deletes older ones, and installs nothing.
`release/` is ignored by git.
CI builds the `.deb` and AppImage on Ubuntu 22.04 for every pull request and every push to `main` and uploads them as workflow artifacts.

On macOS, open the app from Finder or with `open release/<version>/Fathom.app`.
The first launch of a new build can take several seconds while macOS checks the new binary; later launches paint from the cache.

On Linux, install the Debian package and start Fathom from the desktop's app menu or with `fathom`:

```sh
sudo apt install ./release/<version>/Fathom_<version>_<arch>.deb
```

Or run the AppImage directly, which needs no install:

```sh
chmod +x release/<version>/Fathom_<version>_<arch>.AppImage
release/<version>/Fathom_<version>_<arch>.AppImage
```

An AppImage run this way has no app menu entry, and the dock shows a generic icon while it runs.
For a menu entry with Fathom's icon, add the AppImage with [Gear Lever](https://github.com/mijorus/gearlever) or [AppImageLauncher](https://github.com/TheAssassin/AppImageLauncher).

## Publish a release

Pushing a version tag publishes a GitHub Release with three downloads:

- `Fathom_universal.dmg`, one disk image for Apple Silicon and Intel Macs;
- `Fathom_amd64.deb`, the Debian package for x86_64;
- `Fathom_amd64.AppImage`, the AppImage for x86_64.

The names carry no version, so `https://github.com/Uhan19/fathom/releases/latest/download/<name>` always points at the newest release.

1. Set the new version in `src-tauri/tauri.conf.json`, `package.json` and `src-tauri/Cargo.toml`, then run `cargo check --manifest-path src-tauri/Cargo.toml` so `Cargo.lock` follows.
2. Merge that change to `main`.
3. Tag the merged commit and push the tag:

   ```sh
   git switch main && git pull
   git tag v<version>
   git push origin v<version>
   ```

The `Release` workflow then checks that the tag matches the version in `src-tauri/tauri.conf.json` and `package.json` and stops if it does not.
It builds the Linux packages on Ubuntu 22.04 and the universal disk image on macOS, and creates the release from the tag with generated notes.
The same workflow runs without publishing for pull requests that change it and when started by hand from the Actions tab, and leaves the three files in a `release-assets` artifact.

The disk image has an ad-hoc signature.
When the repository has the secrets `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD` and `APPLE_SIGNING_IDENTITY`, the workflow signs with that Developer ID certificate instead.
When it also has `APPLE_ID`, `APPLE_PASSWORD` and `APPLE_TEAM_ID`, it notarizes the app as well.

### Open a downloaded build on macOS

An ad-hoc-signed app is not notarized, so macOS blocks its first open.
Drag Fathom from the disk image into Applications, open it, and macOS says "Fathom" Not Opened, because Apple could not verify it is free of malware.
To open it anyway:

1. Click **Done** in that message.
2. Open **System Settings**, then **Privacy & Security**.
3. Scroll to **Security**, where it says "Fathom" was blocked to protect your Mac, and click **Open Anyway**.
4. Enter your password, then click **Open Anyway** in the message that follows.

macOS remembers the choice, so later opens work normally until you install a new download.
Or clear the download mark in Terminal before the first open:

```sh
xattr -dr com.apple.quarantine /Applications/Fathom.app
```

## Roll back

Quit Fathom and open the previous version from `release/`.

```sh
open release/<previous version>/Fathom.app
```

On Linux, install the previous Debian package with `sudo apt install --allow-downgrades ./release/<previous version>/Fathom_<previous version>_<arch>.deb`, or run the previous AppImage.

Both versions share the same database, and migrations only ever add, so an older build still reads it.

## Where the data lives

| What | System | Release build | Dev build |
| --- | --- | --- | --- |
| Database | macOS | `~/Library/Application Support/app.fathom.board/fathom.sqlite` | `~/Library/Application Support/app.fathom.board.dev/fathom.sqlite` |
| Database | Linux | `~/.local/share/app.fathom.board/fathom.sqlite` | `~/.local/share/app.fathom.board.dev/fathom.sqlite` |
| Launch timing log | macOS | `~/Library/Logs/app.fathom.board/launch.log` | `~/Library/Logs/app.fathom.board.dev/launch.log` |
| Launch timing log | Linux | `~/.local/share/app.fathom.board/logs/launch.log` | `~/.local/share/app.fathom.board.dev/logs/launch.log` |

On Linux, `~/.local/share` is `$XDG_DATA_HOME` when that is set.

The database holds Fathom's own backlog and what Fathom adds on top of either task source:

- backlog tasks (generated id, title, detail, project, row, created and updated times, and when an agent last reported on the task), used when no Firstmate home is set,
- columns (generated id, project or none for an added column, name, order, width, collapsed, deleted),
- row names and which rows are collapsed,
- task numbers: each task's number, its task source and its Firstmate name or backlog id, as described in [Task numbers](#task-numbers),
- settings, including the theme, whether the chat panel is open, the panel widths, the project filter, the agent filter and the task focus,
- card places: a card's order within its cell and the column the user put it in (by column id),
- move requests (board requests) and what became of them,
- the latest agent update you have read on each card, kept per task source, as described in [Unread updates](#unread-updates),
- a disposable snapshot of the last board, used to paint the next launch at once.

Migrations live in `src-tauri/migrations` and are numbered; the applied version is SQLite's `user_version`.

Settings shows the data size and path.
"Export as JSON and CSV" in Settings writes everything Fathom stores into a new folder.
The same export runs from the command line:

```sh
release/<version>/Fathom.app/Contents/MacOS/fathom --export <directory>
```

On Linux, run `fathom --export <directory>` after installing the Debian package, or pass `--export` to the AppImage.

[Bosun](#bosun) keeps its own folder, `bosun`, beside the database.

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
- Clicking a row's name collapses the row to a thin band that still shows its name and how many cards it holds; clicking it again expands the row.
  Which rows are collapsed is saved, and the last open row stretches to the bottom of the board.
  The "Expand all" switch in the header opens every folded column and collapsed row; switching it off again folds back what it opened.
- Every column has a generated numeric id, so an added column can never clash with a project name.
- Clicking a column's name in its header renames the column in Fathom.
  Enter or a click elsewhere saves, Escape cancels, and an empty name returns to the project's name.
  An added column has no project name to return to, so emptying its name keeps the current one.
  The project itself and Firstmate's task list keep their names.

## Task numbers

Every task on the board has a short number, such as `#42`, that never changes and is never given to another task.
One number space covers every task Fathom shows: Firstmate tasks from any home and Fathom's own backlog tasks.
Fathom keeps the numbers in its own database and never writes them into Firstmate.

A card shows its number, then its Firstmate name, above the title, as in `#42 multiply-chart-timezone`.
A task from Fathom's own backlog has no name, so its card shows just the number.
The card detail shows the same line beside the project and kind.

A task gets its number the first time Fathom sees it.
On the first launch with numbers, existing backlog tasks are numbered in the order they were created, and Firstmate tasks are numbered in the order Firstmate lists them when the board is first read.
After that, each new task takes the next number.
A number stays with its task after the task leaves the board, so it is never reused.

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
| `list_tasks` | Lists tasks with their numbers, optionally only one `project` or one `row`. |
| `add_task` | Adds a task with a `title`, a `project`, and optionally a `detail` and a starting `row` (default `seabed`). |
| `update_task` | Changes a task's `title`, `detail` or `project`. |
| `move_task` | Moves a task to a `row`; this also answers any board request asking for that row. |
| `list_requests` | Lists pending board requests, oldest first. |
| `answer_request` | Accepts a request, which moves the task, or declines it with a short `reason`. |
| `start_worker` | Starts a Claude Code worker on a task in its own terminal, optionally in a given `folder`. |

The tools that change a task take its [number](#task-numbers) as `task`, either `42` or `"#42"`, and every task they return carries its `number`.
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

On Linux, the command is `/usr/bin/fathom` once the Debian package is installed, or the path of the AppImage.

Release builds live in versioned folders, so point the command at the new build after an upgrade.

### The helper tools

`fathom --mcp --helper` adds tools that change Fathom itself, and swaps in instructions about them.
[Bosun](#bosun) starts the server this way; without `--helper` the server is the one above.
The helper server leaves out `start_worker`, because a worker is a new Claude Code session that works in a repo and Bosun's tools run without asking.
The tools write through the same code as the window's own controls and never change tasks.

| Tool | What it does |
| --- | --- |
| `get_board_layout` | Reads the columns in order, the rows with their names and whether each is collapsed, the project names, the project filter, the agent filter and the task focus. |
| `get_settings` | Reads the theme, fonts and sizes, panel widths, the project filter, the agent filter, the task focus and the connection settings. |
| `list_fonts` | Lists the font choices for the chat and the board, their size ranges and the installed font families. |
| `rename_column` | Renames a column. |
| `move_column` | Moves a column to a new position. |
| `set_column_view` | Changes a column's width or folds it. |
| `add_column` | Adds an empty custom column at the right end. |
| `delete_column` | Deletes a column; one that still has cards needs `move_to_column`. |
| `rename_row` | Renames a row, or brings back its default name. |
| `set_row_view` | Collapses one or more rows to a thin band, or expands them again. |
| `show_projects` | Shows only the named projects' columns. |
| `show_all_projects` | Shows every column again. |
| `set_agent_filter` | Shows every card (`all`), only cards with an agent (`withAgent`), or only cards with an active agent (`withActiveAgent`). |
| `focus_tasks` | Shows only the given tasks, each named by number (`42` or `"#42"`) or Firstmate name, and returns them with their `number` and `name`; entries that match no task come back under `unknown`. |
| `clear_focus` | Ends the focus and puts back the project and agent filters from before it. |
| `set_theme` | Switches between the light and dark theme. |
| `set_fonts` | Changes the chat and board fonts and sizes. |
| `set_panels` | Opens or closes the chat panel and changes the chat and card detail widths. |
| `set_connection` | Changes the Firstmate home, the chat terminal label, the herdr-core session and socket, and the agent folder. |

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
The same check re-reads the settings, so a theme, filter or column change from [Bosun](#bosun) shows within a moment.

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

A release build opened from Finder or a Linux desktop launcher does not inherit your shell's PATH.
Fathom asks your login shell for its PATH once at startup and uses it to find herdr-core and `tasks-axi`.

## Arranging cards and asking for moves

- Drag a card by pressing on it and moving at least a few pixels; a plain click still opens the card.
  Escape cancels a drag, and the board scrolls when the pointer nears its edge.
- Dropping a card on a collapsed row puts it at the end of that row in the column under the pointer, the same as dropping on a folded column; the row stays collapsed.
- While the agent filter hides some cards, a dropped card lands beside the shown card it was dropped next to, and the hidden cards keep their places.
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
  With reduced motion turned on in the system settings, the working visor glows without blinking.
- Changes come from herdr-core events and from changes to the `.meta` files; there is no polling loop.
- Clicking the sailor opens the crewmate's terminal in a large view, attached the same way as the chat panel, so you can watch and type.
  The chat panel stays attached to its terminal meanwhile.
- Escape, a click on the dimmed board around the view, or the close button closes the view.
  Escape closes the view rather than reaching the crewmate's terminal.
  Closing only detaches Fathom; the crewmate and its terminal keep running.

## Unread updates

- A card lights up when its agent has reported something you have not read yet.
  Its colored bar turns magenta, a color no other bar or badge uses, and glows and blinks; the rest of the card looks as usual.
  With reduced motion turned on in the system settings, the bar glows steadily instead of blinking.
- A collapsed column's header and a collapsed row's band light up the same way, through their card count, while they hold at least one such card.
  Each goes dark once you have read every one of them.
- Opening a card and then closing it, or opening another card, marks its updates read and the light goes out.
  The light stays on while the card panel is open, and an update that arrives meanwhile counts as read when you close it.
- With a Firstmate home, an update is a new line in the task's status log, `<firstmate home>/state/<task id>.status`.
  Fathom reads these logs beside the `.meta` records and follows them through the same watcher, with no polling loop.
- With Fathom's own backlog, an update is an agent changing a task's title, detail or project, or moving it to another row.
  Adding a task does not count, nor does a move that answers your own board request.
- Your own changes in Fathom, such as dragging cards or renaming and collapsing columns, never count as an update.
- What you have read is saved in Fathom's database, so it survives a restart, and updates that arrive while Fathom is closed light up at the next launch.
- The first time Fathom looks at a task source, everything already reported counts as read, so the board does not light up every card at once.
- A card hidden by the project or agent filter is not marked anywhere.

## Settings

- Firstmate home, default `~/Documents/firstmate` under your home directory when Firstmate is installed there, otherwise empty.
  Empty means Fathom's own backlog.
- Chat terminal label.
  Empty means the default for the board: `firstmate.role=primary` with a Firstmate home, and Fathom's own `fathom.role=chat` on the backlog.
- Agent folder, default your home directory: the folder Claude Code and Codex start in when the chat panel opens them.
- herdr-core session and socket; empty means herdr-core's defaults.
- Row names.
- Appearance: a font and a size for the chat, and a font and a size for the board.
  The font menus offer fonts that come with each system: SF Mono, Menlo, Monaco and Courier New for the chat on macOS, and JetBrains Mono (bundled with Fathom), DejaVu Sans Mono, Liberation Mono and Noto Sans Mono on Linux.
  The chat font defaults to SF Mono on macOS and to JetBrains Mono on Linux.
  "Add an installed font…" in either font menu lists every font family installed on the computer (through fontconfig on Linux), each shown in its own face.
  An added font joins that menu and is selected; the same list removes it again.
  Changes show at once while the dialog is open; Save keeps them across launches and Cancel puts them back.

The "Dark mode" switch in the header turns the panels, cards and terminals dark, and switching it off turns them light again.
The board rows keep their light bands in both themes.
Fathom remembers the theme, whether the chat panel is open, the chat and card panel widths, which rows are collapsed, the agent filter and the task focus across launches.
The selected card and the crewmate view you are watching are not remembered.

## Showing only some projects

Ask [Bosun](#bosun) to show only some projects, and the board keeps only their columns.
A strip above the board names them, and its "Show all" button brings every column back.
The counts in the header keep counting every project.
"Add column" is hidden while the filter is on, so a new column never lands out of sight.

## Showing only cards with an agent

The All, Agent and Active switch in the header chooses which cards the board shows:

- All shows every card.
- Agent shows only the cards that show a [sailor](#crewmate-indicator), idle or working.
- Active shows only the cards whose sailor's visor glows, because herdr-core reports the terminal as working.

Both kinds of board use the sailor's own signals, so the filter never disagrees with the indicator.
Cards come and go as agents start, stop and change status, from the same events that move the sailors.
While the filter is on, a strip above the board says so and its "Show every card" button turns it off.
It combines with the project filter, and the strip then names both.
Column totals and the counts on collapsed rows count only the cards the filters show, while the counts in the header keep counting every card.
When no card matches, the board says so and offers "Show every card".
Fathom remembers the filter across launches, and [Bosun](#bosun) can set it too.

## Focusing on some tasks

Ask [Bosun](#bosun) to show some tasks, by [number](#task-numbers) or Firstmate name, and the board keeps only their cards and the columns that hold them.
Focusing shows every project and turns the agent filter off first, so every named task that is on the board shows.
Bosun tells you about any number or name that matches no task.
A strip above the board names the focused tasks, and its "Clear focus" button ends the focus.
Clearing the focus, from the strip or through Bosun, puts back the project and agent filters that were on before the focus started.
Focusing again while a focus is on keeps those filters to come back to.
A filter changed while the focus is on stays as changed after clearing it, so "show everything again" ends with every card shown.
The project and agent filters still apply while the focus is on, and the strip then names each of them.
"Add column" is hidden while the focus is on.
When none of the focused tasks is on the board any more, the board says so and offers "Clear focus".
Fathom remembers the focus across launches until it is cleared.

## Bosun

Bosun is a helper you ask in plain words to change Fathom: columns, rows, which projects and cards show, the theme, fonts and panels.
Asked to show only some rows, such as only what is in progress, it collapses the other rows; asked for only the cards with an agent or an active agent, it sets the agent filter; asked to show only some tasks, it focuses the board on them; asked to show everything again, it expands every row, clears the focus and turns both filters off.
It is Claude Code running in a terminal Fathom opens, with only the [helper tools](#the-helper-tools).
Fathom never types into Bosun's terminal and never reads answers from it; Bosun changes Fathom only through the tools.

The Bosun rail under the board, or ⌘J on macOS and Ctrl+J on Linux, opens and closes a drawer under the board.
Drag the drawer's top edge to change its height.
While the drawer is closed, a rail under the board shows Bosun's state.
The dot beside Bosun's name is green when it is ready, blue while it works, and yellow while Claude Code asks before a change.

- The first time, the drawer explains Bosun and offers "Start Bosun".
  After that first start, Bosun starts by itself whenever you open the drawer.
- When Claude Code first starts in Bosun's folder it may ask whether to trust the folder; the drawer says so.
- If `claude` is not on your login shell's PATH, the drawer shows the install command and "Check again".
  Claude Code needs a paid Claude plan or a Claude Console account.
- If `claude auth status` says Claude Code is signed out, the drawer says so until the sign-in in the terminal finishes.
- Restart and Stop sit in the drawer's header while Bosun runs.
  After Stop, or when Claude Code exits, the last screen stays dimmed with "Start again".
- Bosun keeps running when Fathom quits, and Fathom finds it again by its label next time.

Fathom starts Bosun through herdr-core the same way as the [chat terminal](#opening-a-terminal), labeled `fathom.role=helper`, in a `bosun` folder beside the database.
Claude Code starts with `--model haiku`, `--mcp-config` and `--strict-mcp-config` for `fathom --mcp --helper` alone, `--allowedTools mcp__fathom`, a `--settings` file and a short system prompt.
The settings file asks before `delete_column` and `set_connection`, and its hooks tell Fathom when Claude Code is asking for permission.
Fathom writes both files on every start and never changes Claude Code's own configuration.

## Chat panel and herdr-core

All herdr-core calls (`ls`, `get`, `events`, `attach`, `send`) live in `src-tauri/src/herdr.rs`.
Fathom talks only to herdr-core, never to the Herdr app.

The chevron at the right of the panel's tab strip hides the chat, and the rail left at the window's edge shows it again; the show-or-hide shortcut does both.
Dragging the chat's edge wider takes room from the board until the board is one column wide, then from open card details down to their narrowest.

The chat panel attaches to the terminal that carries the configured label, or else to a terminal Fathom opened (`fathom.role=chat`).
If none carries either, the panel offers to open a terminal and also lists the terminals herdr-core knows so you can pick one.
Keystrokes in the panel go into that terminal.

### Opening a terminal

The panel offers Claude Code and Codex, and Firstmate as well on a board with a Firstmate home.
It remembers the last agent you opened.
The panel's title names the agent; on the backlog it never says Firstmate.

Fathom starts the agent with herdr-core's `run --bg` on its own herdr-core session and labels the terminal `fathom.role=chat` and `fathom.agent=<claude|codex|firstmate>`.
The label makes it the chat terminal, so the panel finds it again after Fathom restarts.
herdr-core runs the program in its own environment, so Fathom looks the command up on your login shell's PATH and starts it by its full path.
It starts the agent through your login shell, as `<shell> -l -i -c 'exec "$0" "$@"' <program> <args>`, so the agent and its hooks get the same environment as a terminal you open yourself, including what your rc files add to PATH (for example `node` from nvm or fnm).
The shell is `SHELL`, or your account's shell when `SHELL` is unset.
fish gets `exec $argv` instead, and any other shell falls back to `/bin/sh`.
Because the shell starts the agent, `hc ls` lists the terminal under the shell's name.

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
- On Linux, Ctrl+Shift+V or Shift+Insert pastes into the chat; Ctrl+V reaches the program as a control key.
- Selecting text in the chat with the mouse copies it to the clipboard.
  Option-drag on macOS, or Shift-drag on Linux, selects text even when the program takes the mouse.
- A program can copy to the clipboard with OSC 52, for example when it handles mouse selection itself.
  Fathom never answers a program's request to read the clipboard.
- Dropping files from Finder or a Linux file manager onto the chat panel types their full paths, as a paste, without pressing Enter.
  Each path is escaped with backslashes the way macOS and Linux terminal apps do it, and the paths are separated and followed by a space.
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

## License

Fathom is released under the [MIT License](LICENSE).
