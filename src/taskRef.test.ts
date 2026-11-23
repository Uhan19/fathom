import { describe, expect, it } from "vitest";
import type { Card } from "./api";
import { focusMissText, focusText, isFocused, taskName, taskRef } from "./taskRef";

const card = (id: string, number: number | null): Card => ({
  id,
  title: "Chart the reef",
  state: "queued",
  kind: "ship",
  project: "reef-map",
  row: "seabed",
  holdKind: "",
  holdUntil: "",
  holdReason: "",
  blockedBy: [],
  links: [],
  closed: "",
  number,
});

describe("taskRef", () => {
  it("puts the number before a Firstmate task's name", () => {
    expect(taskRef(card("chart-reef", 42), "firstmate")).toBe("#42 chart-reef");
    expect(taskName(card("chart-reef", 42), "firstmate")).toBe("chart-reef");
  });

  it("shows only the number for Fathom's own tasks", () => {
    expect(taskRef(card("7", 42), "fathom")).toBe("#42");
    expect(taskName(card("7", 42), "fathom")).toBeNull();
  });

  it("falls back to the name before a number is known", () => {
    expect(taskRef(card("chart-reef", null), "firstmate")).toBe("chart-reef");
  });
});

describe("isFocused", () => {
  it("keeps the cards whose number is in the focus", () => {
    expect(isFocused(card("a", 3), [1, 3])).toBe(true);
    expect(isFocused(card("a", 2), [1, 3])).toBe(false);
    expect(isFocused(card("a", null), [1, 3])).toBe(false);
  });
});

describe("focus wording", () => {
  it("names the focused tasks", () => {
    expect(focusText([12])).toBe("Showing only task #12.");
    expect(focusText([12, 14])).toBe("Showing only tasks #12 and #14.");
    expect(focusText([12, 14, 31, 40])).toBe("Showing only tasks #12, #14, #31 and #40.");
    expect(focusText([12, 14, 31, 40, 52, 60])).toBe("Showing only tasks #12, #14, #31 and 3 more.");
  });

  it("says where the focused tasks are missing from", () => {
    expect(focusMissText(false)).toBe("None of the focused tasks is on the board.");
    expect(focusMissText(true)).toBe("None of the focused tasks is in the shown projects.");
  });
});
