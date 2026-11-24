# Set up Fathom with your coding agent

Instead of running each install step from the [README](../README.md#requirements) yourself, you can hand the whole setup to a coding agent such as Codex or Claude Code.
Copy the block below in one go and paste it into the agent, running on the macOS or Linux computer where you want Fathom.
The agent asks you which coding agent Fathom should use, asks before every install, skips what is already there, and tells you at the end what it did and what is left for you.

````text
Set up Fathom on this computer, end to end, by following this sheet.
Fathom is a desktop board for an agent's tasks: https://github.com/Uhan19/fathom
It needs herdr-core to open agent terminals in its chat panel, and a coding agent (Codex or Claude Code) to run in them.

## Rules

- Ask the user before every install, download into a system folder, change to a config or shell profile, and every command that uses sudo.
  Show the exact command when you ask, and wait for a yes.
- Before installing anything, check whether it is already there.
  If it is, report the version you found and skip it.
- Install Firstmate only after the user says yes to it in step 8.
- Commands that need an interactive sign-in or a password prompt you cannot answer are for the user: tell them the command and continue.
- If a step fails twice, stop that step, note why, and move on to the next one if it does not depend on it.
- Keep three lists as you go: installed, skipped (with the reason), and left for the user.

## Step 1: Ask which coding agent to use

Ask the user exactly one question now: "Should Fathom use Codex or Claude Code as its coding agent?"
Call the answer AGENT: `codex` for Codex, `claude` for Claude Code.
Do not ask anything else until a step below says to.

## Step 2: Detect the system

Run:

```sh
uname -s
uname -m
```

- `Darwin` is macOS. Run `sw_vers -productVersion`; Fathom needs macOS 13 or newer. One build covers Apple Silicon and Intel.
- `Linux` with `x86_64`: run `. /etc/os-release && echo "$ID $VERSION_ID"` and `command -v apt-get`. With apt-get, use the Debian package; without it, use the AppImage.
- Any other system, including Linux on arm64: there is no ready build. Skip step 3, put "build Fathom from source as in the README's 'Build a release' section" on the left-for-the-user list, and continue with step 4.

Find the newest Fathom version:

```sh
curl -fsSLI -o /dev/null -w '%{url_effective}\n' https://github.com/Uhan19/fathom/releases/latest
```

The version is the end of the printed URL, after `/tag/v`.

## Step 3: Install Fathom

### macOS

Already installed when `/Applications/Fathom.app` exists.
Read its version with `defaults read /Applications/Fathom.app/Contents/Info CFBundleShortVersionString`.
If it matches the newest version, skip this step.
If it is older, ask whether to replace it, and ask the user to quit Fathom first.

```sh
tmp="$(mktemp -d)"
curl -fL -o "$tmp/Fathom_universal.dmg" https://github.com/Uhan19/fathom/releases/latest/download/Fathom_universal.dmg
hdiutil attach -nobrowse -readonly -mountpoint "$tmp/mnt" "$tmp/Fathom_universal.dmg"
rm -rf /Applications/Fathom.app   # only when replacing an older Fathom
ditto "$tmp/mnt/Fathom.app" /Applications/Fathom.app
hdiutil detach "$tmp/mnt"
xattr -dr com.apple.quarantine /Applications/Fathom.app
```

The build is not notarized by Apple, so macOS blocks its first open when the download mark is set.
The `xattr` line clears that mark, so Fathom opens normally.
If macOS still says "Fathom" Not Opened, tell the user to click Done, open System Settings, then Privacy & Security, scroll to Security, click Open Anyway next to "Fathom" was blocked, enter their password, and click Open Anyway again.

FATHOM_BIN is `/Applications/Fathom.app/Contents/MacOS/fathom`.

### Linux with apt-get

Already installed when `dpkg-query -W -f='${Version}\n' fathom` prints a version.
If it matches the newest version, skip this step.

```sh
tmp="$(mktemp -d)"
curl -fL -o "$tmp/Fathom_amd64.deb" https://github.com/Uhan19/fathom/releases/latest/download/Fathom_amd64.deb
chmod 755 "$tmp"
sudo apt-get install -y "$tmp/Fathom_amd64.deb"
```

apt installs the libraries Fathom needs, so no other system packages are required.
FATHOM_BIN is `/usr/bin/fathom`.

### Linux without apt-get

Already installed when `~/.local/bin/Fathom.AppImage` exists.
Replacing it with the newest download is safe while Fathom is closed.

```sh
mkdir -p ~/.local/bin
curl -fL -o ~/.local/bin/Fathom.AppImage https://github.com/Uhan19/fathom/releases/latest/download/Fathom_amd64.AppImage
chmod +x ~/.local/bin/Fathom.AppImage
command -v fusermount3 || command -v fusermount
```

The AppImage mounts itself with FUSE and uses the desktop's own graphics and font libraries, which a desktop install already has.
If the last command finds neither `fusermount3` nor `fusermount`, ask whether to install the distribution's FUSE package (see https://github.com/AppImage/AppImageKit/wiki/FUSE).
If the user declines, Fathom still runs without FUSE: then add `--appimage-extract-and-run` as the first argument wherever this sheet runs the AppImage, in step 7, step 9 and the `Exec=` line of the menu entry below.
FATHOM_BIN is `~/.local/bin/Fathom.AppImage` written as a full path.

Whether or not the AppImage was already installed, check its app menu entry: an AppImage has none of its own, so the desktop shows a generic icon for it.
Already set up when `grep -lsx 'StartupWMClass=fathom' ~/.local/share/applications/*.desktop` prints a file, for example one made by Gear Lever or AppImageLauncher.
Otherwise ask whether to add Fathom to the app menu with its icon, then copy the entry and icons out of the AppImage:

```sh
tmp="$(mktemp -d)"
(cd "$tmp" && ~/.local/bin/Fathom.AppImage --appimage-extract 'usr/share/*' >/dev/null)
mkdir -p ~/.local/share/applications ~/.local/share/icons
cp -r "$tmp/squashfs-root/usr/share/icons/." ~/.local/share/icons/
sed "s|^Exec=.*|Exec=$HOME/.local/bin/Fathom.AppImage|" "$tmp/squashfs-root/usr/share/applications/Fathom.desktop" > ~/.local/share/applications/fathom.desktop
grep -x 'Icon=fathom' ~/.local/share/applications/fathom.desktop && ls ~/.local/share/icons/hicolor/*/apps/fathom.png
```

The last command must print `Icon=fathom` and the icon files.

## Step 4: herdr-core (recommended)

Already installed when `command -v herdr-core` or `command -v hc` finds it, or `~/.local/bin/herdr-core` exists; report `herdr-core --version` and skip.
Otherwise ask: "Fathom uses herdr-core to open and keep the agent terminals in its chat panel. Install it into ~/.local/bin? (recommended)"

```sh
curl -fsSL https://releases.herdr.dev/core/install.sh | sh
~/.local/bin/herdr-core --version
```

If the user declines, note that the chat panel and Bosun cannot open terminals until herdr-core is installed.

## Step 5: The coding agent

For AGENT `claude`, Claude Code:

- Already installed when `command -v claude` finds it or `~/.local/bin/claude` exists; report `claude --version`.
- Otherwise ask, then install into `~/.local/bin`:

  ```sh
  curl -fsSL https://claude.ai/install.sh | bash
  ```

- Check the sign-in with `claude auth status --text`; exit code 0 means signed in.
  Otherwise put "run `claude` in a terminal and sign in (needs a paid Claude plan or a Claude Console account)" on the left-for-the-user list.

For AGENT `codex`, Codex:

- Already installed when `command -v codex` finds it or `~/.local/bin/codex` exists; report `codex --version`.
- Otherwise ask, then install into `~/.local/bin`:

  ```sh
  curl -fsSL https://chatgpt.com/codex/install.sh | sh
  ```

- Check the sign-in with `codex login status`; exit code 0 means signed in.
  Otherwise put "run `codex` in a terminal and choose Sign in with ChatGPT" on the left-for-the-user list.
- Mention in the report that Bosun, Fathom's helper for changing the board in plain words, runs only on Claude Code.

## Step 6: Make the tools visible to Fathom

Fathom opened from the Dock, Finder or an app menu finds herdr-core and the agent through the user's login shell, not through your environment.
Check what it will see, with AGENT in place of `<agent>`:

```sh
"${SHELL:-/bin/sh}" -l -i -c 'command -v herdr-core || command -v hc; command -v <agent>'
```

If a tool you found or installed under `~/.local/bin` is missing from the output, ask whether to add `~/.local/bin` to the login shell's PATH:

- zsh: append `export PATH="$HOME/.local/bin:$PATH"` to `~/.zprofile`.
- bash: append the same line to `~/.bash_profile` if that file exists, else to `~/.profile`.
- fish: run `fish_add_path ~/.local/bin`.

Then run the check again.

## Step 7: Register Fathom's MCP server with the agent

Fathom's binary is also an MCP server that lets an agent add and move tasks on the board.
The chat panel already hands it to the agents Fathom opens; registering it lets the agent use Fathom's board from any terminal too.
Skip this step if step 3 was skipped.

For AGENT `claude`: already registered when `claude mcp get fathom` succeeds. Otherwise ask, then run:

```sh
claude mcp add --scope user fathom -- "FATHOM_BIN" --mcp
```

For AGENT `codex`: already registered when `codex mcp get fathom` succeeds. Otherwise ask, then run:

```sh
codex mcp add fathom -- "FATHOM_BIN" --mcp
```

Replace FATHOM_BIN with the full path from step 3.

## Step 8: Firstmate (recommended)

Ask the user, in one line: "Fathom works best with Firstmate (https://github.com/kunchenguid/firstmate), which runs a crew of coding agents for you; Fathom then shows its tasks instead of its own backlog. Set it up? (recommended)"
If the answer is anything but a clear yes, skip it.
If yes: it needs git, the GitHub CLI signed in with `gh auth login`, and Claude Code (install Claude Code as in step 5 if it is missing, after asking).
Then, after asking:

```sh
git clone https://github.com/kunchenguid/firstmate ~/Documents/firstmate
mkdir -p ~/Documents/firstmate/config
echo hc > ~/Documents/firstmate/config/backend
```

Put "run `claude` in `~/Documents/firstmate` once and approve the tools it offers to install, including tasks-axi" on the left-for-the-user list.
Fathom reads Firstmate's tasks from `~/Documents/firstmate` by itself the next time it starts.

## Step 9: Check that Fathom launches and sees the agent

Skip the launch if step 3 was skipped, or if on Linux neither `DISPLAY` nor `WAYLAND_DISPLAY` is set (no desktop session); put "start Fathom" on the left-for-the-user list instead.

1. Note the line count of Fathom's launch log, which gains one line each time the board loads:
   - macOS: `~/Library/Logs/app.fathom.board/launch.log`
   - Linux: `${XDG_DATA_HOME:-$HOME/.local/share}/app.fathom.board/logs/launch.log`
2. Start Fathom:
   - macOS: `open /Applications/Fathom.app`
   - Linux with the Debian package: `nohup fathom >/dev/null 2>&1 &`
   - Linux with the AppImage: `nohup ~/.local/bin/Fathom.AppImage >/dev/null 2>&1 &`
3. Wait up to 20 seconds for the launch log to gain a line. A new line means Fathom started and drew its board.
4. Rerun the step 6 check; both tools must show.
5. If step 7 ran, `claude mcp list` or `codex mcp list` must list `fathom`.
6. Ask the user to look at Fathom: the herdr-core dot in the header should be green, and the chat panel should offer to open Claude Code or Codex.
7. On Linux, also ask the user to check that the dock or taskbar shows Fathom's icon, a white and gold disc split by a diagonal line on a dark blue tile, and that Fathom is in the app menu.
   With the AppImage and no menu entry from step 3, a generic icon is expected; put "add Fathom to the app menu as in step 3" on the left-for-the-user list.

## Step 10: Report

Finish with a short summary in three parts:

- Installed: each tool, its version and where it went.
- Skipped: each step you skipped and why (already installed, declined, not supported here).
- Left for you: each thing the user still has to do by hand, with the exact command.
````

The sheet uses the same steps as the manual instructions in the [README](../README.md#requirements), [Fathom on a clean Linux machine](linux.md) and [Fathom on a clean Mac with Firstmate](macos-firstmate.md).
