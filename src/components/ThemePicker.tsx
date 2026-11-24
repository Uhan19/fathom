import { useEffect, useState } from "react";
import { api, errorText, events } from "../api";
import { comboLabel } from "../shortcuts";
import { NAUTICAL_ID, type ThemeList, type ThemeSummary } from "../themes/contract";
import { resetShortcut } from "../themes/reset";

const DUPLICATE_NAME = "Nautical copy";

export function themeChoiceText(theme: ThemeSummary): string {
  switch (theme.status) {
    case "builtIn":
      return `${theme.name} (built in)`;
    case "ready":
      return theme.name;
    case "readyWithChanges":
      return `${theme.name} (last checked version)`;
    case "failed":
      return `${theme.name} (check failed: ${theme.problems === 1 ? "1 problem" : `${theme.problems} problems`})`;
    case "unchecked":
      return `${theme.name} (not checked yet)`;
  }
}

interface ThemePickerProps {
  value: string;
  mac: boolean;
  onChange: (id: string) => void;
}

export function ThemePicker({ value, mac, onChange }: ThemePickerProps) {
  const [list, setList] = useState<ThemeList | null>(null);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .listThemes()
        .then((next) => alive && setList(next))
        .catch((e) => alive && setNote({ text: errorText(e), error: true }));
    void load();
    const unlisten = events.themes(() => void load());
    return () => {
      alive = false;
      void unlisten.then((fn) => fn());
    };
  }, []);

  const themes = list?.themes ?? [];

  const duplicate = async () => {
    try {
      const id = await api.duplicateNautical(DUPLICATE_NAME);
      setNote({ text: `Copied Nautical into ${id}. Fathom checks it in a moment; edit its theme.css to make it your own.`, error: false });
      setList(await api.listThemes());
    } catch (e) {
      setNote({ text: errorText(e), error: true });
    }
  };

  return (
    <>
      <div className="field-pair" data-part="field-pair">
        <label className="field" data-part="field">
          <span>Theme</span>
          <select className="text-input" data-part="text-input" data-control="settings-theme" value={value} onChange={(e) => onChange(e.target.value)}>
            {themes.length === 0 && <option value={NAUTICAL_ID}>Nautical (built in)</option>}
            {themes.map((theme) => (
              <option key={theme.id} value={theme.id} disabled={theme.id !== value && !theme.usable}>
                {themeChoiceText(theme)}
              </option>
            ))}
          </select>
        </label>
        <div className="theme-actions" data-part="theme-actions">
          <button type="button" className="btn" data-part="button" data-control="settings-theme-duplicate" onClick={() => void duplicate()}>
            Duplicate Nautical
          </button>
          <button type="button" className="btn" data-part="button" data-control="settings-themes-folder" onClick={() => void api.revealThemes()}>
            Open themes folder
          </button>
        </div>
      </div>
      <small className="field-note" data-part="field-note">
        Themes live in {list ? <code>{list.folder}</code> : "the themes folder"}. Fathom checks each change before using it. {comboLabel(resetShortcut(mac), mac)}{" "}
        always goes back to Nautical.
      </small>
      {note && (
        <p className={note.error ? "error-text" : "ok-text"} data-part={note.error ? "error-text" : "ok-text"}>
          {note.text}
        </p>
      )}
    </>
  );
}
