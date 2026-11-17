export const TERMINAL_FONT = '"SF Mono", Menlo, Monaco, monospace';
export const MAX_FONT_SIZE = 13;
export const MIN_FONT_SIZE = 7;

let probe: CanvasRenderingContext2D | null = null;

export function charWidthPerPixel(): number {
  probe ??= document.createElement("canvas").getContext("2d");
  if (!probe) return 0.6;
  probe.font = `100px ${TERMINAL_FONT}`;
  return probe.measureText("W".repeat(10)).width / 1000;
}

export function fitFontSize(availableWidth: number, cols: number, widthPerPixel: number): number {
  if (cols <= 0 || availableWidth <= 0) return MAX_FONT_SIZE;
  const exact = availableWidth / (cols * widthPerPixel);
  const stepped = Math.floor(exact * 2) / 2;
  return Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, stepped));
}
