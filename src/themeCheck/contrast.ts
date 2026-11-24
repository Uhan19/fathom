export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export const MIN_CONTRAST = 3;

const CHANNELS = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/;

export function parseColor(text: string): Rgba | null {
  const value = text.trim();
  if (value === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  const m = value.match(CHANNELS);
  if (!m) return paintedColor(value);
  const alpha = m[4] === undefined ? 1 : m[4].endsWith("%") ? Number(m[4].slice(0, -1)) / 100 : Number(m[4]);
  return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: alpha };
}

let pen: CanvasRenderingContext2D | null | undefined;

function paintedColor(value: string): Rgba | null {
  if (typeof document === "undefined" || !CSS.supports("color", value)) return null;
  pen ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!pen) return null;
  pen.clearRect(0, 0, 1, 1);
  pen.fillStyle = value;
  pen.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = pen.getImageData(0, 0, 1, 1).data;
  return { r, g, b, a: a / 255 };
}

export function over(top: Rgba, bottom: Rgba): Rgba {
  const a = top.a + bottom.a * (1 - top.a);
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
  const mix = (t: number, b: number) => (t * top.a + b * bottom.a * (1 - top.a)) / a;
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a };
}

function luminance({ r, g, b }: Rgba): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(text: Rgba, background: Rgba): number {
  const solidBackground = over(background, { r: 255, g: 255, b: 255, a: 1 });
  const solidText = over(text, solidBackground);
  const [light, dark] = [luminance(solidText), luminance(solidBackground)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}
