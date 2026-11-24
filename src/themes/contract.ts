import type { Theme as Mode } from "../theme";

export const NAUTICAL_ID = "nautical";

export type ChatSide = "left" | "right";
export type BoardShape = "rows" | "lanes";
export type HeaderPlace = "top" | "bottom" | "rail";
export type DetailPlace = "side" | "overlay";

export interface ThemeFonts {
  body?: string;
  heading?: string;
  mono?: string;
  terminal?: string;
}

export interface ThemeText {
  brand?: string;
  helper?: string;
  projects?: string;
  surfaceLead?: string;
  shallowsLead?: string;
}

export interface ThemeArt {
  brandMark?: string;
  sailor?: string;
  sailorActive?: string;
}

export interface ThemeLayout {
  chatSide?: ChatSide;
  board?: BoardShape;
  header?: HeaderPlace;
  detail?: DetailPlace;
  rowLabelWidth?: number;
  collapsedWidth?: number;
  laneWidth?: number;
  railWidth?: number;
}

export interface ThemeManifest {
  fathomTheme: number;
  name: string;
  clonedFrom?: string;
  modes?: Mode[];
  fonts?: ThemeFonts;
  text?: ThemeText;
  art?: ThemeArt;
  layout?: ThemeLayout;
}

export interface ActiveTheme {
  id: string;
  version: string;
  base: string;
  manifest: ThemeManifest;
}

export type ThemeStatus = "builtIn" | "ready" | "readyWithChanges" | "failed" | "unchecked";

export interface ThemeSummary {
  id: string;
  name: string;
  modes: Mode[];
  status: ThemeStatus;
  problems: number;
  usable: boolean;
  folder?: string;
  clonedFrom?: string;
}

export interface ThemeList {
  folder: string;
  themes: ThemeSummary[];
}
