export const SYMBOLS_FAMILY = "Symbols Nerd Font Mono";
const ICON_AND_POWERLINE_ARROW = "\uf179\ue0b0";

let ready: Promise<void> | null = null;

export function symbolsFontReady(fonts: Pick<FontFaceSet, "load"> = document.fonts): Promise<void> {
  ready ??= fonts.load(`16px "${SYMBOLS_FAMILY}"`, ICON_AND_POWERLINE_ARROW).then(
    () => undefined,
    () => undefined,
  );
  return ready;
}
