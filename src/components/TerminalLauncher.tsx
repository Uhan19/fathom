import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { launchErrorText } from "../agents";
import { api, errorText, type LauncherFolders, type ProjectFolder, type ShellTab, type Terminal } from "../api";
import { attachChoices, attachName, launcherLeft, launcherShortcutLabel, shortPath } from "../terminalTabs";

const OTHER = "other";
const HOME_KEY = "home";
const ANCHOR_GAP = 6;
const projectKey = (project: ProjectFolder) => `project:${project.column}`;

interface TerminalLauncherProps {
  mac: boolean;
  tabs: ShellTab[];
  chatTerminal: string | null;
  anchorRef: RefObject<HTMLElement | null>;
  onOpened: (tab: ShellTab) => void;
  onClose: (refocus: boolean) => void;
}

async function chooseFolder(): Promise<string | null> {
  const picked = await open({ directory: true, title: "Choose the folder to open a terminal in" });
  return typeof picked === "string" ? picked : null;
}

export function TerminalLauncher({ mac, tabs, chatTerminal, anchorRef, onOpened, onClose }: TerminalLauncherProps) {
  const [folders, setFolders] = useState<LauncherFolders | null>(null);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [terminals, setTerminals] = useState<Terminal[] | null>(null);
  const [terminalError, setTerminalError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [place, setPlace] = useState({ left: 0, top: 0 });
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    api
      .launcherFolders()
      .then((f) => alive && setFolders(f))
      .catch((e) => alive && setFolderError(errorText(e)));
    api
      .attachableTerminals()
      .then((t) => alive && setTerminals(t))
      .catch((e) => alive && setTerminalError(errorText(e)));
    return () => {
      alive = false;
    };
  }, []);

  useLayoutEffect(() => {
    const pop = popRef.current;
    const anchor = anchorRef.current;
    const panel = pop?.offsetParent;
    if (!pop || !anchor || !panel) return;
    const a = anchor.getBoundingClientRect();
    const p = panel.getBoundingClientRect();
    setPlace({ left: launcherLeft(a.left - p.left, p.width), top: a.bottom - p.top + ANCHOR_GAP });
    pop.focus();
  }, [anchorRef]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose(true);
    };
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!popRef.current?.contains(target) && !anchorRef.current?.contains(target)) onClose(false);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onPointer, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onPointer, true);
    };
  }, [anchorRef, onClose]);

  const run = async (key: string, task: () => Promise<ShellTab | null>) => {
    setBusy(key);
    setError(null);
    try {
      const tab = await task();
      if (tab) onOpened(tab);
      else setBusy(null);
    } catch (e) {
      setError(launchErrorText(e));
      setBusy(null);
    }
  };

  const openProject = (project: ProjectFolder) => {
    const path = project.path;
    if (path) return void run(projectKey(project), () => api.openShell(path));
    void run(projectKey(project), async () => {
      const folder = await chooseFolder();
      if (!folder) return null;
      await api.rememberColumnFolder(project.column, folder);
      return api.openShell(folder);
    });
  };

  return (
    <div ref={popRef} className="launcher" data-part="launcher" role="dialog" aria-label="Open a terminal" tabIndex={-1} style={place}>
      <LauncherMenu
        folders={folders}
        folderError={folderError}
        terminals={terminals && attachChoices(terminals, tabs, chatTerminal)}
        terminalError={terminalError}
        busy={busy}
        error={error}
        shortcut={launcherShortcutLabel(mac)}
        onProject={openProject}
        onHome={(home) => void run(HOME_KEY, () => api.openShell(home))}
        onOther={() => void run(OTHER, async () => {
          const folder = await chooseFolder();
          return folder ? api.openShell(folder) : null;
        })}
        onAttach={(terminal) => void run(terminal.address, () => api.attachShellTab(terminal.address))}
      />
    </div>
  );
}

interface LauncherMenuProps {
  folders: LauncherFolders | null;
  folderError: string | null;
  terminals: Terminal[] | null;
  terminalError: string | null;
  busy: string | null;
  error: string | null;
  shortcut: string;
  onProject: (project: ProjectFolder) => void;
  onHome: (home: string) => void;
  onOther: () => void;
  onAttach: (terminal: Terminal) => void;
}

export function LauncherMenu({ folders, folderError, terminals, terminalError, busy, error, shortcut, onProject, onHome, onOther, onAttach }: LauncherMenuProps) {
  const home = folders?.home ?? "";
  const item = (control: string, key: string, name: string, detail: string | null, onPick: () => void) => (
    <li key={key} data-key={key}>
      <button
        className="launcher-item"
        data-part="launcher-item"
        data-control={control}
        disabled={busy !== null}
        aria-busy={busy === key}
        onClick={onPick}
      >
        <span className="launcher-name" data-part="launcher-name">{name}</span>
        {(detail || busy === key) && <span className="launcher-path" data-part="launcher-path">{busy === key ? "Opening…" : detail}</span>}
      </button>
    </li>
  );
  return (
    <>
      <section className="launcher-section" data-part="launcher-section" aria-label="Open a terminal in">
        <span className="sech" data-part="sech">Open a terminal in</span>
        {folderError && <p className="error-text" data-part="error-text">{folderError}</p>}
        {!folders && !folderError && <p className="launcher-note" data-part="launcher-note">Listing folders…</p>}
        <ul className="launcher-list" data-part="launcher-list">
          {folders?.projects.map((p) => item("launcher-folder", projectKey(p), p.name, p.path ? shortPath(p.path, home) : "Choose folder…", () => onProject(p)))}
          {folders && item("launcher-folder", HOME_KEY, "Home", "~", () => onHome(folders.home))}
          {item("launcher-folder", OTHER, "Other folder…", null, onOther)}
        </ul>
      </section>
      <section className="launcher-section" data-part="launcher-section" aria-label="Or attach a running terminal">
        <span className="sech" data-part="sech">Or attach a running terminal</span>
        {terminalError && <p className="error-text" data-part="error-text">{terminalError}</p>}
        {!terminals && !terminalError && <p className="launcher-note" data-part="launcher-note">Listing terminals…</p>}
        {terminals?.length === 0 && <p className="launcher-note" data-part="launcher-note">No other terminals are running.</p>}
        <ul className="launcher-list" data-part="launcher-list">
          {terminals?.map((t) => item("launcher-attach", t.address, attachName(t), [t.address, shortPath(t.cwd, home)].filter(Boolean).join(" · "), () => onAttach(t)))}
        </ul>
      </section>
      {error && (
        <p className="launcher-error error-text" data-part="launcher-error" role="alert">
          {error}
        </p>
      )}
      <footer className="launcher-foot" data-part="launcher-foot">{shortcut} opens this from anywhere</footer>
    </>
  );
}
