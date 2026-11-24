import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api, errorText, ROW_ORDER, type DataInfo, type RowKey, type Settings } from "../api";
import {
  addFont,
  appearanceOf,
  BOARD_FONT_SIZES,
  CHAT_FONT_SIZES,
  removeFont,
  surfaceFonts,
  type Appearance,
  type FontChoice,
  type Surface,
} from "../appearance";
import { formatBytes } from "../board";
import { FontPicker, useInstalledFonts } from "./FontPicker";
import { AppVersion } from "./AppVersion";
import { Close } from "./Icons";
import { ShortcutsSection } from "./ShortcutsSection";
import { withLatestWindow } from "../windowSettings";
import type { Look } from "../themes/look";
import { ThemePicker } from "./ThemePicker";

interface SettingsDialogProps {
  settings: Settings;
  mac: boolean;
  rowNames: Record<RowKey, string>;
  look: Look;
  onPreview: (appearance: Appearance) => void;
  onPreviewTheme: (id: string | null) => void;
  onSaved: (settings: Settings) => void;
  onClose: () => void;
}

const DEFAULT_ROW_NAMES: Record<RowKey, string> = {
  surface: "Surface",
  shallows: "Shallows",
  deep: "Deep",
  seabed: "Seabed",
  landed: "Landed",
};

export function SettingsDialog({ settings, mac, rowNames, look: theme, onPreview, onPreviewTheme, onSaved, onClose }: SettingsDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const homeRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(settings);
  const opened = useRef(settings);
  const [names, setNames] = useState(rowNames);
  const [prefixes, setPrefixes] = useState(settings.ticketPrefixes.join(", "));
  const [data, setData] = useState<DataInfo | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState<Surface | null>(null);
  const installed = useInstalledFonts(picking !== null, api.installedFonts);

  useEffect(() => {
    dialogRef.current?.showModal();
    homeRef.current?.focus();
    api.dataInfo().then(setData).catch(() => setData(null));
    api.appVersion().then(setVersion).catch(() => setVersion(null));
  }, []);

  const field = (key: "home" | "terminalLabel" | "hcSession" | "hcSocket" | "agentFolder" | "linearWorkspace") => ({
    value: draft[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, [key]: e.target.value }),
  });

  const appearance = appearanceOf(draft);

  const restyle = (next: Appearance) => {
    setDraft({ ...draft, ...next });
    onPreview(next);
  };

  const look = <K extends keyof Appearance>(key: K, value: Appearance[K]) => restyle({ ...appearance, [key]: value });

  const fontRow = (surface: Surface) => {
    const fontKey = surface === "chat" ? "chatFont" : "boardFont";
    const sizeKey = surface === "chat" ? "chatFontSize" : "boardFontSize";
    const title = surface === "chat" ? "Chat" : "Board";
    const setByTheme = surface === "chat" ? !!theme.fonts.terminal : !!(theme.fonts.body || theme.fonts.heading);
    return (
      <>
        <div className="field-pair" data-part="field-pair">
          <FontSelect
            control={`settings-${surface}-font`}
            label={`${title} font`}
            fonts={surfaceFonts(appearance, surface)}
            value={draft[fontKey]}
            setByTheme={setByTheme}
            onChange={(v) => look(fontKey, v)}
            onAdd={() => setPicking(surface)}
          />
          <SizeSelect
            control={`settings-${surface}-font-size`}
            label={`${title} size`}
            sizes={surface === "chat" ? CHAT_FONT_SIZES : BOARD_FONT_SIZES}
            value={draft[sizeKey]}
            onChange={(v) => look(sizeKey, v)}
          />
        </div>
        {picking === surface && (
          <FontPicker
            surface={surface}
            families={installed.families}
            error={installed.error}
            added={surface === "chat" ? draft.chatAddedFonts : draft.boardAddedFonts}
            onAdd={(family) => {
              restyle(addFont(appearance, surface, family));
              setPicking(null);
            }}
            onRemove={(family) => restyle(removeFont(appearance, surface, family))}
            onClose={() => setPicking(null)}
          />
        )}
      </>
    );
  };

  const save = async () => {
    setSaving(true);
    try {
      for (const row of ROW_ORDER) {
        if (names[row] !== rowNames[row]) await api.setRowName(row, names[row]);
      }
      const ticketPrefixes = prefixes.split(/[\s,]+/).filter(Boolean);
      const themeId = draft.themeId === opened.current.themeId ? settings.themeId : draft.themeId;
      onSaved(await api.saveSettings(withLatestWindow({ ...draft, ticketPrefixes, themeId }, settings)));
    } catch (e) {
      setNote({ text: errorText(e), error: true });
      setSaving(false);
    }
  };

  const exportAll = async () => {
    try {
      const directory = await open({ directory: true, title: "Choose where to write the export" });
      if (typeof directory !== "string") return;
      const written = await api.exportData(directory);
      setNote({ text: `Exported to ${written}`, error: false });
    } catch (e) {
      setNote({ text: errorText(e), error: true });
    }
  };

  return (
    <dialog ref={dialogRef} className="settings" data-part="settings-dialog" onCancel={onClose} aria-label="Settings">
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="settings-head" data-part="settings-head">
          <h2 data-part="settings-title">Settings</h2>
          <button type="button" className="ico" data-part="icon-button" data-control="settings-close" onClick={onClose} aria-label="Close settings">
            <Close />
          </button>
        </div>
        <div className="settings-body" data-part="settings-body">
          <fieldset data-part="settings-section" data-kind="firstmate">
            <legend data-part="settings-legend">Firstmate</legend>
            <label className="field" data-part="field">
              <span>Firstmate home</span>
              <input className="text-input mono" data-part="text-input" data-kind="mono" data-control="settings-home" {...field("home")} ref={homeRef} spellCheck={false} />
              <small>
                Fathom reads tasks through bin/fm-tasks-axi.sh in this folder and never writes there. Leave it empty to use Fathom's own
                backlog.
              </small>
            </label>
          </fieldset>
          <fieldset data-part="settings-section" data-kind="ticket-links">
            <legend data-part="settings-legend">Ticket links</legend>
            <div className="field-pair" data-part="field-pair">
              <label className="field" data-part="field">
                <span>Linear workspace</span>
                <input className="text-input mono" data-part="text-input" data-kind="mono" data-control="settings-linear-workspace" {...field("linearWorkspace")} placeholder="your-team" spellCheck={false} />
              </label>
              <label className="field" data-part="field">
                <span>Ticket prefixes</span>
                <input
                  className="text-input mono"
                  data-part="text-input"
                  data-kind="mono"
                  data-control="settings-ticket-prefixes"
                  value={prefixes}
                  onChange={(e) => setPrefixes(e.target.value)}
                  placeholder="ENG, OPS"
                  spellCheck={false}
                />
              </label>
            </div>
            <small className="field-note" data-part="field-note">
              Card details turn bare ticket ids such as ENG-1234 into Linear links when both are set. The workspace is the name after
              linear.app/ in a ticket link. Linear and Slack links written out in full always work.
            </small>
          </fieldset>
          <fieldset data-part="settings-section" data-kind="herdr-core">
            <legend data-part="settings-legend">herdr-core</legend>
            <label className="field" data-part="field">
              <span>Chat terminal label</span>
              <input className="text-input mono" data-part="text-input" data-kind="mono" data-control="settings-terminal-label" {...field("terminalLabel")} spellCheck={false} />
              <small>Leave it empty for the default: firstmate.role=primary on a Firstmate home, fathom.role=chat on Fathom's backlog.</small>
            </label>
            <label className="field" data-part="field">
              <span>Agent folder</span>
              <input className="text-input mono" data-part="text-input" data-kind="mono" data-control="settings-agent-folder" {...field("agentFolder")} spellCheck={false} />
              <small>Claude Code and Codex terminals that Fathom opens start in this folder. Leave it empty for your home folder.</small>
            </label>
            <div className="field-pair" data-part="field-pair">
              <label className="field" data-part="field">
                <span>Session</span>
                <input className="text-input mono" data-part="text-input" data-kind="mono" data-control="settings-hc-session" {...field("hcSession")} placeholder="hc default" spellCheck={false} />
              </label>
              <label className="field" data-part="field">
                <span>Socket</span>
                <input className="text-input mono" data-part="text-input" data-kind="mono" data-control="settings-hc-socket" {...field("hcSocket")} placeholder="hc default" spellCheck={false} />
              </label>
            </div>
          </fieldset>
          <fieldset data-part="settings-section" data-kind="appearance">
            <legend data-part="settings-legend">Appearance</legend>
            <ThemePicker
              value={draft.themeId}
              mac={mac}
              onChange={(themeId) => {
                setDraft({ ...draft, themeId });
                onPreviewTheme(themeId === settings.themeId ? null : themeId);
              }}
            />
            {fontRow("chat")}
            {fontRow("board")}
            <small className="field-note" data-part="field-note">Changes show at once; Save keeps them, Cancel puts them back.</small>
          </fieldset>
          <fieldset data-part="settings-section" data-kind="shortcuts">
            <legend data-part="settings-legend">Shortcuts</legend>
            <ShortcutsSection shortcuts={draft.shortcuts} mac={mac} onChange={(shortcuts) => setDraft({ ...draft, shortcuts })} />
            <small className="field-note" data-part="field-note">Click a shortcut and press the new keys. They work everywhere in Fathom, terminals included.</small>
          </fieldset>
          <fieldset data-part="settings-section" data-kind="row-names">
            <legend data-part="settings-legend">Row names</legend>
            <div className="row-names" data-part="row-names">
              {ROW_ORDER.map((row) => (
                <label key={row} className="field" data-part="field">
                  <span>{DEFAULT_ROW_NAMES[row]}</span>
                  <input
                    className="text-input"
                    data-part="text-input"
                    data-control="settings-row-name"
                    data-key={row}
                    value={names[row]}
                    onChange={(e) => setNames({ ...names, [row]: e.target.value })}
                  />
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset data-part="settings-section" data-kind="data">
            <legend data-part="settings-legend">Your data</legend>
            <p className="data-line" data-part="data-line">
              {data ? (
                <>
                  <b>{formatBytes(data.bytes)}</b> in <code>{data.path}</code>
                </>
              ) : (
                "Measuring…"
              )}
            </p>
            <button type="button" className="btn" data-part="button" data-control="settings-export" onClick={() => void exportAll()}>
              Export as JSON and CSV…
            </button>
          </fieldset>
          {note && <p className={note.error ? "error-text" : "ok-text"} data-part={note.error ? "error-text" : "ok-text"}>{note.text}</p>}
        </div>
        <div className="settings-foot" data-part="settings-foot">
          <AppVersion version={version} />
          <button type="button" className="btn" data-part="button" data-control="settings-cancel" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-dark" data-part="button" data-kind="dark" data-control="settings-save" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

interface SelectProps<T> {
  control: string;
  label: string;
  value: T;
  onChange: (value: T) => void;
}

const ADD_FONT_OPTION = "add-font";

const SET_BY_THEME = "Set by the theme";

function FontSelect({ control, label, fonts, value, setByTheme, onChange, onAdd }: SelectProps<string> & { fonts: FontChoice[]; setByTheme: boolean; onAdd: () => void }) {
  if (setByTheme) {
    return (
      <label className="field" data-part="field">
        <span>{label}</span>
        <select className="text-input" data-part="text-input" data-control={control} value={SET_BY_THEME} disabled>
          <option value={SET_BY_THEME}>{SET_BY_THEME}</option>
        </select>
      </label>
    );
  }
  const option = (font: FontChoice) => (
    <option key={font.key} value={font.key}>
      {font.name}
    </option>
  );
  const added = fonts.filter((f) => f.added);
  const selected = fonts.some((f) => f.key === value) ? value : fonts[0].key;
  return (
    <label className="field" data-part="field">
      <span>{label}</span>
      <select
        className="text-input"
        data-part="text-input"
        data-control={control}
        value={selected}
        onChange={(e) => (e.target.value === ADD_FONT_OPTION ? onAdd() : onChange(e.target.value))}
      >
        {fonts.filter((f) => !f.added).map(option)}
        {added.length > 0 && <optgroup label="Added">{added.map(option)}</optgroup>}
        <option value={ADD_FONT_OPTION}>Add an installed font…</option>
      </select>
    </label>
  );
}

function SizeSelect({ control, label, sizes, value, onChange }: SelectProps<number> & { sizes: number[] }) {
  return (
    <label className="field" data-part="field">
      <span>{label}</span>
      <select className="text-input" data-part="text-input" data-control={control} value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {sizes.map((size) => (
          <option key={size} value={size}>
            {size} px
          </option>
        ))}
      </select>
    </label>
  );
}
