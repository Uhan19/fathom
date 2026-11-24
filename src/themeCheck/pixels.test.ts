import { describe, expect, it } from "vitest";
import { ground, luminances, ratioOf, spread, type Pixels } from "./pixels";

function image(width: number, height: number, paint: (x: number, y: number) => number): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = paint(x, y);
      data.set([v, v, v, 255], (y * width + x) * 4);
    }
  }
  return { width, height, scale: 1, data };
}

const label = image(40, 20, (x, y) => (y >= 8 && y < 12 && x >= 5 && x < 35 ? 0 : 255));
const covered = image(40, 20, () => 20);
const box = { left: 0, top: 0, width: 40, height: 20 };

describe("measuring what is painted", () => {
  it("reads luminance per pixel and scales the box to device pixels", () => {
    expect(luminances(label, box)).toHaveLength(800);
    expect(luminances({ ...label, scale: 2 }, { left: 0, top: 0, width: 10, height: 5 })).toHaveLength(200);
    expect(luminances(label, { left: 0, top: 0, width: 1, height: 1 })[0]).toBeCloseTo(1, 5);
  });

  it("sees black text on white as ink and an even fill as nothing", () => {
    expect(spread(luminances(label, box))).toBeCloseTo(21, 0);
    expect(spread(luminances(covered, box))).toBeCloseTo(1, 5);
  });

  it("takes the background as the most common shade", () => {
    expect(ground(luminances(label, box))).toBeCloseTo(1, 5);
    expect(ground(luminances(covered, box))).toBeCloseTo(luminances(covered, box)[0], 5);
    expect(ratioOf(0, 1)).toBeCloseTo(21, 0);
  });
});

describe("contrast under what is painted", () => {
  const black = 0;
  const white = 1;

  it("keeps black on white at 21:1 when nothing covers it", async () => {
    const { paintedContrast } = await import("./scan");
    expect(paintedContrast({ text: black, background: white, underlaid: false }, white)).toBeCloseTo(21, 0);
  });

  it("drops to 1:1 under an opaque layer and stays readable under a light veil", async () => {
    const { paintedContrast } = await import("./scan");
    expect(paintedContrast({ text: black, background: white, underlaid: false }, 0)).toBeCloseTo(1, 5);
    expect(paintedContrast({ text: black, background: white, underlaid: false }, 0.5)).toBeGreaterThan(3);
  });

  it("measures text over a background image against the painted background", async () => {
    const { paintedContrast } = await import("./scan");
    expect(paintedContrast({ text: white, background: white, underlaid: true }, black)).toBeCloseTo(21, 0);
  });
});
