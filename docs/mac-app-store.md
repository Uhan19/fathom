# Distributing Fathom to other Macs: Mac App Store or direct download

## Short answer

**Fathom cannot go on the Mac App Store as it works today.**
Store apps must run in Apple's App Sandbox, and a sandboxed app cannot run programs outside its own bundle or container.
Fathom's core job is running programs the user installed: herdr-core, Claude Code, the login shell and Firstmate's scripts.
Each of those would have to be dropped or moved inside the app, which would make it a different product.

**Recommendation: ship Fathom outside the store, signed with a Developer ID certificate, notarized by Apple, as a `.dmg`, with an optional Homebrew cask and the Tauri updater.**
That costs the same Apple Developer Program membership (99 USD per year), needs no App Review and no sandbox, and installs without Gatekeeper warnings.
Steps for that path are in section 5.

Every rule below is quoted from the official page named next to it, read in November 2026.

## 1. What the Mac App Store requires

### Account and cost

- Membership in the Apple Developer Program costs "99 USD per membership year" ([enroll](https://developer.apple.com/programs/enroll/)).
- An individual needs an Apple Account with two-factor authentication and must be of the age of majority.
  An organization needs a D-U-N-S Number and must be a legal entity; trade names (DBAs) are not accepted ([enroll](https://developer.apple.com/programs/enroll/)).
- Fee waivers exist for nonprofits, schools and government bodies ([enroll](https://developer.apple.com/programs/enroll/)).
- A free Apple Account cannot use Certificates, Identifiers & Profiles or notarization ([compare memberships](https://developer.apple.com/support/compare-memberships/)).

### Signing and packaging

- Store builds are signed with an **Apple Distribution** certificate and uploaded as an installer package signed with a **Mac Installer Distribution** certificate ([Tauri App Store](https://v2.tauri.app/distribute/app-store/), [Tauri macOS signing](https://v2.tauri.app/distribute/sign/macos/)).
- Apps "must be packaged and submitted using technologies provided in Xcode; no third-party installers allowed" and must be "self-contained, single app installation bundles and cannot install code or resources in shared locations" (guideline 2.4.5(ii), [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)).
- Tauri's store flow adds a provisioning profile (`embedded.provisionprofile`), an `Entitlements.plist` with `com.apple.security.app-sandbox`, `com.apple.application-identifier` and `com.apple.developer.team-identifier`, and `ITSAppUsesNonExemptEncryption` in `Info.plist`.
  It builds with `pnpm tauri build --bundles app --target universal-apple-darwin`, wraps the app with `xcrun productbuild --sign "<Mac Installer Distribution identity>" --component <app> /Applications <pkg>`, and uploads with `xcrun altool --upload-app --type macos` ([Tauri App Store](https://v2.tauri.app/distribute/app-store/)).

### Sandbox and entitlements

- "To distribute a macOS app through the Mac App Store, you must enable the App Sandbox capability" ([App Sandbox](https://developer.apple.com/documentation/security/app-sandbox)).
- Store apps "must be appropriately sandboxed, and follow macOS File System Documentation" (2.4.5(i), [guidelines](https://developer.apple.com/app-store/review/guidelines/)).
- In the sandbox "the system restricts your app's file system access to just its container", plus files and folders the user picks in an open or save panel ([configuring the sandbox](https://developer.apple.com/documentation/xcode/configuring-the-macos-app-sandbox)).
- "Your app can't run programs in locations outside its app bundle, sandbox container, or app group containers using the entitlements to access user-selected files" ([accessing files from the sandbox](https://developer.apple.com/documentation/security/accessing-files-from-the-macos-app-sandbox)).
- A child process started with `posix_spawn` or `NSTask` can only inherit its parent's sandbox: "a child target must use exactly two App Sandbox entitlement keys: com.apple.security.app-sandbox and com.apple.security.inherit. If you specify any other App Sandbox entitlement, the system aborts the child process" ([entitlement key reference, archived](https://developer.apple.com/library/archive/documentation/Miscellaneous/Reference/EntitlementKeyReference/Chapters/EnablingAppSandbox.html)).
  Helper tools must be embedded in the bundle and signed with that inherit entitlement ([embedding a helper tool](https://developer.apple.com/documentation/xcode/embedding-a-helper-tool-in-a-sandboxed-app)).
- Temporary exception entitlements must each be justified to App Review, and workarounds for missing sandbox features need a Feedback Assistant bug ID ([App Sandbox information](https://developer.apple.com/help/app-store-connect/reference/app-uploads/app-sandbox-information)).

### Other review rules that matter for Fathom

- 2.4.5(iii): apps "may not auto-launch or have other code run automatically at startup or login without consent nor spawn processes that continue to run without consent after a user has quit the app."
- 2.4.5(iv): apps "may not download or install standalone apps, kexts, additional code, or resources to add functionality or significantly change the app from what we see during the review process."
- 2.4.5(vii): apps "must use the Mac App Store to distribute updates; other update mechanisms are not allowed."
- 2.5.2: apps "may not read or write data outside the designated container area, nor may they download, install, or execute code which introduces or changes features or functionality of the app, including other apps."
- 4.2.3(i): an app "should work on its own without requiring installation of another app to function."
  This wording came from a summary of the page and was not checked word for word.

All from the [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/).

### Review and timeline

- Apple says it reviews "at least 50% of submissions in less than 24 hours and 90% in less than 48 hours" ([App Review](https://developer.apple.com/distribute/app-review/)).
- Enrollment itself can take longer for organizations because of the D-U-N-S check (untested; no official figure was found).
- Store apps are not notarized; notarization is for Developer ID software ([notarizing macOS software](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)).

## 2. What Fathom does, checked against those rules

| What Fathom does | Where in the code | Rule it runs into | What would have to change |
| --- | --- | --- | --- |
| Runs `herdr-core` (or `hc`) from the user's PATH for every terminal | `src-tauri/src/herdr.rs:14`, `src-tauri/src/herdr.rs:508`, `src-tauri/src/herdr.rs:605` | Sandboxed apps cannot run programs outside the bundle or container; children only inherit the sandbox | Bundle herdr-core inside Fathom as a sandboxed helper. Its terminals would then also be sandboxed, so `claude` and every shell command inside them would be blocked from the user's files and tools. |
| Starts agents (`claude`, `codex`) through the user's login shell | `src-tauri/src/launch.rs:163`, `src-tauri/src/launch.rs:309` | Same as above, plus 2.5.2 (executing code that changes functionality, including other apps) | No path in the sandbox. An inherited sandbox would stop Claude Code reading the user's projects, writing `~/.claude`, or running git. |
| Reads the login shell's PATH by running `$SHELL -l -i -c` | `src-tauri/src/shell_path.rs:55` | Running `/bin/zsh` from the sandbox gives a sandboxed shell that cannot read the user's dotfiles outside the container (untested) | Drop it; nothing outside the bundle could be run anyway. |
| Checks Claude Code sign-in with `claude auth status` | `src-tauri/src/launch.rs:294` | Running a program outside the bundle | Drop Bosun's Claude Code check, or Bosun itself. |
| Reads a Firstmate home (default `~/Documents/firstmate`) and runs its `bin/fm-tasks-axi.sh` | `src-tauri/src/settings.rs:13`, `src-tauri/src/tasks.rs:141` | Files outside the container need a user-selected folder; even then, "Your app can't run programs" there | The Firstmate board would need Fathom to parse Firstmate's files itself instead of running its script, after the user picks the folder in an open panel (with a security-scoped bookmark to keep access). |
| Watches Firstmate's `state/` folder and reads crewmates' `state/<id>.meta` | `src-tauri/src/watch.rs:73`, `src-tauri/src/workers.rs:58` | Container-only file access | Covered by the same user-selected folder and bookmark (untested). |
| Writes `fathom-mcp.json` pointing Claude Code at Fathom's own binary (`fathom --mcp`) | `src-tauri/src/state.rs:326`, `src-tauri/src/launch.rs:38` | The MCP server would be started by Claude Code, outside Fathom's sandbox, reading Fathom's database inside the container | Possible only if the database moved to an app group container both could reach; in practice blocked because Claude Code itself cannot be started. |
| Terminals and Bosun keep running after Fathom quits, and Fathom finds them again | `README.md:411`, `README.md:36` | 2.4.5(iii): no processes that continue "without consent after a user has quit the app" | Ask for consent, or stop every terminal on quit, which removes a core feature. |
| Expects the user to install herdr-core and Claude Code separately | `README.md:13`, `src/agents.ts:48` | 4.2.3(i): should work without installing another app | Bundle herdr-core; Claude Code cannot be bundled. |
| Updates by the user installing a newer build | `scripts/release.sh` | 2.4.5(vii): updates only through the store | Fine for a store build; no in-app updater. |

Parts that would pass: the board UI, Fathom's own SQLite backlog inside the container, the font menus (system fonts are readable), the clipboard and the open dialog the capability file already allows (`src-tauri/capabilities/default.json`).
Those alone are a task board with no terminals and no agents.

## 3. What a store version could be

A store version would be a separate, reduced product: a board over Fathom's own backlog with no chat panel, no Bosun, no crewmate sailors, and a Firstmate board only if Fathom learned to read Firstmate's files directly from a folder the user picks.
Agents could still fill the backlog only if an MCP server outside the sandbox could reach the database, which needs an app group container and a separately distributed helper (untested design).
That is a lot of work for a weaker app, and it would still need the full version to be distributed outside the store.

## 4. Developer ID, notarization and a DMG compared with the store

| | Mac App Store | Developer ID + notarization + DMG |
| --- | --- | --- |
| Account | Apple Developer Program, 99 USD per year | Same |
| Sandbox | Required | Not required |
| Runs the user's CLIs and reads the home folder | No | Yes, as today |
| Review | App Review for every version, usually within 48 hours | Automated notarization, "typically takes less than an hour" ([customizing notarization](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow)); "Notarization of macOS software is not App Review" ([notarizing](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)) |
| Gatekeeper on first open | No warning | No warning once notarized and stapled |
| Updates | Store only (2.4.5(vii)) | Your choice: Tauri updater, Homebrew, or a new download |
| Discovery | Store search and listing | Your website, GitHub releases, Homebrew |

Today's builds are signed ad hoc (`signingIdentity "-"`, `src-tauri/tauri.conf.json`).
Tauri notes that ad hoc signing "does not prevent MacOS from requiring users to whitelist the installation" ([Tauri macOS signing](https://v2.tauri.app/distribute/sign/macos/)), which is why a shared build today needs **Open Anyway** in System Settings > Privacy & Security ([Apple support](https://support.apple.com/en-us/102445)).
"Beginning in macOS 10.15, all software built after June 1, 2019, and distributed with Developer ID must be notarized" ([notarizing](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)).

## 5. Steps for the recommended path

All steps are **(untested)** for Fathom; they follow Apple's and Tauri's docs.

### 5.1 Enroll and get a certificate

1. Enroll in the Apple Developer Program at https://developer.apple.com/programs/enroll/.
2. As the Account Holder, create a **Developer ID Application** certificate in Certificates, Identifiers & Profiles; only the Account Holder can create Developer ID certificates ([Developer ID](https://developer.apple.com/developer-id/)).
3. Install it in the login keychain and find its name:

   ```sh
   security find-identity -v -p codesigning
   ```

   It looks like `Developer ID Application: <Name> (<TEAMID>)` ([Tauri macOS signing](https://v2.tauri.app/distribute/sign/macos/)).

### 5.2 Store notarization credentials

Either an App Store Connect API key (`APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_KEY_PATH`) or an Apple ID with an app-specific password (`APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`) works with Tauri ([Tauri macOS signing](https://v2.tauri.app/distribute/sign/macos/)).
For manual runs, keep them in the keychain ([customizing notarization](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow)):

```sh
xcrun notarytool store-credentials "notarytool-password" --apple-id "<AppleID>" --team-id <TEAMID> --password <app-specific-password>
```

### 5.3 Build, sign and notarize with Tauri

1. Remove `"signingIdentity": "-"` from `src-tauri/tauri.conf.json`, or set it to the Developer ID name.
   Tauri also reads `APPLE_SIGNING_IDENTITY`, and `APPLE_CERTIFICATE` with `APPLE_CERTIFICATE_PASSWORD` on CI ([Tauri macOS signing](https://v2.tauri.app/distribute/sign/macos/)).
2. Notarization requires the hardened runtime, valid signatures on every executable, and no `com.apple.security.get-task-allow` entitlement ([notarizing](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)).
   The hardened runtime blocks things like JIT unless an entitlement allows them ([hardened runtime](https://developer.apple.com/documentation/security/hardened-runtime)); check that the WebView and terminals still work after signing.
3. Build a DMG with the signing and notarization variables set ([Tauri DMG](https://v2.tauri.app/distribute/dmg/)):

   ```sh
   export APPLE_SIGNING_IDENTITY="Developer ID Application: <Name> (<TEAMID>)"
   export APPLE_API_ISSUER=<issuer-id> APPLE_API_KEY=<key-id> APPLE_API_KEY_PATH=<path-to-.p8>
   pnpm tauri build --bundles app,dmg
   ```

   `scripts/release.sh` builds only `--bundles app` today (`scripts/release.sh:18`) and would need `dmg` added.
4. To build one download for both Apple Silicon and Intel, add `--target universal-apple-darwin` ([Tauri App Store](https://v2.tauri.app/distribute/app-store/) shows the flag); today's release is host-architecture only.
5. If notarizing by hand instead, zip with `ditto -c -k --keepParent Fathom.app Fathom.zip`, then:

   ```sh
   xcrun notarytool submit Fathom.zip --keychain-profile "notarytool-password" --wait
   xcrun stapler staple Fathom.app
   ```

   `xcrun notarytool log <submission-id> --keychain-profile "notarytool-password" developer_log.json` explains a rejection ([customizing notarization](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow)).
   The notary service accepts ZIP archives, disk images and signed flat installer packages.
6. Check the result (this command is not from the pages cited above):

   ```sh
   spctl --assess --type execute --verbose Fathom.app
   ```

### 5.4 Publish

Attach the DMG to a GitHub release; the repository has no releases yet.

### 5.5 Optional: a Homebrew cask in your own tap

Homebrew's main cask repository wants apps that "pass Homebrew's Gatekeeper checks", which a notarized build does ([acceptable casks](https://docs.brew.sh/Acceptable-Casks)).
A personal tap is faster to start with ([taps](https://docs.brew.sh/How-to-Create-and-Maintain-a-Tap)):

```sh
brew tap-new <github-user>/homebrew-tap
```

Add `Casks/fathom.rb` with the required stanzas `version`, `sha256`, `url`, `name`, `desc`, `homepage` and `app "Fathom.app"` ([Cask Cookbook](https://docs.brew.sh/Cask-Cookbook)), push the tap, and users run:

```sh
brew tap <github-user>/tap
brew install --cask fathom
```

### 5.6 Optional: in-app updates with the Tauri updater

From [Tauri updater](https://v2.tauri.app/plugin/updater/):

1. `pnpm tauri add updater`.
2. `pnpm tauri signer generate -w ~/.tauri/fathom.key` and keep the private key safe; losing it means installed copies can never update again.
3. Set `bundle.createUpdaterArtifacts: true` and `plugins.updater.pubkey` and `endpoints` in `tauri.conf.json`, and add `updater:default` to the capability file.
4. Build with `TAURI_SIGNING_PRIVATE_KEY` set and publish a `latest.json` with `version`, and per platform (for example `darwin-aarch64`) a `signature` and `url`.

This also works for the Linux AppImage.

## 6. Recommendation

Distribute Fathom outside the Mac App Store.
The sandbox rules in section 1 block the features that make Fathom useful: running herdr-core and the user's agents, reading the Firstmate home and running its scripts, and keeping terminals alive after quit.
Developer ID signing plus notarization removes the Gatekeeper warning users see today, keeps every feature, and needs no review per release.
Ship it as a DMG on GitHub releases first, then add a Homebrew tap and the Tauri updater once there is a regular release rhythm.
