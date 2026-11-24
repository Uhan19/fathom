import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ROW_ORDER, type RowKey, type SourceKind, type Terminal, type Worker } from "./api";
import { CardDetail } from "./components/CardDetail";
import { AgentComposer } from "./components/DetailAgent";
import { outgoing, sendsOnKey, type Recipients } from "./composer";
import { NO_LINKING } from "./links";
import { FIXTURE_CARDS, FIXTURE_TERMINALS } from "./preview/fixture";

const ignore = () => undefined;
const rowNames = Object.fromEntries(ROW_ORDER.map((row) => [row, row])) as Record<RowKey, string>;
const card = FIXTURE_CARDS.find((c) => c.id === "atl-09")!;
const working: Worker = { taskId: card.id, terminal: "t3", status: "working" };
const idle: Worker = { ...working, status: "idle" };
const chat: Terminal = FIXTURE_TERMINALS[0];

function detail(worker: Worker | null, source: SourceKind = "firstmate") {
  return renderToStaticMarkup(
    createElement(CardDetail, {
      card,
      source,
      rowNames,
      request: null,
      waits: [],
      people: {},
      width: 460,
      chatTerminal: chat,
      worker,
      fontFamily: "monospace",
      fontSize: 13,
      theme: "light",
      linking: NO_LINKING,
      mark: "",
      onClose: ignore,
      onOpenCard: ignore,
      onResend: ignore,
      onDismiss: ignore,
    }),
  );
}

const tabNames = (html: string) => [...html.matchAll(/role="tab" id="detail-tab-(\w+)"/g)].map((m) => m[1]);
const agentTab = (html: string) => html.match(/<button[^>]*id="detail-tab-agent".*?<\/button>/)?.[0] ?? "";

describe("the Agent tab in card details", () => {
  it("shows up only while the card has a worker", () => {
    expect(tabNames(detail(working))).toEqual(["overview", "links", "files", "activity", "agent"]);
    expect(tabNames(detail(null))).toEqual(["overview", "links", "files", "activity"]);
  });

  it("wears the board card's sailor with the worker's live state and wording", () => {
    const busy = agentTab(detail(working));
    expect(busy).toContain('<span class="sailor working" data-part="detail-tab-sailor" data-state="working" aria-hidden="true">');
    expect(busy).toContain('title="A crewmate is working on this. Open its terminal"');
    expect(busy).toContain('<span class="sr-only">, working</span>');

    const resting = agentTab(detail(idle, "fathom"));
    expect(resting).toContain('<span class="sailor idle" data-part="detail-tab-sailor" data-state="idle" aria-hidden="true">');
    expect(resting).toContain('title="A worker is on this, idle. Open its terminal"');
  });

  it("names its parts and controls for themes", () => {
    const html = detail(working);
    expect(html).toContain('class="detail" data-part="detail"');
    expect(html).toContain('data-part="icon-button" data-control="close-detail"');
    expect([...html.matchAll(/data-control="detail-tab" data-key="(\w+)"/g)].map((m) => m[1])).toEqual(["overview", "links", "files", "activity", "agent"]);
    expect(html).toContain('data-part="detail-scroll" data-kind="overview"');
    expect(html).toContain('<span data-part="rich-text">');
    expect(html).toContain('data-part="text-input" data-control="card-message"');
  });

  it("keeps the card's own send box on the other tabs", () => {
    const html = detail(working);
    expect(html).toContain('class="detail-send" data-part="detail-send"');
    expect(html).not.toContain('class="composer"');
  });
});

function composer(unreachable: string | null, chatTerminal: Terminal | null = chat) {
  return renderToStaticMarkup(createElement(AgentComposer, { card, source: "firstmate", worker: working, unreachable, chatTerminal }));
}

describe("the agent composer", () => {
  it("is a multi-line box that talks to the worker first and names both recipients", () => {
    const html = composer(null);
    expect(html).toMatch(/<textarea id="composer-field" class="composer-field" data-part="composer-field" data-control="composer-message" rows="2" placeholder="Message the crewmate on t3…">/);
    expect(html).toContain('data-key="worker" aria-pressed="true"><span class="sailor working" data-part="recipient-sailor" data-state="working" aria-hidden="true">');
    expect(html).toMatch(/Crewmate<span class="terminal-chip" data-part="terminal-chip">t3<\/span>/);
    expect(html).toMatch(/data-key="chat" aria-pressed="false">.*Firstmate<span class="terminal-chip" data-part="terminal-chip">firstmate<\/span>/);
    expect(html).toContain("adds a line");
  });

  it("is disabled with the reason when the worker's terminal cannot be reached", () => {
    const html = composer("Detached from t3. Reattach to send again.");
    expect(html).toContain('placeholder="The crewmate&#x27;s terminal t3 is not reachable" disabled=""');
    expect(html).toContain('class="composer-box off" data-part="composer-box" data-state="off"');
    expect(html).toContain('<span class="send-note error-text" data-part="send-note" data-kind="error">Detached from t3. Reattach to send again.</span>');
  });
});

const key = (over: Partial<KeyboardEvent> = {}) => ({ key: "Enter", shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, isComposing: false, ...over });
const recipients = (over: Partial<Recipients> = {}): Recipients => ({ card, worker: working, workerReachable: true, chatTerminal: chat, ...over });

describe("composer sending", () => {
  it("sends on Enter and leaves Shift+Enter, modified Enter and IME composition to the box", () => {
    expect(sendsOnKey(key())).toBe(true);
    expect(sendsOnKey(key({ shiftKey: true }))).toBe(false);
    expect(sendsOnKey(key({ metaKey: true }))).toBe(false);
    expect(sendsOnKey(key({ isComposing: true }))).toBe(false);
    expect(sendsOnKey(key({ key: "a" }))).toBe(false);
  });

  it("sends the worker the captain's own lines, straight to its terminal", () => {
    expect(outgoing("worker", "  run the tests\nthen open the PR \n", recipients())).toEqual({
      terminal: "t3",
      text: "run the tests\nthen open the PR",
      to: "t3",
    });
  });

  it("sends the chat agent a message about the card, as the card's send box does", () => {
    expect(outgoing("chat", "is this ready?", recipients())).toEqual({
      terminal: chat.address,
      text: `${card.title} (${card.id}): is this ready?`,
      to: chat.name,
    });
  });

  it("sends nothing when the draft is blank or the recipient is out of reach", () => {
    expect(outgoing("worker", "  \n ", recipients())).toBeNull();
    expect(outgoing("worker", "hello", recipients({ workerReachable: false }))).toBeNull();
    expect(outgoing("chat", "hello", recipients({ chatTerminal: null }))).toBeNull();
  });
});
