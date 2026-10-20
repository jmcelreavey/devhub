import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const globals = fs.readFileSync(path.join(__dirname, "globals.css"), "utf8");
const hollow = fs.readFileSync(path.join(__dirname, "hollow.css"), "utf8");
const rule = (css: string, selector: string) => {
  const at = css.indexOf(`${selector} {`);
  expect(at, `missing rule ${selector}`).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf("}", at));
};

describe("theme scrollbars", () => {
  it("tells the engine each theme's colour scheme, so native scrollbars never draw white on a dark theme", () => {
    expect(rule(globals, ':root,\n:root[data-theme="dark"]')).toContain("color-scheme: dark");
    expect(rule(globals, ':root[data-theme="light"]')).toContain("color-scheme: light");
  });

  it("draws a thin, token-coloured thumb on a transparent track, a step stronger on hover", () => {
    const tokens = globals.slice(globals.indexOf(":root {\n  --scrollbar-thumb:"), globals.indexOf("@supports not selector(::-webkit-scrollbar)"));
    expect(tokens.startsWith(":root {")).toBe(true);
    expect(tokens).toMatch(/--scrollbar-thumb: color-mix\(in srgb, var\(--text-subtle\) \d+%, transparent\)/);
    expect(tokens).toMatch(/--scrollbar-thumb-hover: color-mix\(in srgb, var\(--text-subtle\) \d+%, transparent\)/);
    expect(rule(globals, "::-webkit-scrollbar-thumb")).toContain("background-color: var(--scrollbar-thumb)");
    expect(rule(globals, "::-webkit-scrollbar-thumb:hover,\n::-webkit-scrollbar-thumb:active")).toContain("var(--scrollbar-thumb-hover)");
    expect(rule(globals, "::-webkit-scrollbar-track,\n::-webkit-scrollbar-corner")).toContain("background: transparent");
    // Firefox: standard properties on every element, so nested panels match too.
    const firefox = globals.slice(globals.indexOf("@supports not selector(::-webkit-scrollbar)"));
    expect(firefox).toMatch(/\* \{\s*scrollbar-width: thin;\s*scrollbar-color: var\(--scrollbar-thumb\) transparent;/);
  });

  it("lets Hollow recolour the thumb through the tokens instead of replacing the shared scrollbar", () => {
    expect(rule(hollow, ':root[data-theme-preset="hollow"]')).toContain("--scrollbar-thumb:");
    // A root scrollbar-color would inherit everywhere and make Chromium drop the ::-webkit-scrollbar styles and their hover.
    expect(hollow).not.toMatch(/^\s*scrollbar-color:/m);
    expect(hollow).not.toContain("::-webkit-scrollbar");
  });
});
