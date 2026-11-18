import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { agentChoices, chatTitle, findingText, initialAgent, launchErrorText, missingToolText, type AgentKey } from "./agents";
import type { SourceKind, Terminal } from "./api";
import { OpenTerminal } from "./components/OpenTerminal";

const terminal = (agent: string, labels: Record<string, string> = {}): Terminal => ({
  address: "t4",
  name: "",
  title: "",
  state: "live",
  cwd: "/work",
  agent,
  labels,
  cols: 80,
  rows: 24,
});

const opener = (source: SourceKind, agent: AgentKey, error: string | null = null) =>
  renderToStaticMarkup(
    createElement(OpenTerminal, { source, agent, folder: "/home/demo", opening: false, error, onAgent: () => {}, onOpen: () => {} }),
  );

describe("agent choices", () => {
  it("offers Firstmate only on a Firstmate board", () => {
    expect(agentChoices("fathom")).toEqual(["claude", "codex"]);
    expect(agentChoices("firstmate")).toEqual(["claude", "codex", "firstmate"]);
  });

  it("starts from the remembered pick when the board offers it", () => {
    expect(initialAgent("fathom", "codex")).toBe("codex");
    expect(initialAgent("fathom", "firstmate")).toBe("claude");
    expect(initialAgent("fathom", null)).toBe("claude");
    expect(initialAgent("firstmate", null)).toBe("firstmate");
    expect(initialAgent("firstmate", "claude")).toBe("claude");
  });
});

describe("chatTitle", () => {
  it("names the picked agent on a backlog board, never Firstmate", () => {
    expect(chatTitle("fathom", null, "codex")).toBe("Codex");
    expect(chatTitle("fathom", null, "claude")).toBe("Claude Code");
    expect(chatTitle("fathom", terminal("claude", { "fathom.agent": "firstmate" }), "claude")).toBe("Claude Code");
    expect(chatTitle("fathom", terminal("claude", { "firstmate.role": "primary" }), "codex")).toBe("Claude Code");
    expect(chatTitle("fathom", terminal("zsh"), "codex")).toBe("Agent");
  });

  it("follows the agent label Fathom put on the terminal", () => {
    expect(chatTitle("fathom", terminal("node", { "fathom.agent": "codex" }), "claude")).toBe("Codex");
    expect(chatTitle("firstmate", terminal("claude", { "fathom.agent": "claude" }), "firstmate")).toBe("Claude Code");
    expect(chatTitle("firstmate", terminal("claude", { "fathom.agent": "firstmate" }), "codex")).toBe("Firstmate");
  });

  it("keeps the Firstmate wording on a Firstmate board", () => {
    expect(chatTitle("firstmate", null, "codex")).toBe("Firstmate");
    expect(chatTitle("firstmate", terminal("claude", { "firstmate.role": "primary" }), "claude")).toBe("Firstmate");
    expect(findingText("firstmate", "firstmate.role=primary")).toBe("Looking for Firstmate's terminal (firstmate.role=primary)…");
    expect(findingText("fathom", "fathom.role=chat")).toBe("Looking for the chat terminal (fathom.role=chat)…");
  });
});

describe("launch errors", () => {
  it("names the missing tool", () => {
    expect(launchErrorText({ kind: "missing", tool: "herdr-core" })).toBe(missingToolText("herdr-core"));
    expect(missingToolText("herdr-core")).toContain("herdr-core is not installed or not on PATH");
    expect(launchErrorText({ kind: "missing", tool: "codex" })).toBe(
      "Codex is not installed or not on PATH. Fathom looked for the codex command.",
    );
    expect(launchErrorText({ kind: "missing", tool: "claude" })).toBe(
      "Claude Code is not installed or not on PATH. Fathom looked for the claude command.",
    );
  });

  it("passes other failures through", () => {
    expect(launchErrorText({ kind: "failed", message: "the working folder /gone does not exist" })).toBe(
      "the working folder /gone does not exist",
    );
    expect(launchErrorText(new Error("boom"))).toBe("boom");
    expect(launchErrorText("plain")).toBe("plain");
  });
});

describe("OpenTerminal", () => {
  it("offers Claude Code and Codex on a backlog board with the pick checked", () => {
    const html = opener("fathom", "codex");
    expect(html).toContain('aria-label="Open a terminal"');
    expect(html).toContain('<button role="radio" aria-checked="false" class="agent-choice">Claude Code</button>');
    expect(html).toContain('<button role="radio" aria-checked="true" class="agent-choice on">Codex</button>');
    expect(html).not.toContain("Firstmate");
    expect(html).toContain("Open Codex");
    expect(html).toContain("<code>/home/demo</code>");
  });

  it("adds Firstmate on a Firstmate board", () => {
    const html = opener("firstmate", "firstmate");
    expect(html).toContain('<button role="radio" aria-checked="true" class="agent-choice on">Firstmate</button>');
    expect(html).toContain("Starts in the Firstmate home <code>/home/demo</code>.");
    expect(html).toContain("Open Firstmate");
  });

  it("shows the missing-tool message", () => {
    const html = opener("fathom", "claude", missingToolText("claude"));
    expect(html).toContain('<p class="error-text" role="alert">Claude Code is not installed or not on PATH.');
  });
});
