import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SRC = new URL("./", import.meta.url);
const FIXTURE_DIR = "preview/";
const ALPHA_ONLY_PROPERTIES = new Set(["mask-image"]);

const NAMED_COLORS =
  "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen";
const NAMED = NAMED_COLORS.replace(/ /g, "|");
const LITERAL = new RegExp(`#[0-9a-f]{3,8}\\b|\\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\\(|\\b(?:${NAMED})\\b`, "i");
const COLOR_PROP = "fill|stroke|stopColor|floodColor|lightingColor|color|background|backgroundColor|borderColor|outlineColor";
const SCRIPT_LITERAL = new RegExp(`#[0-9a-f]{3,8}\\b|\\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\\(|\\b(?:${COLOR_PROP})\\s*[=:]\\s*["'\`]\\s*(?:${NAMED})\\b`, "i");

type Finding = { file: string; line: number; text: string };

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

function blankComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
}

function cssLiterals(file: string, source: string): Finding[] {
  const css = blankComments(source);
  const findings: Finding[] = [];
  const selectors: string[] = [];
  let start = 0;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === "{") {
      selectors.push(css.slice(start, i).trim());
      start = i + 1;
    } else if (ch === "}" || ch === ";") {
      const declaration = css.slice(start, i);
      const colon = declaration.indexOf(":");
      if (colon > 0 && !declaration.trim().startsWith("@")) {
        const property = declaration.slice(0, colon).trim();
        const value = declaration.slice(colon + 1).replace(/var\(\s*--[\w-]+/g, "var(");
        const selector = selectors[selectors.length - 1] ?? "";
        const isToken = property.startsWith("--") && selector.split(",").every((s) => s.trim().startsWith(":root"));
        if (!isToken && !ALPHA_ONLY_PROPERTIES.has(property) && LITERAL.test(value)) {
          findings.push({ file, line: lineOf(css, start + colon), text: declaration.trim() });
        }
      }
      if (ch === "}") selectors.pop();
      start = i + 1;
    }
  }
  return findings;
}

function scriptLiterals(file: string, source: string): Finding[] {
  return source.split("\n").flatMap((text, i) => (SCRIPT_LITERAL.test(text) ? [{ file, line: i + 1, text: text.trim() }] : []));
}

function sourceFiles(): string[] {
  return (readdirSync(SRC, { recursive: true }) as string[])
    .map((path) => path.replace(/\\/g, "/"))
    .filter((path) => /\.(css|tsx?)$/.test(path) && !path.endsWith(".test.ts") && !path.startsWith(FIXTURE_DIR));
}

describe("color literals", () => {
  it("keeps every color in the token definitions, so a theme can reach it", () => {
    const files = sourceFiles();
    expect(files).toEqual(expect.arrayContaining(["styles.css", "terminalOptions.ts", "components/Icons.tsx", "components/Brand.tsx"]));
    const findings = files.flatMap((path) => {
      const source = readFileSync(new URL(path, SRC), "utf8");
      return path.endsWith(".css") ? cssLiterals(path, source) : scriptLiterals(path, source);
    });
    expect(findings.map((f) => `${f.file}:${f.line} ${f.text}`)).toEqual([]);
  });

  it("allows colors only in custom properties on :root", () => {
    const css = ':root[data-theme="dark"] { --ink: #fff; }\n.a { color: #fff; --local: red; }\n.b { border: 1px solid rgb(0 0 0); }';
    expect(cssLiterals("x.css", css).map((f) => f.line)).toEqual([2, 2, 3]);
  });

  it("ignores token names, comments and alpha-only masks", () => {
    const css = "/* #fff */\n.a { color: var(--term-bright-white); mask-image: linear-gradient(#000, transparent); white-space: nowrap; }";
    expect(cssLiterals("x.css", css)).toEqual([]);
  });

  it("finds colors written in components", () => {
    const tsx = 'const a = <path fill="#3f6b84" />;\nconst b = { color: "white" };\nconst c = ["white", "black"];';
    expect(scriptLiterals("x.tsx", tsx).map((f) => f.line)).toEqual([1, 2]);
  });
});
