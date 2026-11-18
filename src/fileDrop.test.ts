/// <reference types="node" />
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { droppedPathsText, escapedPath } from "./fileDrop";

const AWKWARD_PATHS = [
  "/Users/demo/notes.md",
  "/Users/demo/My Files/report (final).pdf",
  "/Users/demo/it's \"quoted\" & $HOME `x` !1 #2 *?[a]{b,c}~^|;<>.txt",
  "/Users/demo/back\\slash\tand tab",
  "/Users/demo/Café 日本/émoji 🐳.png",
];

const SHELLS = ["/bin/sh", "/bin/bash", "/bin/zsh"];
const INSTALLED_SHELLS = SHELLS.filter((shell) => existsSync(shell));

function wordsThroughShell(shell: string, text: string): string[] {
  const out = execFileSync(shell, ["-c", `for word in ${text}; do printf '%s\\0' "$word"; done`], { encoding: "utf8" });
  return out.split("\0").slice(0, -1);
}

describe("dropped file paths", () => {
  it("leaves plain paths alone", () => {
    expect(escapedPath("/Users/demo/src/main.rs")).toBe("/Users/demo/src/main.rs");
  });

  it("escapes spaces and shell characters with a backslash", () => {
    expect(escapedPath("/Users/demo/My Files/report (final).pdf")).toBe("/Users/demo/My\\ Files/report\\ \\(final\\).pdf");
  });

  it("keeps letters outside ASCII as they are", () => {
    expect(escapedPath("/Users/demo/Café/日本.txt")).toBe("/Users/demo/Café/日本.txt");
  });

  it("separates several paths with spaces and ends with one", () => {
    expect(droppedPathsText(["/a b", "/c"])).toBe("/a\\ b /c ");
    expect(droppedPathsText([])).toBe("");
  });

  it("finds a POSIX shell to read back with", () => {
    expect(INSTALLED_SHELLS).toContain("/bin/sh");
  });

  it.each(INSTALLED_SHELLS)("reads back as the original paths in %s", (shell) => {
    expect(wordsThroughShell(shell, droppedPathsText(AWKWARD_PATHS))).toEqual(AWKWARD_PATHS);
  });
});
