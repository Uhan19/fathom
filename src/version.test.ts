import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppVersion } from "./components/AppVersion";

const render = (version: string | null) => renderToStaticMarkup(createElement(AppVersion, { version }));

describe("app version", () => {
  it("names the release the running build reports", () => {
    expect(render("0.3.0")).toBe('<small class="app-version">Fathom 0.3.0</small>');
  });

  it("shows only the name until the version is read", () => {
    expect(render(null)).toBe('<small class="app-version">Fathom</small>');
  });
});
