import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SRC = new URL("../", import.meta.url);
const GUIDE = readFileSync(new URL("../../docs/themes.md", import.meta.url), "utf8");
const STYLES = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

const components = (): string =>
  ["App.tsx", ...readdirSync(new URL("components/", SRC)).map((f) => `components/${f}`)]
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => readFileSync(new URL(f, SRC), "utf8"))
    .join("\n");

const listed = (heading: string): Set<string> => {
  const start = GUIDE.indexOf(`### ${heading}`);
  const block = GUIDE.slice(GUIDE.indexOf("```text", start) + 7, GUIDE.indexOf("```", GUIDE.indexOf("```text", start) + 7));
  return new Set(block.split(/\s+/).filter(Boolean));
};

describe("the theme guide", () => {
  it("lists every named part the components render", () => {
    const parts = new Set([...components().matchAll(/data-part="([a-z0-9-]+)"/g)].map((m) => m[1]));
    const missing = [...parts].filter((p) => !listed("Part names").has(p));
    expect(missing).toEqual([]);
  });

  it("lists every control id the components render", () => {
    const controls = new Set([...components().matchAll(/data-control="([a-z0-9-]+)"/g)].map((m) => m[1]));
    const missing = [...controls].filter((c) => !listed("Control ids").has(c));
    expect(missing).toEqual([]);
  });

  it("lists every token the app defines", () => {
    const tokens = new Set([...STYLES.matchAll(/^\s+(--[a-z0-9-]+):/gm)].map((m) => m[1]));
    const missing = [...tokens].filter((t) => !listed("Token names").has(t));
    expect(missing).toEqual([]);
  });
});
