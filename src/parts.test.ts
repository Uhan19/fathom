import { describe, expect, it } from "vitest";
import { states } from "./parts";

describe("states", () => {
  it("lists the states that are on, in order", () => {
    expect(states({ selected: true, unseen: false, lifted: true })).toBe("selected lifted");
  });

  it("leaves the attribute out when no state is on", () => {
    expect(states({ selected: false, unseen: null, lifted: undefined })).toBeUndefined();
  });
});
