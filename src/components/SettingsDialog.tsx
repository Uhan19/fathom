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
import { Close } from "./Icons";
import { ShortcutsSection } from "./ShortcutsSection";
import { withLatestWindow } from "../windowSettings";

interface SettingsDialogProps {
  settings: Settings;
  mac: boolean;
  rowNames: Record<RowKey, string>;
  onPreview: (appearance: Appearance) => void;
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

export function SettingsDialog({ settings, mac, rowNames, onPreview, onSaved, onClose }: SettingsDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(settings);
  const [names, setNames] = useState(rowNames);
  const [data, setData] = useState<DataInfo | null>(null);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState<Surface | null>(null);
  const installed = useInstalledFonts(picking !== null, api.installedFonts);

  useEffect(() => {
    dialogRef.current?.showModal();
    api.dataInfo().then(setData).catch(() => setData(null));
  }, []);

  const field = (key: "home" | "terminalLabel" | "hcSession" | "hcSocket" | "agentFolder") => ({
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
    return (
      <>
        <div className="field-pair">
          <FontSelect
            label={`${title} font`}
            fonts={surfaceFonts(appearance, surface)}
            value={draft[fontKey]}
            onChange={(v) => look(fontKey, v)}
            onAdd={() => setPicking(surface)}
          />
          <SizeSelect
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
      onSaved(await api.saveSettings(withLatestWindow(draft, settings)));
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
    <dialog ref={dialogRef} className="settings" onCancel={onClose} aria-label="Settings">
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="settings-head">
          <h2>Settings</h2>
          <button type="button" className="ico" onClick={onClose} aria-label="Close settings">
            <Close />
          </button>
        </div>
        <div className="settings-body">
          <fieldset>
            <legend>Firstmate</legend>
            <label className="field">
              <span>Firstmate home</span>
              <input className="text-input mono" {...field("home")} spellCheck={false} autoFocus />
              <small>
                Fathom reads tasks through bin/fm-tasks-axi.sh in this folder and never writes there. Leave it empty to use Fathom's own
                backlog.
              </small>
            </label>
          </fieldset>
          <fieldset>
            <legend>herdr-core</legend>
            <label className="field">
              <span>Chat terminal label</span>
              <input className="text-input mono" {...field("terminalLabel")} spellCheck={false} />
              <small>Leave it empty for the default: firstmate.role=primary on a Firstmate home, fathom.role=chat on Fathom's backlog.</small>
            </label>
            <label className="field">
              <span>Agent folder</span>
              <input className="text-input mono" {...field("agentFolder")} spellCheck={false} />
              <small>Claude Code and Codex terminals that Fathom opens start in this folder. Leave it empty for your home folder.</small>
            </label>
            <div className="field-pair">
              <label className="field">
                <span>Session</span>
                <input className="text-input mono" {...field("hcSession")} placeholder="hc default" spellCheck={false} />
              </label>
              <label className="field">
                <span>Socket</span>
                <input className="text-input mono" {...field("hcSocket")} placeholder="hc default" spellCheck={false} />
              </label>
            </div>
          </fieldset>
          <fieldset>
            <legend>Appearance</legend>
            {fontRow("chat")}
            {fontRow("board")}
            <small className="field-note">Changes show at once; Save keeps them, Cancel puts them back.</small>
          </fieldset>
          <fieldset>
            <legend>Shortcuts</legend>
            <ShortcutsSection shortcuts={draft.shortcuts} mac={mac} onChange={(shortcuts) => setDraft({ ...draft, shortcuts })} />
            <small className="field-note">Click a shortcut and press the new keys. They work everywhere in Fathom, terminals included.</small>
          </fieldset>
          <fieldset>
            <legend>Row names</legend>
            <div className="row-names">
              {ROW_ORDER.map((row) => (
                <label key={row} className="field">
                  <span>{DEFAULT_ROW_NAMES[row]}</span>
                  <input
                    className="text-input"
                    value={names[row]}
                    onChange={(e) => setNames({ ...names, [row]: e.target.value })}
                  />
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>Your data</legend>
            <p className="data-line">
              {data ? (
                <>
                  <b>{formatBytes(data.bytes)}</b> in <code>{data.path}</code>
                </>
              ) : (
                "Measuring…"
              )}
            </p>
            <button type="button" className="btn" onClick={() => void exportAll()}>
              Export as JSON and CSV…
            </button>
          </fieldset>
          {note && <p className={note.error ? "error-text" : "ok-text"}>{note.text}</p>}
        </div>
        <div className="settings-foot">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-dark" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

interface SelectProps<T> {
  label: string;
  value: T;
  onChange: (value: T) => void;
}

const ADD_FONT_OPTION = "add-font";

function FontSelect({ label, fonts, value, onChange, onAdd }: SelectProps<string> & { fonts: FontChoice[]; onAdd: () => void }) {
  const option = (font: FontChoice) => (
    <option key={font.key} value={font.key}>
      {font.name}
    </option>
  );
  const added = fonts.filter((f) => f.added);
  const selected = fonts.some((f) => f.key === value) ? value : fonts[0].key;
  return (
    <label className="field">
      <span>{label}</span>
      <select
        className="text-input"
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

function SizeSelect({ label, sizes, value, onChange }: SelectProps<number> & { sizes: number[] }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select className="text-input" value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {sizes.map((size) => (
          <option key={size} value={size}>
            {size} px
          </option>
        ))}
      </select>
    </label>
  );
}
