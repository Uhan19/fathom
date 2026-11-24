# Fathom on a clean Mac with Firstmate

This guide sets up Fathom on a Mac that has never seen it, and uses it as the board for Firstmate.
For plain Claude Code without Firstmate, see [macos-claude-code.md](macos-claude-code.md).

At the end Fathom shows Firstmate's task list, a chat panel attached to your first mate, and a sailor on each card whose crewmate is working, which opens that crewmate's terminal when clicked.

Steps marked **(untested)** follow the code or the official docs but were not run end to end on a fresh machine while writing this guide.
Every other step is confirmed from Fathom's code or README, Firstmate's tracked files, or the cited official docs.

## How the pieces fit

- Fathom reads tasks only through `<firstmate home>/bin/fm-tasks-axi.sh list` and `show` (`src-tauri/src/tasks.rs:9`, README "How the board is read").
  That wrapper runs `tasks-axi`, so `tasks-axi` must be installed.
- Fathom finds the Firstmate home by itself only at `~/Documents/firstmate`, and only when `bin/fm-tasks-axi.sh` exists there (`src-tauri/src/settings.rs:13`, `src-tauri/src/settings.rs:148`).
  Anywhere else, set it in Settings.
- A sailor shows only for crewmates that Firstmate runs on the **hc** backend, in the same herdr-core session as Fathom.
  Fathom reads `state/<task id>.meta` and needs `backend`, `hc_session` and `hc_terminal` in it (`src-tauri/src/workers.rs:15`).
  Firstmate picks hc automatically only inside a Herdr app terminal, never inside Fathom's chat terminal (Firstmate `docs/hc-backend.md`, "Runtime auto-detection").
  So you set the backend to `hc` yourself in step 8.

## 1. Pick a clean slate

You want a Mac account where Fathom, Claude Code, herdr-core and Firstmate have never run, without touching the account you already use.
Never delete your existing data to get there.

| | New macOS user account | macOS virtual machine (Tart or UTM) |
| --- | --- | --- |
| Setup cost | A few minutes in System Settings | About 25 GB of disk and some setup time |
| Hardware | Any Mac | Apple Silicon Mac only |
| Per-user state (`~/Library`, `~/Documents`, `~/.claude`, `~/.local`, `~/.config/gh`, Keychain) | Fresh | Fresh |
| `/Applications` | Shared with your account, so an installed Fathom.app is already there | Empty apart from what macOS ships |
| Homebrew, Xcode Command Line Tools, global npm packages under the Homebrew prefix | Shared with your account | Not installed |
| Gatekeeper first-open prompt for a shared build | Already cleared if you approved that copy before | Shown, as on a new user's Mac |
| Reset to clean | Delete the test account | Delete the VM and clone a fresh one |

**Recommendation: use a VM.**
Firstmate's toolchain installs global tools (Homebrew formulas and npm packages), and in a second user account those land in the Homebrew prefix your main account owns.
A VM keeps all of that apart and matches a new Mac exactly.

### 1a. VM with Tart (recommended) (untested)

Tart runs macOS VMs on Apple Silicon Macs with macOS 13 or later ([tart.run/quick-start](https://tart.run/quick-start/)).
Apple's macOS license allows up to two extra macOS instances in VMs on each Mac you own or control, for software development, testing during development, or personal non-commercial use ([macOS Tahoe license, section 2B(iii)](https://www.apple.com/legal/sla/docs/macOSTahoe.pdf)).
Check Tart's own license terms on its site before using it for work.

1. Install Tart on your own account:

   ```sh
   brew install openai/tools/tart
   ```

2. Create a vanilla VM from Apple's latest restore image:

   ```sh
   tart create --from-ipsw=latest fathom-fm-clean
   tart run fathom-fm-clean
   ```

3. Finish Apple's Setup Assistant in the VM window and create a local user.
4. Stop the VM and keep a pristine copy to reset from later:

   ```sh
   tart clone fathom-fm-clean fathom-fm-clean-pristine
   ```

### 1b. VM with UTM (alternative) (untested)

UTM runs macOS guests on Apple Silicon Macs with macOS 12 or later ([docs.getutm.app/guest-support/macos](https://docs.getutm.app/guest-support/macos/)).
Install UTM from [mac.getutm.app](https://mac.getutm.app/), create a VM with **Virtualization** and **macOS 12+**, leave the IPSW empty so UTM downloads macOS, and finish Setup Assistant.

### 1c. New user account (lighter option)

1. Open **Apple menu > System Settings > Users & Groups** and click **Add User** ([Apple support](https://support.apple.com/guide/mac-help/change-users-groups-settings-mtusr001/mac)).
2. Pick **Administrator** if the test account must install its own Homebrew tools, otherwise **Standard**.
3. Log out and log in as the new user.

What carries over from your main account: `/Applications` (including any `Fathom.app`), Homebrew and everything it installed, global npm packages in Homebrew's Node, and the Xcode Command Line Tools.
Install the Fathom copy you are testing into `~/Applications` and open it by its path, so you never launch the shared one by mistake.

## 2. What "clean" means: where each tool keeps state

| Tool | Location | What it is | Source |
| --- | --- | --- | --- |
| Fathom | `~/Library/Application Support/app.fathom.board/fathom.sqlite` | Settings (including the Firstmate home), column layout, cached board, its own backlog | `src-tauri/src/lib.rs:27`, README "Where the data lives" |
| Fathom | `~/Library/Application Support/app.fathom.board/fathom-mcp.json` and `bosun/` | MCP config for the Claude Code it opens, and Bosun's folder | `src-tauri/src/launch.rs:15`, `src-tauri/src/launch.rs:38` |
| Fathom | `~/Library/Logs/app.fathom.board/launch.log` | Start-up timing, one line per launch | `src-tauri/src/state.rs:28` |
| Fathom | `~/Library/WebKit/app.fathom.board`, `~/Library/Caches/app.fathom.board` | WebView data macOS keeps for the window (untested) | Standard WKWebView behavior |
| herdr-core | `~/.local/bin/herdr-core` and `hc` | The terminal core | [install script](https://releases.herdr.dev/core/install.sh) |
| herdr-core | `$XDG_RUNTIME_DIR/herdr-core/<session>.sock`, else `~/.local/state/herdr-core/<session>/` | Running core's socket and state | Firstmate `docs/hc-backend.md` |
| Claude Code | `~/.local/bin/claude`, `~/.local/share/claude/` | Native install | [setup](https://code.claude.com/docs/en/setup) |
| Claude Code | `~/.claude/`, `~/.claude.json`, login Keychain | Settings, sessions, MCP servers, folder trust, sign-in | [settings](https://code.claude.com/docs/en/settings), [authentication](https://code.claude.com/docs/en/authentication) |
| GitHub CLI | `~/.config/gh/` | `gh auth login` result (untested) | gh's default config folder |
| Firstmate | `~/Documents/firstmate/` | The clone itself | Firstmate `README.md` "Quick Start" |
| Firstmate | `~/Documents/firstmate/config/`, `data/`, `state/`, `projects/` | Local, gitignored settings, task list, live task state, project clones | Firstmate `docs/configuration.md` |
| Firstmate | Global npm packages and Homebrew formulas | The toolchain in step 7 | Firstmate `docs/configuration.md` "Toolchain" |
| Shell | `~/.zprofile` or `~/.zshrc` | The `PATH` line from step 3 | This guide |

## 3. Put `~/.local/bin` on your login shell's PATH

Claude Code and herdr-core install into `~/.local/bin`, which a new Mac account does not have on `PATH`.
Fathom finds tools by asking your login shell for its `PATH` once at start-up (`src-tauri/src/shell_path.rs:55`, `README.md:327`).

```sh
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zprofile
```

Open a new Terminal window before you continue.

## 4. Install Homebrew, git and the GitHub CLI

Firstmate needs git and an authenticated GitHub CLI (Firstmate `README.md`, "Requirements").

1. Install the Command Line Tools, which include git:

   ```sh
   xcode-select --install
   ```

2. Install Homebrew from [brew.sh](https://brew.sh), and follow the lines it prints to add `brew` to your shell.
3. Install Node, jq and the GitHub CLI (untested):

   ```sh
   brew install node jq gh
   ```

4. Sign in to GitHub:

   ```sh
   gh auth login
   ```

## 5. Install herdr-core

```sh
curl -fsSL https://releases.herdr.dev/core/install.sh | sh
herdr-core --version
```

The script installs `herdr-core` into `~/.local/bin`, adds an `hc` link when no `hc` exists, and on macOS installs it as a signed "Herdr Core.app" bundle.
Firstmate's hc backend needs Herdr Core 0.1.14 or later (Firstmate `docs/hc-backend.md`, "Setup").

## 6. Install Claude Code and sign in

Claude Code needs a Pro, Max, Ultra, Team, Enterprise or Console account ([setup](https://code.claude.com/docs/en/setup)).

```sh
curl -fsSL https://claude.ai/install.sh | bash
```

Open a new Terminal window, then:

```sh
claude --version
claude auth login
claude auth status --text; echo "exit $?"
```

`exit 0` means signed in ([CLI reference](https://code.claude.com/docs/en/cli-reference)); Fathom uses the same check for Bosun (`src-tauri/src/launch.rs:294`).

## 7. Install Firstmate

Firstmate's public README installs it by cloning and starting a harness in the clone.
Clone it to `~/Documents/firstmate` so Fathom finds it without any setting.

1. Clone it:

   ```sh
   git clone https://github.com/kunchenguid/firstmate ~/Documents/firstmate
   ```

2. Set the runtime backend to hc, so crewmates run in herdr-core terminals Fathom can show, and create the `data` folder for the task list.
   `config/backend` is a local, gitignored file whose first line selects the backend (Firstmate `docs/configuration.md`, "Backend selection order").
   `data/` is gitignored too, so a fresh clone has none, and until it exists `bin/fm-tasks-axi.sh` refuses to list tasks.

   ```sh
   mkdir -p ~/Documents/firstmate/config ~/Documents/firstmate/data
   echo hc > ~/Documents/firstmate/config/backend
   ```

3. Start your first mate once from Terminal to let it check the toolchain:

   ```sh
   cd ~/Documents/firstmate
   claude
   ```

   On session start the first mate lists every missing or outdated tool with its install command, and installs the ones it can after you say go (Firstmate `docs/configuration.md`, "Toolchain").
   For the hc backend the list is node, git, gh, no-mistakes 1.46.0 or newer, gh-axi, chrome-devtools-axi, tasks-axi and quota-axi, plus hc, jq and treehouse (Firstmate `bin/fm-backend.sh`, `fm_backend_required_tools`).
4. Approve the installs, then quit this session with `/exit`.
   From now on you start the first mate from Fathom.
5. Check the wrapper Fathom uses:

   ```sh
   ~/Documents/firstmate/bin/fm-tasks-axi.sh list
   ```

   It should print an empty or short task list, not an error.

## 8. Get Fathom onto the Mac

Fathom has no published download: the GitHub repository has no releases and no tags.

### 8a. Install a build someone shared

A release build of Fathom is signed ad hoc (`"signingIdentity": "-"` in `src-tauri/tauri.conf.json`), is not notarized, and runs only on the CPU type it was built on (`scripts/release.sh` builds for the host only).

The sender zips it so the bundle survives the transfer:

```sh
ditto -c -k --keepParent "release/0.1.0/Fathom.app" Fathom-0.1.0-macos.zip
```

On the clean Mac:

1. Download the zip and double-click it to unpack `Fathom.app`.
2. Move `Fathom.app` to `/Applications` (VM) or `~/Applications` (test user account).
3. Open it once.
   macOS refuses to open it because Apple has not notarized it; close the warning with **Done** (untested wording).
4. Open **System Settings > Privacy & Security**, scroll to **Security**, and click **Open Anyway** within about an hour of the blocked attempt.
   Enter your login password, then click **Open** ([Apple support 102445](https://support.apple.com/en-us/102445), [Mac User Guide](https://support.apple.com/guide/mac-help/open-a-mac-app-from-an-unknown-developer-mh40616/mac)).

### 8b. Build from source

1. Install Rust ([Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)), then open a new Terminal window:

   ```sh
   curl --proto '=https' --tlsv1.2 https://sh.rustup.rs -sSf | sh
   ```

2. Install pnpm (untested):

   ```sh
   brew install pnpm
   ```

3. Clone, install and build (the build is untested on a fresh machine):

   ```sh
   git clone https://github.com/Uhan19/fathom.git ~/src/fathom
   cd ~/src/fathom
   pnpm install
   pnpm release
   ditto release/0.1.0/Fathom.app /Applications/Fathom.app
   ```

Prerequisites are Rust stable, Node 22 or newer, pnpm and the Command Line Tools (README "Requirements"); CI uses Node 24 and pnpm 11 (`.github/workflows/check.yml`).

## 9. First run

Fathom has no setup wizard; it opens straight to the board.

1. Open Fathom.
2. Because `~/Documents/firstmate/bin/fm-tasks-axi.sh` exists, Fathom uses it as the Firstmate home and shows Firstmate's task list, one column per project (`src-tauri/src/settings.rs:148`).
   An empty task list shows an empty board.
3. The **herdr-core** dot in the header turns green once Fathom reaches the core (`src/App.tsx:261`).
4. The chat panel looks for the label `firstmate.role=primary` and, finding none, offers **Open a terminal** with Claude Code, Codex and **Firstmate**.
5. Pick **Firstmate**.
   The panel says it starts in the Firstmate home.
   Click **Open Firstmate**.
   Fathom starts plain `claude` in the Firstmate home through herdr-core, labeled `fathom.role=chat` and `fathom.agent=firstmate`, without Fathom's MCP server (README "Opening a terminal", `src-tauri/src/state.rs:295`).
6. Claude Code may ask whether to trust the Firstmate folder; answer in the panel.
   The first mate starts and reports its state.
7. Give it a small task, for example a scout task on a public repository.
   The card appears on the board when Firstmate writes it to `data/backlog.md`, which Fathom watches (`src-tauri/src/watch.rs:9`).
8. When the first mate starts a crewmate on hc, a sailor appears on that card.
   Its visor blinks while the crewmate works.
   Click it to watch the crewmate's terminal; Escape closes the view and leaves the crewmate running (README "Crewmate indicator").
9. Drag a card to another row.
   Fathom sends the first mate a note through `bin/fm-inbox.sh note` and shows the move as asked until Firstmate's task list agrees (README "Arranging cards and asking for moves").
10. Bosun works the same as in the Claude Code setup: **Bosun** button or **Cmd+J**, then **Start Bosun**.

### Settings that matter in this mode

- **Firstmate home**: `~/Documents/firstmate` is filled in for you.
  If you cloned Firstmate elsewhere, set the full path here and **Save**.
  The default is used only until you save Settings once (README "Settings").
- **Chat terminal label**: leave empty, which means `firstmate.role=primary` on a Firstmate board.
- **Session**: leave empty so Fathom uses herdr-core's `default` session (`src-tauri/src/workers.rs:14`).
  Firstmate's hc backend also uses `default` unless `HC_SESSION` is set (Firstmate `docs/hc-backend.md`).
  If you change one, change the other, or sailors never show.
- **Socket**: leave empty.
- **Agent folder**: only used when you open Claude Code or Codex instead of Firstmate.

### CLIs Fathom expects on PATH

| Command | Needed for | When it is missing |
| --- | --- | --- |
| `herdr-core` (or `hc`) | Every terminal and every sailor | **herdr-core is not installed or not on PATH. Fathom opens and shows terminals through herdr-core (hc).** (`src/agents.ts:48`) |
| `claude` | Firstmate's chat terminal and Bosun | **Claude Code is not installed or not on PATH. Fathom looked for the claude command.**, also for the Firstmate choice, because Firstmate runs as `claude` (`src/agents.ts:11`, `src/agents.ts:48`) and the install prompt in the Bosun drawer (`src/components/BosunDrawer.tsx:301`) |
| `tasks-axi` | Reading the board, through `bin/fm-tasks-axi.sh` | The board shows a read error (untested exact text) |
| `bin/fm-tasks-axi.sh` in the home | Reading the board | **`<path>` not found; check the Firstmate home setting** (`src-tauri/src/tasks.rs:152`) |

## 10. It is working when you see

- [ ] The **herdr-core** dot in the header is green.
- [ ] The board shows Firstmate's projects and tasks, the same as `bin/fm-tasks-axi.sh list`.
- [ ] **Open Firstmate** shows the first mate running in the chat panel, and typing there reaches it.
- [ ] A task the first mate starts gets a sailor, and clicking it opens the crewmate's terminal.
- [ ] Dragging a card makes the first mate receive a move note.
- [ ] Bosun's dot turns green and a request such as **Switch to dark mode** changes Fathom.

## 11. Troubleshooting

**The board is Fathom's own backlog ("No tasks yet. Agents add them through Fathom's MCP server.") instead of Firstmate's tasks.**
Fathom did not find `bin/fm-tasks-axi.sh` at `~/Documents/firstmate`, or Settings were saved with an empty Firstmate home.
Set the Firstmate home in Settings and save.

**The chat panel offers no Firstmate choice.**
Firstmate is offered only on a board with a Firstmate home (README "Opening a terminal").
Fix the Firstmate home first.

**"Firstmate needs a board on a Firstmate home".**
Same cause: the board is on the backlog (`src-tauri/src/state.rs:301`).

**The board shows a read error.**
Run `~/Documents/firstmate/bin/fm-tasks-axi.sh list` in Terminal.
If it complains about `tasks-axi`, start the first mate again and let it install the toolchain, or run `npm install -g tasks-axi` (untested).
Then quit and reopen Fathom so it picks up the new `PATH`.

**Crewmates run, but no sailor shows.**
Open `~/Documents/firstmate/state/<task id>.meta`.
It must contain `backend=hc`, `hc_session=...` and `hc_terminal=...` (`src-tauri/src/workers.rs:15`).
If it says `backend=tmux`, `config/backend` was missing when the task started; set it as in step 7 and start a new task.
If `hc_session` is not `default`, set the same session in Fathom's Settings.

**The first mate says tmux is missing.**
It resolved the default tmux backend because `config/backend` is missing or empty.
Write `hc` into it as in step 7.

**"herdr-core is not installed or not on PATH" or "Claude Code is not installed or not on PATH" right after installing.**
Fathom reads the login shell's `PATH` once when it starts.
Check `~/.zprofile` (step 3), then quit Fathom with Cmd+Q and open it again.

**Moves stay "asked" forever.**
Fathom only sends a note; the first mate makes the change.
Check that the first mate is running in the chat panel and look at its replies.

**`gh` commands fail inside the first mate.**
Run `gh auth status` in Terminal and sign in again with `gh auth login`.

## 12. Start over

- VM: delete it and clone the pristine copy.

  ```sh
  tart delete fathom-fm-clean
  tart clone fathom-fm-clean-pristine fathom-fm-clean
  ```

- Test user account: log out and delete it in **System Settings > Users & Groups**.
  Tools installed into the shared Homebrew prefix stay behind; remove them with `brew uninstall` and `npm uninstall -g` from the account that owns Homebrew if you want them gone.
