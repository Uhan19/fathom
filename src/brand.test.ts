import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Brand } from "./components/Brand";

const markup = renderToStaticMarkup(createElement(Brand));

describe("brand", () => {
  it("shows the split-disc mark before the wordmark", () => {
    expect(markup).toMatch(/^<div class="brand"><svg class="brand-mark"[^>]*>.*<\/svg><span class="brand-name"/);
    expect(markup).toContain(">FATHOM<");
  });

  it("hides the mark so the wordmark carries the only accessible name", () => {
    expect(markup).toMatch(/<svg class="brand-mark"[^>]* aria-hidden="true"/);
    expect(markup.match(/aria-label="[^"]*"/g)).toEqual(['aria-label="Fathom"']);
    expect(markup).toContain('<span class="brand-name" role="img" aria-label="Fathom">');
  });
});
