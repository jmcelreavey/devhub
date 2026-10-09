import fs from "node:fs";
import path from "node:path";
import postcss from "postcss";
import { describe, expect, it } from "vitest";
import { contrast, parseHex, type Rgb } from "./brand-colors";

const stylesheet = postcss.parse(fs.readFileSync(path.resolve("app/globals.css"), "utf8"));

describe("Plugins text and controls against the shipped theme surfaces", () => {
  it.each(["graphite", "hollow"].flatMap((preset) => ["light", "dark"].map((mode) => ({ preset, mode }))))("$preset $mode", ({ preset, mode }) => {
    const tokens: Record<string, string> = {};
    stylesheet.walkRules((rule) => {
      if (rule.selector !== `:root[data-theme="${mode}"][data-theme-preset="${preset}"]`) return;
      rule.walkDecls((declaration) => { tokens[declaration.prop] = declaration.value; });
    });
    const rgb = (token: string): Rgb => {
      const parsed = parseHex(tokens[token]);
      if (!parsed) throw new Error(`Missing colour token ${token}`);
      return parsed;
    };
    for (const surface of ["--bg", "--bg-surface", "--bg-elevated", "--bg-overlay"]) {
      expect(contrast(rgb("--text"), rgb(surface)), `${surface} body text`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(rgb("--text-muted"), rgb(surface)), `${surface} metadata`).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(rgb("--accent-fg"), rgb("--accent")), "primary button").toBeGreaterThanOrEqual(4.5);
    expect(contrast(rgb("--text-muted"), rgb("--bg-elevated")), "input outline").toBeGreaterThanOrEqual(3);
  });
});
