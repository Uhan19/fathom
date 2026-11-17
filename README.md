# Fathom

Fathom is a macOS desktop board for Firstmate's tasks.
Each task is a card, each project is a column, and each row shows how deep the work sits.
Milestone 1 is read-only: it shows the board, opens card details, and embeds Firstmate's live terminal as a chat panel.

## Requirements

- macOS, Rust (stable), Node 22 or newer, and pnpm.
- Firstmate installed, with `bin/fm-tasks-axi.sh` in its home.
- `hc` (herdr-core) and `tasks-axi` on your login shell's PATH.

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
Add `?other=120x45` to see the chat while another client owns a 120 by 45 terminal; a key press in the panel takes the size back.

## Run the checks

```sh
pnpm check
```

This runs the TypeScript compiler, the vitest suite, `cargo fmt --check`, `cargo clippy -D warnings`, and `cargo test`.

Two Rust tests are ignored by default because they need outside state:

- `tasks::home_tests::reads_a_real_home` reads a Firstmate home copy set in `FATHOM_TEST_HOME`.
- `herdr::tests::sizes_types_and_sends_into_a_lab_terminal` attaches to a throwaway herdr-core session set in `FATHOM_LAB_SESSION` and `FATHOM_LAB_SOCKET`.
  The labeled terminal (`FATHOM_LAB_LABEL`, default `firstmate.role=primary`) must echo each line it reads as `GOT:<line>`.
  It checks the attach and panel sizes reach the terminal, types a line, sends a card message, follows a second client's size by attaching again, and takes the size back.
  Never point it at a session you use.

```sh
FATHOM_LAB_SESSION=<lab session> FATHOM_LAB_SOCKET=<lab socket> FATHOM_LAB_LABEL=<label> \
  cargo test --manifest-path src-tauri/Cargo.toml --lib -- --ignored types_and_sends
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

The database holds only what Fathom adds on top of Firstmate:

- columns (project, name, order, width, collapsed),
- row names,
- settings,
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

- Fathom reads tasks only through `<firstmate home>/bin/fm-tasks-axi.sh list` and `show`.
  It never parses `data/backlog.md` and never writes in Firstmate's home.
- It watches the task list file and listens to herdr-core events; either one triggers a re-read.
  There is no polling loop.
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

- Columns are seeded one per project the first time a project appears; collapse and width are saved per column.

A release build opened from Finder does not inherit your shell's PATH.
Fathom asks your login shell for its PATH once at startup and uses it to find `hc` and `tasks-axi`.

## Settings

- Firstmate home, default `~/Documents/firstmate` under your home directory.
- Chat terminal label, default `firstmate.role=primary`.
- herdr-core session and socket; empty means herdr-core's defaults.
- Row names.
- Appearance: a font and a size for the chat, and a font and a size for the board.
  Changes show at once while the dialog is open; Save keeps them across launches and Cancel puts them back.

## Chat panel and herdr-core

All herdr-core calls (`ls`, `get`, `events`, `attach`, `send`) live in `src-tauri/src/herdr.rs`.
Fathom talks only to herdr-core, never to the Herdr app.

The chat panel attaches to the terminal that carries the configured label.
If none carries it, the panel lists the terminals herdr-core knows and lets you pick one.
Keystrokes in the panel go into that terminal.

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
