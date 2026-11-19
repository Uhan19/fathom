# Fathom on a clean Linux machine, with Claude Code or Firstmate

## Does Fathom run on Linux today?

**It builds and its tests pass on Linux today; the packaged app has not been run on Linux by CI.**

- Fathom's README lists "macOS, or Linux on x86_64 or arm64" as supported (README "Requirements").
- The code has Linux paths for its data folder (`src-tauri/src/lib.rs:28`, `src-tauri/src/lib.rs:118`), fonts through fontconfig (`src-tauri/src/fonts.rs:13`, `src-tauri/Cargo.toml:47`) and Linux bundles (`src-tauri/tauri.linux.conf.json`).
- CI runs the full `pnpm check` (type checks, Vitest, rustfmt, clippy and the Rust tests) on Ubuntu 24.04 for every push and pull request (`.github/workflows/check.yml:10`), and it passed on `main` at commit `821a154`.

What is not covered, so treat it as untested:

1. CI never runs `pnpm release`, so the `.deb` and AppImage bundles are never built in CI (`.github/workflows/check.yml:37`, `scripts/release.sh:24`).
2. CI never opens the app window, so the WebKitGTK window, the terminals and Bosun are not exercised on Linux.
3. Nobody publishes Linux builds: the GitHub repository has no releases.
4. A bundle built on Ubuntu 24.04 needs that release's glibc or newer.
   Tauri advises building on the oldest distribution you want to support that still has WebKitGTK 4.1, such as Ubuntu 22.04 or Debian 12 ([Tauri AppImage](https://v2.tauri.app/distribute/appimage/), [Tauri Debian](https://v2.tauri.app/distribute/debian/)).

What it would take to call Linux confirmed: a CI job that runs `pnpm release` on Ubuntu 22.04 and uploads the `.deb` and AppImage, plus one manual pass of the checklists below on a desktop VM.

Steps marked **(untested)** follow the code or the official docs but were not run on Linux while writing this guide.

## 1. Pick a clean slate

| | New Linux user | Desktop VM |
| --- | --- | --- |
| Setup cost | One command | A few GB and an OS install |
| Per-user state (`~/.local`, `~/.claude`, `~/.config`) | Fresh | Fresh |
| System packages, `/usr/bin/fathom` from an installed `.deb` | Shared | Not installed |
| Desktop session for the window | Needs a graphical log-in as that user | Comes with the VM |

**Recommendation: a VM running Ubuntu 24.04 Desktop**, the release CI uses.
On an Apple Silicon Mac, UTM runs ARM64 Linux guests (untested); on a Linux host, GNOME Boxes or virt-manager work (untested).
For only per-user state, a second user is enough:

```sh
sudo adduser fathomtest
```

Log in to the desktop as that user (untested).

## 2. Where each tool keeps state on Linux

| Tool | Location | Source |
| --- | --- | --- |
| Fathom | `$XDG_DATA_HOME/app.fathom.board/` when `XDG_DATA_HOME` is an absolute path, else `~/.local/share/app.fathom.board/`, holding `fathom.sqlite`, `fathom-mcp.json` and `bosun/` | `src-tauri/src/lib.rs:115`, README "Where the data lives" |
| Fathom | `~/.local/share/app.fathom.board/logs/launch.log` | README "Where the data lives" |
| Fathom | `/usr/bin/fathom` when installed from the `.deb` | README "The MCP server" |
| herdr-core | `~/.local/bin/herdr-core` and `hc`; socket under `$XDG_RUNTIME_DIR/herdr-core/` | [install script](https://releases.herdr.dev/core/install.sh), Firstmate `docs/hc-backend.md` |
| Claude Code | `~/.local/bin/claude`, `~/.local/share/claude/`, `~/.claude/`, `~/.claude.json` | [setup](https://code.claude.com/docs/en/setup), [settings](https://code.claude.com/docs/en/settings) |
| Claude Code | `~/.claude/.credentials.json` (mode `0600`) holds the sign-in on Linux | [authentication](https://code.claude.com/docs/en/authentication) |
| Firstmate | `~/Documents/firstmate/` and its gitignored `config/`, `data/`, `state/`, `projects/` | Firstmate `README.md` |

## 3. Install system packages

These are the packages Fathom's README and CI install on Debian and Ubuntu (README "Requirements", `.github/workflows/check.yml:21`):

```sh
sudo apt-get update
sudo apt-get install -y build-essential curl wget file pkg-config libxdo-dev libssl-dev \
  libayatana-appindicator3-dev librsvg2-dev libwebkit2gtk-4.1-dev git jq
```

You need these to build Fathom.
To only run a shared `.deb`, apt installs its runtime libraries for you; the stock Tauri `.deb` depends on `libwebkit2gtk-4.1-0` and `libgtk-3-0` ([Tauri Debian](https://v2.tauri.app/distribute/debian/)).
For Fedora and Arch package names, see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) and add `pkg-config` and `fontconfig-devel` or `fontconfig` (untested).

## 4. Make sure `~/.local/bin` is on PATH

Fathom finds `herdr-core`, `claude` and `tasks-axi` by asking your login shell for its `PATH` once at start-up (`src-tauri/src/shell_path.rs:55`, `README.md:327`).
On Ubuntu, `~/.profile` adds `~/.local/bin` when the folder exists at log-in (untested).
To be sure:

```sh
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.profile
```

Log out and back in after the installs below, so the desktop session and Fathom see the new `PATH`.

## 5. Install herdr-core

```sh
curl -fsSL https://releases.herdr.dev/core/install.sh | sh
~/.local/bin/herdr-core --version
```

The install script supports Linux and macOS ([install script](https://releases.herdr.dev/core/install.sh)).
On Linux, herdr-core keeps terminals running after Fathom quits through the systemd user manager, which mainstream desktop distributions run (README "Requirements").

## 6. Install Claude Code and sign in

Claude Code supports Ubuntu 20.04 and later and Debian 10 and later, and needs a Pro, Max, Ultra, Team, Enterprise or Console account ([setup](https://code.claude.com/docs/en/setup)).

```sh
curl -fsSL https://claude.ai/install.sh | bash
~/.local/bin/claude --version
~/.local/bin/claude auth login
~/.local/bin/claude auth status --text; echo "exit $?"
```

`exit 0` means signed in ([CLI reference](https://code.claude.com/docs/en/cli-reference)).
Fathom's Bosun uses the same check (`src-tauri/src/launch.rs:294`).
On Linux the Bosun drawer shows only the `curl` install command; the Homebrew hint is macOS only (`src/components/BosunDrawer.tsx:307`).

## 7. Get Fathom

### 7a. Build from source (untested on Linux)

1. Install Rust ([Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)), then open a new terminal:

   ```sh
   curl --proto '=https' --tlsv1.2 https://sh.rustup.rs -sSf | sh
   ```

2. Install Node 22 or newer and pnpm.
   Ubuntu's own `nodejs` package is older than 22 on 24.04 (untested), so use Node's official binaries or a version manager such as fnm, then:

   ```sh
   npm install -g pnpm@11
   ```

   CI uses Node 24 and pnpm 11 (`.github/workflows/check.yml:23`).
3. Clone, check and build:

   ```sh
   git clone https://github.com/Uhan19/fathom.git ~/src/fathom
   cd ~/src/fathom
   pnpm install
   pnpm check
   pnpm release
   ```

   On Linux, `pnpm release` builds `release/<version>/Fathom_<version>_<arch>.deb` and `Fathom_<version>_<arch>.AppImage` (`scripts/release.sh:24`).
4. Install one of them:

   ```sh
   sudo apt install ./release/0.1.0/Fathom_0.1.0_amd64.deb
   ```

   or run the AppImage without installing:

   ```sh
   chmod +x release/0.1.0/Fathom_0.1.0_amd64.AppImage
   ./release/0.1.0/Fathom_0.1.0_amd64.AppImage
   ```

   On arm64 the file names end in `arm64` or `aarch64` instead (untested).

### 7b. Install a build someone shared

There is no signing or Gatekeeper step on Linux.
Copy the `.deb` or AppImage over and install it as in step 7a.4.
The build must come from a distribution with the same or an older glibc than yours, and the same CPU type.
If the AppImage does not start, Ubuntu 24.04 may need FUSE 2 with `sudo apt install libfuse2t64` (untested).

## 8. First run with Claude Code

1. Start Fathom from the app menu, or with `fathom` in a terminal for the `.deb` (`README.md:108`).
2. With no Firstmate at `~/Documents/firstmate`, the board is Fathom's own backlog and says **No tasks yet. Agents add them through Fathom's MCP server.** (`src/source.ts:65`, `src-tauri/src/settings.rs:148`).
3. The **herdr-core** dot in the header turns green once Fathom reaches the core (`src/App.tsx:261`).
4. In the chat panel, **Open a terminal** offers Claude Code and Codex and starts in your home folder.
   Click **Open Claude Code**.
5. Answer Claude Code's first-run prompts in the panel, then ask it:

   ```text
   Add a task "Try Fathom" to the Fathom backlog for project "demo".
   ```

   The card appears in the **Seabed** row under **demo** (README "The MCP server").
6. Open Bosun with **Ctrl+J** or the **Bosun** button, click **Start Bosun**, and ask **Switch to dark mode** (README "Bosun").

Settings for this mode: leave **Firstmate home**, **Chat terminal label**, **Session** and **Socket** empty; set **Agent folder** to where Claude Code should work (README "Settings").
The chat font defaults to JetBrains Mono on Linux, which Fathom bundles (`README.md:375`).
In the chat panel, paste with Ctrl+Shift+V or Shift+Insert; Ctrl+V reaches the program as a control key (`README.md:462`).

## 9. First run with Firstmate

1. Install the GitHub CLI and sign in (untested; Ubuntu ships `gh` in its archive, and GitHub documents its own apt repository):

   ```sh
   sudo apt-get install -y gh
   gh auth login
   ```

2. Clone Firstmate where Fathom looks for it, and select the hc backend so crewmates run where Fathom can see them (Firstmate `README.md` "Quick Start", Firstmate `docs/configuration.md` "Backend selection order"):

   ```sh
   git clone https://github.com/kunchenguid/firstmate ~/Documents/firstmate
   mkdir -p ~/Documents/firstmate/config
   echo hc > ~/Documents/firstmate/config/backend
   ```

3. Start the first mate once in a terminal and approve the toolchain installs it offers: node, git, gh, no-mistakes, gh-axi, chrome-devtools-axi, tasks-axi, quota-axi, plus hc, jq and treehouse for the hc backend (Firstmate `docs/configuration.md` "Toolchain", `bin/fm-backend.sh` `fm_backend_required_tools`).

   ```sh
   cd ~/Documents/firstmate
   claude
   ```

4. Check the wrapper Fathom reads tasks through:

   ```sh
   ~/Documents/firstmate/bin/fm-tasks-axi.sh list
   ```

5. Log out and back in, then start Fathom.
   The board now shows Firstmate's tasks (`src-tauri/src/settings.rs:148`).
6. In the chat panel pick **Firstmate** and click **Open Firstmate**.
   Fathom starts plain `claude` in the Firstmate home (README "Opening a terminal").
7. When the first mate starts a crewmate, a sailor appears on its card; click it to watch the crewmate (README "Crewmate indicator").
   This needs `backend=hc` in `state/<task id>.meta` and the same herdr-core session in Fathom and Firstmate, which is `default` for both when left empty (`src-tauri/src/workers.rs:14`).

## 10. It is working when you see

- [ ] The **herdr-core** dot is green.
- [ ] Claude Code mode: **Open Claude Code** runs Claude Code in the panel, and a card it adds appears on the board.
- [ ] Firstmate mode: the board matches `bin/fm-tasks-axi.sh list`, **Open Firstmate** runs the first mate, and crewmates show sailors.
- [ ] **Ctrl+J** opens Bosun, its dot turns green, and **Switch to dark mode** works.
- [ ] After quitting and reopening Fathom, the chat terminal and Bosun are found again.

## 11. Troubleshooting

**`pnpm install` or `cargo` fails with a missing `webkit2gtk-4.1`, `fontconfig` or `pkg-config`.**
Install the packages in step 3; `pkg-config` and the WebKitGTK 4.1 development package are both needed.

**"herdr-core is not installed or not on PATH" or "Claude Code is not installed or not on PATH".**
Fathom started from the app menu uses your login shell's `PATH`, read once at start-up.
Run `bash -l -i -c 'command -v herdr-core claude'` (or your own shell) to see what Fathom sees, fix `~/.profile`, log out and back in, and start Fathom again.

**The AppImage does nothing or complains about FUSE.**
Install FUSE 2 (`libfuse2t64` on Ubuntu 24.04) or use the `.deb` (untested).

**"GLIBC_2.xx not found" when starting a shared build.**
It was built on a newer distribution than yours.
Build it yourself, or ask for a build made on Ubuntu 22.04 or Debian 12 ([Tauri Debian](https://v2.tauri.app/distribute/debian/)).

**Terminals vanish when Fathom quits.**
herdr-core relies on the systemd user manager to outlive Fathom (README "Requirements").
Check `systemctl --user status` works in your session.

**A blank or white window (untested).**
WebKitGTK on some GPU and Wayland setups draws nothing.
Try starting Fathom with `WEBKIT_DISABLE_DMABUF_RENDERER=1 fathom` (untested), and report the distribution and GPU.

**No sailor on Firstmate tasks, or the board shows Fathom's backlog instead of Firstmate's.**
See the troubleshooting section of [macos-firstmate.md](macos-firstmate.md); the causes are the same on Linux.

## 12. Start over

- VM: revert to a snapshot or reinstall.
- Test user: `sudo deluser --remove-home fathomtest`, and `sudo apt remove fathom` if you installed the `.deb` (untested package name).
