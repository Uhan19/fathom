import { describe, expect, it } from "vitest";
import { previewRequests } from "./previews";

describe("theme preview requests", () => {
  it("count a preview as open from the pick, before the picked theme has loaded", () => {
    const previews = previewRequests();
    expect(previews.open).toBe(false);
    const current = previews.start();
    expect(previews.open).toBe(true);
    expect(current()).toBe(true);
  });

  it("drop a pick that a later pick or the end of the preview replaced", () => {
    const previews = previewRequests();
    const first = previews.start();
    const second = previews.start();
    expect([first(), second()]).toEqual([false, true]);
    previews.end();
    expect([second(), previews.open]).toEqual([false, false]);
  });
});
