import { describe, expect, it } from "vitest";
import { rootAttributes, rootTokens, themedTokens } from "./apply";
import { lookOf, NAUTICAL_LOOK } from "./look";

const riso = lookOf({
  id: "riso",
  version: "abc",
  base: "fathom-theme://localhost/riso/",
  manifest: { fathomTheme: 1, name: "Riso", fonts: { body: "Georgia, serif" }, layout: { detail: "overlay", rowLabelWidth: 58 } },
});

describe("applying a look", () => {
  it("marks the declared layout on the root", () => {
    expect(rootAttributes(NAUTICAL_LOOK)).toEqual({ themeId: "nautical", chatSide: "right", board: "rows", header: "top", detail: "side" });
    expect(rootAttributes(riso)).toMatchObject({ themeId: "riso", detail: "overlay" });
  });

  it("sets structural sizes and only the fonts the theme owns", () => {
    expect(rootTokens(riso)).toEqual({
      "--row-label-width": "58px",
      "--collapsed-width": "44px",
      "--lane-width": "260px",
      "--rail-width": "236px",
      "--body-font": "Georgia, serif",
    });
    expect(themedTokens(riso)).toEqual(["--body-font"]);
    expect(themedTokens(NAUTICAL_LOOK)).toEqual([]);
  });

  it("links the theme's styles by version and its art from its folder", () => {
    expect(riso.styles).toBe("fathom-theme://localhost/riso/theme.css?v=abc");
    expect(NAUTICAL_LOOK.styles).toBeNull();
    expect(riso.text.helper).toBe("Bosun");
  });
});
