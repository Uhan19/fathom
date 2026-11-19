import { useEffect, useState } from "react";
import { captureKeys } from "../keyCapture";
import {
  ACTION_NAMES,
  afterStep,
  clearShortcut,
  comboKeys,
  comboLabel,
  defaultShortcuts,
  heldKeys,
  recordingHint,
  recordStep,
  refusalText,
  resetShortcut,
  SHORTCUT_ACTIONS,
  startRecording,
  type Recording,
  type ShortcutAction,
  type Shortcuts,
} from "../shortcuts";
import { Close } from "./Icons";

interface ShortcutsSectionProps {
  shortcuts: Shortcuts;
  mac: boolean;
  onChange: (shortcuts: Shortcuts) => void;
}

export function ShortcutsSection({ shortcuts, mac, onChange }: ShortcutsSectionProps) {
  const [recording, setRecording] = useState<Recording | null>(null);

  useEffect(() => {
    if (!recording) return;
    return captureKeys((e) => {
      if (e.type === "keyup") {
        setRecording({ ...recording, held: heldKeys(e, mac) });
        return;
      }
      const next = afterStep(shortcuts, recording, recordStep(e, recording.action, shortcuts, mac));
      if (next.shortcuts !== shortcuts) onChange(next.shortcuts);
      setRecording(next.recording);
    });
  }, [recording, shortcuts, mac, onChange]);

  return (
    <div className="shortcuts">
      {SHORTCUT_ACTIONS.map((action) => (
        <ShortcutRow
          key={action}
          action={action}
          combo={shortcuts[action]}
          defaultCombo={defaultShortcuts(mac)[action]}
          recording={recording?.action === action ? recording : null}
          mac={mac}
          onRecord={() => setRecording(startRecording(action))}
          onStop={() => setRecording((r) => (r?.action === action ? null : r))}
          onClear={() => onChange(clearShortcut(shortcuts, action))}
          onReset={() => onChange(resetShortcut(shortcuts, action, mac))}
        />
      ))}
    </div>
  );
}

interface ShortcutRowProps {
  action: ShortcutAction;
  combo: string;
  defaultCombo: string;
  recording: Recording | null;
  mac: boolean;
  onRecord: () => void;
  onStop: () => void;
  onClear: () => void;
  onReset: () => void;
}

export function ShortcutRow({ action, combo, defaultCombo, recording, mac, onRecord, onStop, onClear, onReset }: ShortcutRowProps) {
  const name = ACTION_NAMES[action];
  const refused = recording?.refused ?? null;
  const shown = recording ? (recording.held.length > 0 ? recording.held : refused ? comboKeys(refused.combo, mac) : []) : comboKeys(combo, mac);
  const keyClass = ["shortcut-key", recording && "recording", refused && recording?.held.length === 0 && "refused"].filter(Boolean).join(" ");
  const label = combo ? comboLabel(combo, mac) : "no shortcut";
  const idle = recording === null;
  const canClear = idle && combo !== "";
  const canReset = idle && combo !== defaultCombo;
  return (
    <div className="shortcut-row">
      <span className="shortcut-name">{name}</span>
      <button
        type="button"
        className={keyClass}
        aria-label={`${name}: ${label}. Press to record a new shortcut.`}
        aria-pressed={!idle}
        onClick={onRecord}
        onBlur={onStop}
      >
        {shown.length > 0 ? shown.map((key, i) => <kbd key={i}>{key}</kbd>) : <span className="shortcut-empty">{idle ? "None" : "Press keys…"}</span>}
      </button>
      <span className="shortcut-tools">
        <button
          type="button"
          className={canClear ? "ico" : "ico unused"}
          onClick={onClear}
          aria-label={`Clear the shortcut for ${name}`}
          aria-hidden={!canClear}
          title="Clear"
          tabIndex={canClear ? 0 : -1}
        >
          <Close />
        </button>
        <button
          type="button"
          className={canReset ? "mini" : "mini unused"}
          onClick={onReset}
          aria-label={`Reset ${name} to ${comboLabel(defaultCombo, mac)}`}
          aria-hidden={!canReset}
          title={`Reset to ${comboLabel(defaultCombo, mac)}`}
          tabIndex={canReset ? 0 : -1}
        >
          Reset
        </button>
      </span>
      {recording && (
        <small className={refused ? "shortcut-note error-text" : "shortcut-note"} role="status">
          {refused ? `${refusalText(refused.refusal, refused.combo, mac)} Press another, or Esc to cancel.` : recordingHint(mac)}
        </small>
      )}
    </div>
  );
}
