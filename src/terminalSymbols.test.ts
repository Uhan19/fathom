import { existsSync, readdirSync, readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { addFont, chatFontStack, presetFonts, type Appearance, type Platform } from "./appearance";
import { SYMBOLS_FAMILY, symbolsFontReady } from "./terminalSymbols";

const PUBLIC = new URL("../public", import.meta.url);
const FONT_DIR = new URL("../public/fonts/symbols-nerd-font/", import.meta.url);
const PROMPT_GLYPHS = { appleLogo: 0xf179, clock: 0xf017, octiconClock: 0xf43a, mdClock: 0xf0954, powerlineArrow: 0xe0b0, roundCap: 0xe0b6 };

const base: Appearance = { chatFont: "sf-mono", chatFontSize: 13, boardFont: "default", boardFontSize: 14, chatAddedFonts: [], boardAddedFonts: [] };

function readBase128(bytes: Buffer, at: { pos: number }): number {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    const byte = bytes[at.pos++];
    value = value * 128 + (byte & 0x7f);
    if (!(byte & 0x80)) return value;
  }
  throw new Error("bad UIntBase128");
}

const GLYF = 10;
const LOCA = 11;
const CMAP = 0;

function woff2Cmap(file: Buffer): Buffer {
  expect(file.toString("latin1", 0, 4)).toBe("wOF2");
  const numTables = file.readUInt16BE(12);
  const compressedSize = file.readUInt32BE(20);
  const at = { pos: 48 };
  const tables: { index: number; length: number }[] = [];
  for (let i = 0; i < numTables; i++) {
    const flags = file[at.pos++];
    const index = flags & 0x3f;
    if (index === 63) at.pos += 4;
    const version = flags >> 6;
    const origLength = readBase128(file, at);
    const transformed = index === GLYF || index === LOCA ? version === 0 : version !== 0;
    tables.push({ index, length: transformed ? readBase128(file, at) : origLength });
  }
  const data = brotliDecompressSync(file.subarray(at.pos, at.pos + compressedSize));
  let offset = 0;
  for (const table of tables) {
    if (table.index === CMAP) return data.subarray(offset, offset + table.length);
    offset += table.length;
  }
  throw new Error("no cmap table");
}

function coveredBy(cmap: Buffer): (codepoint: number) => boolean {
  const records = Array.from({ length: cmap.readUInt16BE(2) }, (_, i) => cmap.readUInt32BE(4 + i * 8 + 4));
  const format12 = records.find((offset) => cmap.readUInt16BE(offset) === 12);
  if (format12 === undefined) throw new Error("no format 12 cmap");
  const groups = Array.from({ length: cmap.readUInt32BE(format12 + 12) }, (_, i) => {
    const g = format12 + 16 + i * 12;
    return { start: cmap.readUInt32BE(g), end: cmap.readUInt32BE(g + 4), glyph: cmap.readUInt32BE(g + 8) };
  });
  return (cp) => groups.some((g) => cp >= g.start && cp <= g.end && g.glyph + (cp - g.start) !== 0);
}

const fontFaces = () => [...readFileSync(new URL("./styles.css", import.meta.url), "utf8").matchAll(/@font-face \{[^}]*\}/g)].map((m) => m[0]).filter((rule) => rule.includes(SYMBOLS_FAMILY));

describe("terminal font stacks", () => {
  it("end with the bundled symbols font for every preset and added font on both platforms", () => {
    for (const platform of ["macos", "linux"] as Platform[]) {
      const withAdded = addFont(base, "chat", "Iosevka Term");
      const keys = [...presetFonts("chat", platform).map((f) => f.key), withAdded.chatFont];
      for (const chatFont of keys) {
        expect(chatFontStack({ ...withAdded, chatFont }, platform)).toMatch(/, "Symbols Nerd Font Mono"$/);
      }
    }
  });
});

describe("bundled symbols font", () => {
  const faces = fontFaces();
  const url = faces[0]?.match(/url\("([^"]+)"\)/)?.[1] ?? "";
  const file = readFileSync(new URL(`.${url}`, `${PUBLIC.href}/`));
  const covers = coveredBy(woff2Cmap(file));

  it("is a shipped woff2 that every face loads", () => {
    expect(faces).toHaveLength(2);
    expect(url).toMatch(/^\/fonts\/symbols-nerd-font\/.+\.woff2$/);
    for (const face of faces) {
      expect(face).toContain(`url("${url}") format("woff2")`);
      expect(face).toMatch(/font-display: block/);
    }
  });

  it("draws the icons of a Nerd Font prompt", () => {
    for (const [name, cp] of Object.entries(PROMPT_GLYPHS)) expect([name, covers(cp)]).toEqual([name, true]);
  });

  it("never draws ordinary text", () => {
    for (let cp = 0x20; cp < 0x7f; cp++) expect(covers(cp)).toBe(false);
  });

  it("keeps Powerline glyphs full height and fits every other icon into one cell", () => {
    const [powerline, icons] = faces;
    expect(powerline).toMatch(/unicode-range: U\+E0A0-E0A3, U\+E0B0-E0D7;/);
    expect(powerline).not.toMatch(/size-adjust/);
    expect(icons).toMatch(/unicode-range: U\+0-E09F, U\+E0A4-E0AF, U\+E0D8-10FFFF;/);
    expect(icons).toMatch(/size-adjust: 60%/);
  });

  it("ships the license of every icon set next to the font", () => {
    const readme = readFileSync(new URL("README.md", FONT_DIR), "utf8");
    expect(readme).toContain("releases/download/v3.5.1/NerdFontsSymbolsOnly.zip");
    expect(existsSync(new URL("LICENSE", FONT_DIR))).toBe(true);
    const shipped = readdirSync(new URL("licenses/", FONT_DIR)).sort();
    const listed = [...new Set([...readme.matchAll(/`licenses\/([^`]+)`/g)].map((m) => m[1]))].sort();
    expect(listed).toEqual(shipped);
  });
});

describe("symbols font loading", () => {
  it("loads an icon and a Powerline glyph once before terminals open, and never blocks them on failure", async () => {
    vi.resetModules();
    const { symbolsFontReady: ready } = await import("./terminalSymbols");
    const load = vi.fn().mockRejectedValue(new Error("offline"));
    await expect(ready({ load })).resolves.toBeUndefined();
    await ready({ load });
    expect(load).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledWith('16px "Symbols Nerd Font Mono"', "\uf179\ue0b0");
    expect(symbolsFontReady).toBeTypeOf("function");
  });
});
