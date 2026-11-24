export interface Pixels {
  width: number;
  height: number;
  scale: number;
  data: Uint8ClampedArray;
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

const BUCKETS = 32;
const EDGE_PERCENTILE = 0.03;

const channel = (c: number) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

export const ratioOf = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

export function luminances(pixels: Pixels, box: Box): number[] {
  const x0 = Math.max(0, Math.floor(box.left * pixels.scale));
  const y0 = Math.max(0, Math.floor(box.top * pixels.scale));
  const x1 = Math.min(pixels.width, Math.ceil((box.left + box.width) * pixels.scale));
  const y1 = Math.min(pixels.height, Math.ceil((box.top + box.height) * pixels.scale));
  const out: number[] = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * pixels.width + x) * 4;
      out.push(0.2126 * channel(pixels.data[i]) + 0.7152 * channel(pixels.data[i + 1]) + 0.0722 * channel(pixels.data[i + 2]));
    }
  }
  return out;
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];
}

export function spread(values: number[]): number {
  if (values.length === 0) return 1;
  const sorted = [...values].sort((a, b) => a - b);
  return ratioOf(percentile(sorted, EDGE_PERCENTILE), percentile(sorted, 1 - EDGE_PERCENTILE));
}

export function ground(values: number[]): number {
  const counts = new Array<number>(BUCKETS).fill(0);
  const sums = new Array<number>(BUCKETS).fill(0);
  for (const v of values) {
    const b = Math.min(BUCKETS - 1, Math.floor(v * BUCKETS));
    counts[b] += 1;
    sums[b] += v;
  }
  const top = counts.indexOf(Math.max(...counts));
  return counts[top] ? sums[top] / counts[top] : 0;
}
