import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Switch } from "./components/Switch";

const ignore = () => undefined;

describe("Switch", () => {
  it("is a named switch that says whether it is on", () => {
    const on = renderToStaticMarkup(createElement(Switch, { label: "Dark mode", checked: true, onChange: ignore }));
    expect(on).toContain('role="switch" aria-checked="true"');
    expect(on).toContain(">Dark mode<");
    const off = renderToStaticMarkup(createElement(Switch, { label: "Dark mode", checked: false, onChange: ignore }));
    expect(off).toContain('aria-checked="false"');
  });
});
