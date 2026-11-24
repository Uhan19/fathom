import type { Theme as Mode } from "../theme";
import { NAUTICAL_ID, type ActiveTheme, type BoardShape, type ChatSide, type DetailPlace, type HeaderPlace, type ThemeFonts } from "./contract";

export interface LookText {
  brand: string;
  helper: string;
  projects: string;
  surfaceLead: string;
  shallowsLead: string;
}

export interface LookLayout {
  chatSide: ChatSide;
  board: BoardShape;
  header: HeaderPlace;
  detail: DetailPlace;
  rowLabelWidth: number;
  collapsedWidth: number;
  laneWidth: number;
  railWidth: number;
}

export interface Look {
  id: string;
  version: string;
  name: string;
  modes: Mode[];
  fonts: ThemeFonts;
  text: LookText;
  art: { brandMark?: string; sailor?: string; sailorActive?: string };
  layout: LookLayout;
  styles: string | null;
}

export const DEFAULT_TEXT: LookText = {
  brand: "FATHOM",
  helper: "Bosun",
  projects: "Projects →",
  surfaceLead: "At the ",
  shallowsLead: "In the ",
};

export const DEFAULT_LAYOUT: LookLayout = {
  chatSide: "right",
  board: "rows",
  header: "top",
  detail: "side",
  rowLabelWidth: 150,
  collapsedWidth: 44,
  laneWidth: 260,
  railWidth: 236,
};

export const BOTH_MODES: Mode[] = ["light", "dark"];

export const NAUTICAL_LOOK: Look = {
  id: NAUTICAL_ID,
  version: "",
  name: "Nautical",
  modes: BOTH_MODES,
  fonts: {},
  text: DEFAULT_TEXT,
  art: {},
  layout: DEFAULT_LAYOUT,
  styles: null,
};

const defined = <T extends object>(value: T | undefined): Partial<T> =>
  Object.fromEntries(Object.entries(value ?? {}).filter(([, v]) => v !== undefined && v !== null)) as Partial<T>;

export function lookOf(theme: ActiveTheme | null): Look {
  if (!theme || theme.id === NAUTICAL_ID) return NAUTICAL_LOOK;
  const { manifest, base } = theme;
  const asset = (file: string | undefined) => (file ? base + file : undefined);
  const modes = manifest.modes?.length ? manifest.modes : BOTH_MODES;
  return {
    id: theme.id,
    version: theme.version,
    name: manifest.name,
    modes,
    fonts: defined(manifest.fonts),
    text: { ...DEFAULT_TEXT, ...defined(manifest.text) },
    art: { brandMark: asset(manifest.art?.brandMark), sailor: asset(manifest.art?.sailor), sailorActive: asset(manifest.art?.sailorActive) },
    layout: { ...DEFAULT_LAYOUT, ...defined(manifest.layout) },
    styles: base + "theme.css",
  };
}

export function isSingleMode(look: Look): boolean {
  return look.modes.length === 1;
}

export function shownMode(look: Look, chosen: Mode): Mode {
  return look.modes.includes(chosen) ? chosen : look.modes[0];
}

export function setsFonts(look: Look): boolean {
  return Object.keys(look.fonts).length > 0;
}
