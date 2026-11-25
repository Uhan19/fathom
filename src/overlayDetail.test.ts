import { describe, expect, it } from "vitest";
import { closesOnEscape } from "./overlayDetail";

const body = { closest: () => null };
const page = (dialogOpen: boolean) => ({
  querySelector: (selector: string) => (dialogOpen && selector === "dialog[open]" ? body : null),
}) as unknown as Pick<Document, "querySelector">;
const key = (name: string, target: unknown = body, defaultPrevented = false, isComposing = false) =>
  ({ key: name, target, defaultPrevented, isComposing }) as unknown as Pick<KeyboardEvent, "key" | "defaultPrevented" | "isComposing" | "target">;

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

  it("stays open when Escape only cancels an IME composition", () => {
    expect(closesOnEscape(key("Escape", body, false, true), page(false))).toBe(false);
  });
});
