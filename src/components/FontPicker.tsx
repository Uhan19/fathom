import { useEffect, useMemo, useState } from "react";
import { cssFamily, type Surface } from "../appearance";
import { errorText } from "../api";

interface FontPickerProps {
  surface: Surface;
  families: string[] | null;
  error: string | null;
  added: string[];
  onAdd: (family: string) => void;
  onRemove: (family: string) => void;
  onClose: () => void;
}

const SURFACE_NAME: Record<Surface, string> = { chat: "chat", board: "board" };
const SAMPLE_FALLBACK: Record<Surface, string> = { chat: "ui-monospace, monospace", board: "system-ui, sans-serif" };

export function FontPicker({ surface, families, error, added, onAdd, onRemove, onClose }: FontPickerProps) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (families ?? []).filter((f) => f.toLowerCase().includes(needle));
  }, [families, query]);

  return (
    <div
      className="font-picker"
      data-part="font-picker"
      data-kind={surface}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
    >
      <div className="font-picker-head" data-part="font-picker-head">
        <span>Add an installed font to the {SURFACE_NAME[surface]}</span>
        <button type="button" className="mini" data-part="mini-button" data-control="font-picker-done" onClick={onClose}>
          Done
        </button>
      </div>
      <input
        className="text-input"
        data-part="text-input"
        data-control="font-search"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search installed fonts"
        aria-label="Search installed fonts"
        spellCheck={false}
        autoFocus
      />
      {error && <p className="error-text" data-part="error-text">{error}</p>}
      {families === null && !error && <p className="muted" data-part="muted">Listing installed fonts…</p>}
      {families && shown.length === 0 && <p className="muted" data-part="muted">No installed font matches “{query.trim()}”.</p>}
      {shown.length > 0 && (
        <ul className="font-list" data-part="font-list" aria-label="Installed fonts">
          {shown.map((family) => {
            const isAdded = added.includes(family);
            return (
              <li key={family} className="font-row" data-part="font-row" data-key={family}>
                <span className="font-sample" data-part="font-sample" style={{ fontFamily: `${cssFamily(family)}, ${SAMPLE_FALLBACK[surface]}` }}>
                  {family}
                </span>
                {isAdded ? (
                  <button type="button" className="mini" data-part="mini-button" data-control="font-remove" onClick={() => onRemove(family)} aria-label={`Remove ${family}`}>
                    Remove
                  </button>
                ) : (
                  <button type="button" className="mini" data-part="mini-button" data-control="font-add" onClick={() => onAdd(family)} aria-label={`Add ${family}`}>
                    Add
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function useInstalledFonts(wanted: boolean, load: () => Promise<string[]>) {
  const [families, setFamilies] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!wanted || families !== null || error !== null) return;
    load()
      .then(setFamilies)
      .catch((e) => setError(errorText(e)));
  }, [wanted, families, error, load]);
  return { families, error };
}
