import { describe, expect, it } from "vitest";
import { closesOnEscape } from "./overlayDetail";

const body = { closest: () => null };
const page = (dialogOpen: boolean) => ({
  querySelector: (selector: string) => (dialogOpen && selector === "dialog[open]" ? body : null),
}) as unknown as Pick<Document, "querySelector">;
const key = (name: string, target: unknown = body, defaultPrevented = false) =>
  ({ key: name, target, defaultPrevented }) as unknown as Pick<KeyboardEvent, "key" | "defaultPrevented" | "target">;

describe("closing the overlay card detail", () => {
  it("closes on Escape when nothing else is open", () => {
    expect(closesOnEscape(key("Escape"), page(false))).toBe(true);
  });

  it("stays open while another dialog is open, even with focus on the page body", () => {
    expect(closesOnEscape(key("Escape", body), page(true))).toBe(false);
  });

  it("ignores other keys and an Escape something else already handled", () => {
    expect(closesOnEscape(key("Enter"), page(false))).toBe(false);
    expect(closesOnEscape(key("Escape", body, true), page(false))).toBe(false);
  });

  it("closes the side-panel detail on Escape from the board", () => {
    expect(closesOnEscape(key("Escape"), page(false), true)).toBe(true);
  });

  it("keeps the side-panel detail open when a text field has focus", () => {
    const field = { closest: (selector: string) => (selector.includes("textarea") ? {} : null) };
    expect(closesOnEscape(key("Escape", field), page(false), true)).toBe(false);
    expect(closesOnEscape(key("Escape", field), page(false))).toBe(true);
  });
});
