import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api, errorText, ROW_ORDER, type DataInfo, type RowKey, type Settings } from "../api";
import {
  appearanceOf,
  BOARD_FONT_SIZES,
  BOARD_FONTS,
  CHAT_FONT_SIZES,
  CHAT_FONTS,
  type Appearance,
  type FontChoice,
} from "../appearance";
import { formatBytes } from "../board";
import { Close } from "./Icons";

interface SettingsDialogProps {
  settings: Settings;
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

export function SettingsDialog({ settings, rowNames, onPreview, onSaved, onClose }: SettingsDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(settings);
  const [names, setNames] = useState(rowNames);
  const [data, setData] = useState<DataInfo | null>(null);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    dialogRef.current?.showModal();
    api.dataInfo().then(setData).catch(() => setData(null));
  }, []);

  const field = (key: keyof Settings) => ({
    value: draft[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, [key]: e.target.value }),
  });

  const look = <K extends keyof Appearance>(key: K, value: Appearance[K]) => {
    const next = { ...draft, [key]: value };
    setDraft(next);
    onPreview(appearanceOf(next));
  };

  const save = async () => {
    setSaving(true);
    try {
      for (const row of ROW_ORDER) {
        if (names[row] !== rowNames[row]) await api.setRowName(row, names[row]);
      }
      onSaved(await api.saveSettings(draft));
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
              <small>Fathom reads tasks through bin/fm-tasks-axi.sh in this folder and never writes there.</small>
            </label>
          </fieldset>
          <fieldset>
            <legend>herdr-core</legend>
            <label className="field">
              <span>Chat terminal label</span>
              <input className="text-input mono" {...field("terminalLabel")} spellCheck={false} />
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
            <div className="field-pair">
              <FontSelect label="Chat font" fonts={CHAT_FONTS} value={draft.chatFont} onChange={(v) => look("chatFont", v)} />
              <SizeSelect
                label="Chat size"
                sizes={CHAT_FONT_SIZES}
                value={draft.chatFontSize}
                onChange={(v) => look("chatFontSize", v)}
              />
            </div>
            <div className="field-pair">
              <FontSelect label="Board font" fonts={BOARD_FONTS} value={draft.boardFont} onChange={(v) => look("boardFont", v)} />
              <SizeSelect
                label="Board size"
                sizes={BOARD_FONT_SIZES}
                value={draft.boardFontSize}
                onChange={(v) => look("boardFontSize", v)}
              />
            </div>
            <small className="field-note">Changes show at once; Save keeps them, Cancel puts them back.</small>
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

function FontSelect({ label, fonts, value, onChange }: SelectProps<string> & { fonts: FontChoice[] }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select className="text-input" value={value} onChange={(e) => onChange(e.target.value)}>
        {fonts.map((font) => (
          <option key={font.key} value={font.key}>
            {font.name}
          </option>
        ))}
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
