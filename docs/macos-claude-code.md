# Fathom on a clean Mac with Claude Code

This guide sets up Fathom on a Mac that has never seen it, and uses it with plain Claude Code.
Firstmate is not involved; see [macos-firstmate.md](macos-firstmate.md) for that setup.

At the end you have Fathom's own backlog board, a Claude Code chat terminal inside Fathom that can add and move cards through Fathom's MCP server, and Bosun, the helper that changes Fathom on request.

Steps marked **(untested)** follow the code or the official docs but were not run end to end on a fresh machine while writing this guide.
Every other step is confirmed from Fathom's code or README, or from the cited official docs.

## 1. Pick a clean slate

You want a Mac account where Fathom, Claude Code and herdr-core have never run, without touching the account you already use.
Never delete your existing data to get there.
There are two ways.

| | New macOS user account | macOS virtual machine (Tart or UTM) |
| --- | --- | --- |
| Setup cost | A few minutes in System Settings | About 25 GB of disk and some setup time |
| Hardware | Any Mac | Apple Silicon Mac only |
| Per-user state (`~/Library`, `~/.claude`, `~/.local`, Keychain) | Fresh | Fresh |
| `/Applications` | Shared with your account, so an installed Fathom.app is already there | Empty apart from what macOS ships |
| Homebrew, Xcode Command Line Tools, `/usr/local/bin` | Shared with your account | Not installed |
| Gatekeeper first-open prompt for a shared build | Already cleared if you approved that copy before | Shown, as on a new user's Mac |
| Reset to clean | Delete the test account | Delete the VM and clone a fresh one |

**Recommendation: use a VM.**
It is the only option that matches "I just bought a Mac": no shared apps, no shared Homebrew, no developer tools, and Gatekeeper behaves as it would for a new user.
A new user account is fine when you only want to test per-user first-run state, such as Fathom's empty database and the Claude Code sign-in.

### 1a. VM with Tart (recommended) (untested)

Tart runs macOS VMs on Apple Silicon Macs with macOS 13 or later ([tart.run/quick-start](https://tart.run/quick-start/)).
Apple's macOS license allows up to two extra macOS instances in VMs on each Mac you own or control, for software development, testing during development, or personal non-commercial use ([macOS Tahoe license, section 2B(iii)](https://www.apple.com/legal/sla/docs/macOSTahoe.pdf)).
Check Tart's own license terms on its site before using it for work.

1. Install Tart on your own account:

   ```sh
   brew install openai/tools/tart
   ```

2. Create a vanilla VM from Apple's latest restore image, so nothing is preinstalled:

   ```sh
   tart create --from-ipsw=latest fathom-clean
   tart run fathom-clean
   ```

3. Finish Apple's Setup Assistant in the VM window and create a local user.
4. Stop the VM and keep a pristine copy to reset from later:

   ```sh
   tart clone fathom-clean fathom-clean-pristine
   ```

Tart also publishes ready-made images such as `ghcr.io/cirruslabs/macos-tahoe-base:latest` with the login `admin` / `admin` ([tart.run/quick-start](https://tart.run/quick-start/)).
They are faster to start but may come with developer tools already installed, so they are less clean.

### 1b. VM with UTM (alternative) (untested)

UTM runs macOS guests on Apple Silicon Macs with macOS 12 or later ([docs.getutm.app/guest-support/macos](https://docs.getutm.app/guest-support/macos/)).

1. Install UTM from [mac.getutm.app](https://mac.getutm.app/).
2. Create a new VM, choose **Virtualization**, then **macOS 12+**.
3. Leave the IPSW field empty so UTM downloads the latest compatible macOS, which is what UTM recommends.
4. Finish Setup Assistant in the VM.

### 1c. New user account (lighter option)

1. Open **Apple menu > System Settings > Users & Groups** and click **Add User** ([Apple support](https://support.apple.com/guide/mac-help/change-users-groups-settings-mtusr001/mac)).
   You need an administrator account to do this.
2. Pick **Standard** for the account type, so the test account cannot change shared apps.
3. Log out and log in as the new user.

What carries over from your main account:

- Everything in `/Applications`, including an installed `Fathom.app`.
  In the test account, install the copy you are testing into `~/Applications` instead, and open it by its path, so you never launch the shared one by mistake.
- Homebrew under `/opt/homebrew` (or `/usr/local` on Intel), the Xcode Command Line Tools, and anything in `/usr/local/bin`.
- The Gatekeeper approval stored on an app you already opened.

What starts fresh: the home folder, so `~/Library`, `~/.claude`, `~/.claude.json`, `~/.local`, the login Keychain and the shell rc files.

## 2. What "clean" means: where each tool keeps state

These are every per-user location the three tools write to.
On a clean slate none of them exist yet.

| Tool | Location | What it is | Source |
| --- | --- | --- | --- |
| Fathom | `~/Library/Application Support/app.fathom.board/fathom.sqlite` | Backlog, settings, columns, theme | `src-tauri/src/lib.rs:27`, `src-tauri/tauri.conf.json` (identifier), README "Where the data lives" |
| Fathom | `~/Library/Application Support/app.fathom.board/fathom-mcp.json` | MCP config Fathom passes to the Claude Code it opens | `src-tauri/src/launch.rs:38` |
| Fathom | `~/Library/Application Support/app.fathom.board/bosun/` | Bosun's folder with `mcp.json` and `settings.json` | `src-tauri/src/launch.rs:15` |
| Fathom | `~/Library/Logs/app.fathom.board/launch.log` | One line per launch with start-up timing | `src-tauri/src/state.rs:28`, `src-tauri/src/lib.rs:48` |
| Fathom | `~/Library/WebKit/app.fathom.board`, `~/Library/Caches/app.fathom.board` | WebView data macOS keeps for the app window (untested) | Standard WKWebView behavior, not in Fathom's code |
| Fathom (dev build) | Same paths with `app.fathom.board.dev` | Kept apart from the release build | `src-tauri/tauri.dev.conf.json` |
| herdr-core | `~/.local/bin/herdr-core` and the `hc` link beside it | The terminal core Fathom drives | [install script](https://releases.herdr.dev/core/install.sh) |
| herdr-core | `$XDG_RUNTIME_DIR/herdr-core/<session>.sock`, else `~/.local/state/herdr-core/<session>/` | Running core's socket and state | Firstmate `docs/hc-backend.md` ("Runtime auto-detection") |
| Claude Code | `~/.local/bin/claude`, linked into `~/.local/share/claude/versions/` | Native install | [Claude Code setup](https://code.claude.com/docs/en/setup) |
| Claude Code | `~/.claude/` (including `settings.json`) | User settings, sessions, history | [Claude Code settings](https://code.claude.com/docs/en/settings) |
| Claude Code | `~/.claude.json` | Account details, MCP servers, per-project trust | [Claude Code settings](https://code.claude.com/docs/en/settings) |
| Claude Code | Login Keychain | Sign-in credentials on macOS | [Claude Code authentication](https://code.claude.com/docs/en/authentication) |
| Shell | `~/.zprofile` or `~/.zshrc` | The `PATH` line you add in step 3 | This guide |

Fathom never writes to Claude Code's own configuration (README "Opening a terminal").

## 3. Put `~/.local/bin` on your login shell's PATH

Claude Code and herdr-core both install into `~/.local/bin`, which a new Mac account does not have on `PATH`.
Fathom finds both tools by asking your login shell for its `PATH` once at start-up (`src-tauri/src/shell_path.rs:55`, `README.md:327`).

1. Open Terminal.
2. Add the folder for zsh, the default macOS shell:

   ```sh
   echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zprofile
   ```

3. Open a new Terminal window and check:

   ```sh
   echo "$PATH" | tr ':' '\n' | grep -x "$HOME/.local/bin"
   ```

## 4. Install herdr-core

Every terminal in Fathom, including Claude Code and Bosun, runs through herdr-core (`src-tauri/src/launch.rs:141`).

1. Install it:

   ```sh
   curl -fsSL https://releases.herdr.dev/core/install.sh | sh
   ```

   The script installs `herdr-core` into `~/.local/bin`, adds an `hc` link beside it when no `hc` exists, and on macOS installs it as a signed "Herdr Core.app" bundle.
2. Check it:

   ```sh
   herdr-core --version
   ```

Fathom looks for `herdr-core` first and then `hc` (`src-tauri/src/herdr.rs:14`).
The core starts by itself the first time Fathom connects; you do not start it.

## 5. Install Claude Code and sign in

Claude Code needs a Pro, Max, Ultra, Team, Enterprise or Console account; the free Claude plan does not include it ([setup](https://code.claude.com/docs/en/setup)).
It needs macOS 13 or later, which is also Fathom's minimum (`src-tauri/tauri.conf.json`, `minimumSystemVersion`).

1. Install it with the native installer:

   ```sh
   curl -fsSL https://claude.ai/install.sh | bash
   ```

   Homebrew works too, with `brew install --cask claude-code`, but it does not update itself ([setup](https://code.claude.com/docs/en/setup)).
2. Open a new Terminal window and check:

   ```sh
   claude --version
   claude doctor
   ```

3. Sign in:

   ```sh
   claude auth login
   ```

   A browser opens; finish the sign-in there.
   Running `claude` and following its first-run prompts works too ([authentication](https://code.claude.com/docs/en/authentication)).
4. Confirm the sign-in the same way Fathom does (`src-tauri/src/launch.rs:294`):

   ```sh
   claude auth status --text; echo "exit $?"
   ```

   `exit 0` means signed in and `exit 1` means signed out ([CLI reference](https://code.claude.com/docs/en/cli-reference)).

## 6. Get Fathom onto the Mac

Fathom has no published download: the GitHub repository has no releases and no tags.
So either install a build someone sends you (6a) or build it yourself (6b).

### 6a. Install a build someone shared

A release build of Fathom is signed ad hoc (`"signingIdentity": "-"` in `src-tauri/tauri.conf.json`) and is not notarized.
It runs only on the CPU type it was built on, because `pnpm release` builds for the host only (`scripts/release.sh`), so an Apple Silicon build does not run on an Intel Mac.

The sender:

1. Zips the app so the bundle survives the transfer:

   ```sh
   ditto -c -k --keepParent "release/0.1.0/Fathom.app" Fathom-0.1.0-macos.zip
   ```

On the clean Mac:

1. Download the zip and double-click it to unpack `Fathom.app`.
2. Move `Fathom.app` to `/Applications` (VM) or `~/Applications` (new user account, see 1c).
3. Open it once.
   Because the app came from the internet and Apple has not notarized it, macOS refuses to open it.
   Close the warning (on recent macOS it offers **Done** and **Move to Trash**; pick **Done**) (untested).
4. Open **System Settings > Privacy & Security**, scroll to **Security**, and click **Open Anyway**.
   The button is there for about an hour after the blocked attempt.
   Enter your login password, then click **Open** in the dialog that follows ([Apple support 102445](https://support.apple.com/en-us/102445), [Mac User Guide](https://support.apple.com/guide/mac-help/open-a-mac-app-from-an-unknown-developer-mh40616/mac)).
5. Later opens go straight through.

The exact wording of the refusal dialog differs between macOS versions (untested on this build).
A copy that arrives without the quarantine flag, for example over `scp` or a USB drive, opens without the prompt (untested).

### 6b. Build from source

Prerequisites (README "Requirements"):

- Xcode Command Line Tools.
- Rust stable.
- Node 22 or newer, and pnpm (CI uses Node 24 and pnpm 11, `.github/workflows/check.yml`).
- git (comes with the Command Line Tools).

Steps:

1. Install the Command Line Tools ([Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)):

   ```sh
   xcode-select --install
   ```

2. Install Rust ([Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)), then open a new Terminal window:

   ```sh
   curl --proto '=https' --tlsv1.2 https://sh.rustup.rs -sSf | sh
   ```

3. Install Homebrew from [brew.sh](https://brew.sh), then Node and pnpm (untested):

   ```sh
   brew install node pnpm
   ```

4. Clone Fathom and install its packages:

   ```sh
   git clone https://github.com/Uhan19/fathom.git ~/src/fathom
   cd ~/src/fathom
   pnpm install
   ```

5. Optional: run the checks CI runs.

   ```sh
   pnpm check
   ```

6. Build the release app (untested on a fresh machine):

   ```sh
   pnpm release
   ```

   The script reads the version from `src-tauri/tauri.conf.json`, builds `release/<version>/Fathom.app` with an ad hoc signature, verifies the signature, and installs nothing (`scripts/release.sh`).
7. Copy it into place and open it:

   ```sh
   ditto release/0.1.0/Fathom.app /Applications/Fathom.app
   open /Applications/Fathom.app
   ```

   A build made on the same Mac carries no quarantine flag, so Gatekeeper does not stop it (untested).
   The first launch of a new build can take several seconds while macOS checks the binary (README "Build a release").

`pnpm dev` runs a hot-reloading "Fathom Dev" instead, with its own data under `app.fathom.board.dev`, so it never touches a release build's data (README "Run the dev build").

## 7. First run

Fathom has no setup wizard.
It opens straight to the board, and every setting has a working default (`src-tauri/src/settings.rs`).

1. Open Fathom.
   The window opens at 1440 by 900 (`src-tauri/tauri.conf.json`).
2. The board shows **No tasks yet. Agents add them through Fathom's MCP server.**
   That is Fathom's own backlog: with no Firstmate at `~/Documents/firstmate`, the Firstmate home is empty and the board reads from Fathom's database (`src/source.ts:65`, `src-tauri/src/settings.rs:148`, `src-tauri/src/source.rs`).
3. The header shows a **herdr-core** status dot, which turns green once Fathom is connected to the core (`src/App.tsx:261`).
   Hovering it shows "herdr-core connected", or the reason it is not.
4. The chat panel on the right is open by default and says **No terminal carries the label fathom.role=chat.**
   Under **Open a terminal**, Claude Code is preselected, with Codex as the other choice.
   It says **Starts in** your home folder, the default agent folder (`src-tauri/src/settings.rs:228`).
5. Click **Open Claude Code**.
   Fathom writes `fathom-mcp.json` beside its database and starts `claude --mcp-config <that file>` through herdr-core in your login shell, in a terminal labeled `fathom.role=chat` (`src-tauri/src/launch.rs:163`).
6. Claude Code's own first-run prompts appear in the panel, for example the theme picker and whether to trust the home folder.
   Answer them there.
   If you skipped step 5.3, sign in here (untested).
7. Ask Claude Code to add a card, for example:

   ```text
   Add a task "Try Fathom" to the Fathom backlog for project "demo".
   ```

   Claude Code calls the `mcp__fathom__add_task` tool and the card appears in the **Seabed** row under a **demo** column (README "The MCP server").
8. Open Bosun with the **Bosun** button or **Cmd+J**.
   The drawer says **Bosun has not started yet**; click **Start Bosun**.
   Bosun is Claude Code started with `--model haiku` and only Fathom's helper tools (`src-tauri/src/launch.rs:200`).
   If Claude Code asks whether to trust Bosun's folder, answer in the drawer.
9. Ask Bosun something like **Switch to dark mode** and watch the theme change.

### Settings that matter in this mode

Open **Settings** in the header.
For a Claude Code setup the defaults are right; this is what each one does:

- **Firstmate home**: leave empty.
  Empty means Fathom's own backlog (README "Settings").
- **Chat terminal label**: leave empty, which means `fathom.role=chat` on the backlog.
- **Agent folder**: where Claude Code starts; your home folder by default.
  Point it at a project folder if you want Claude Code to work there.
- **Session** and **Socket**: leave empty to use herdr-core's defaults.
- Fonts and sizes for the chat and the board.

### CLIs Fathom expects on PATH

| Command | Needed for | When it is missing |
| --- | --- | --- |
| `herdr-core` (or `hc`) | Every terminal: chat, Bosun, workers | The chat panel says **herdr-core is not installed or not on PATH. Fathom opens and shows terminals through herdr-core (hc).** (`src/agents.ts:48`) |
| `claude` | The Claude Code chat terminal and Bosun | The chat panel says **Claude Code is not installed or not on PATH. Fathom looked for the claude command.** The Bosun drawer shows the install command, the Homebrew alternative and **Check again** (`src/bosun.ts:6`, `src/components/BosunDrawer.tsx:301`) |
| `codex` | Only if you pick Codex in the chat panel | Same message, naming Codex |

Fathom never calls `tasks-axi` itself; only Firstmate's wrapper does, so this setup does not need it.

## 8. It is working when you see

- [ ] The **herdr-core** dot in the header is green.
- [ ] The board says **No tasks yet**, not an error.
- [ ] **Open Claude Code** shows Claude Code running in the chat panel, and typing there reaches it.
- [ ] A card you ask Claude Code to add shows on the board within a moment.
- [ ] Bosun's dot turns green (**Bosun is ready**) and a request such as **Switch to dark mode** changes Fathom.
- [ ] Quitting and reopening Fathom brings back the same chat terminal and cards.

## 9. Troubleshooting

**"herdr-core is not installed or not on PATH" right after installing it.**
Fathom reads the login shell's `PATH` once when it starts (`README.md:327`).
Check that `~/.local/bin` is in `~/.zprofile` (step 3), then quit Fathom with Cmd+Q and open it again.

**"Claude Code is not installed or not on PATH".**
Same cause and fix as above.
Run `zsh -l -i -c 'command -v claude'` to see what Fathom will see.

**Bosun says "Claude Code is signed out".**
Run `claude auth login` in Terminal, or finish the sign-in in Bosun's drawer, then wait for the drawer to update.
A free Claude plan cannot use Claude Code.

**"Fathom" cannot be opened, and there is no Open Anyway button.**
The button only appears for about an hour after you try to open the app.
Open the app again, click **Done**, then go back to **Privacy & Security**.

**The app opens and closes at once, or says it is damaged (untested).**
The build may be for the other CPU type, or the zip may have broken the bundle.
Check with `file /Applications/Fathom.app/Contents/MacOS/fathom` and ask for a build for your Mac, zipped with `ditto` as in step 6a.

**The header dot stays on "connecting".**
Fathom retries the core every 2 seconds (`src-tauri/src/herdr.rs:40`).
Run `herdr-core --version` in Terminal; if it fails, reinstall it (step 4).

**The chat panel says a folder is missing.**
The agent folder in Settings does not exist.
Pick an existing folder and save.

**`pnpm release` fails with "already exists".**
The script refuses to overwrite a version (`scripts/release.sh`).
Bump the version in `src-tauri/tauri.conf.json` or move the old folder away.

**`xcode-select` or `rustc` not found while building.**
Open a new Terminal window after installing each tool, so the new `PATH` applies.

## 10. Start over

- VM: stop it, delete it, and clone the pristine copy again.

  ```sh
  tart delete fathom-clean
  tart clone fathom-clean-pristine fathom-clean
  ```

- Test user account: log out, then delete the test account in **System Settings > Users & Groups**.
  This removes only that account's home folder.
- Running terminals: Bosun and the chat terminal keep running after Fathom quits (README "Bosun").
  Inside the test account or VM, `hc ls` lists them and logging out or shutting down the VM ends them.
