import fs from "node:fs";
import path from "node:path";
import postcss from "postcss";
import { describe, expect, it } from "vitest";
import { contrast, parseHex, type Rgb } from "./brand-colors";

const stylesheet = postcss.parse(fs.readFileSync(path.resolve("app/globals.css"), "utf8"));

function palette(preset: string, mode: string) {
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
  return { tokens, rgb };
}

describe("Graphite text, controls and charts", () => {
  it.each(["light", "dark"])("%s keeps small text AA and visual controls at 3:1", (mode) => {
    const { tokens, rgb } = palette("graphite", mode);
    const surfaces = ["--bg", "--bg-sidebar", "--bg-surface", "--bg-elevated", "--bg-overlay"];
    for (const surface of surfaces) {
      for (const ink of ["--text", "--text-muted", "--text-subtle", "--accent-text", "--accent-text-hover", "--success", "--warning", "--danger", "--info"]) {
        expect(contrast(rgb(ink), rgb(surface)), `${ink} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast(rgb("--graphite-control-border"), rgb(surface)), `control on ${surface}`).toBeGreaterThanOrEqual(3);
      for (let series = 1; series <= 8; series++) {
        expect(contrast(rgb(`--chart-${series}`), rgb(surface)), `chart ${series} on ${surface}`).toBeGreaterThanOrEqual(3);
      }
      for (const tone of ["accent", "success", "warning", "danger", "info"]) {
        const match = tokens[`--${tone}-dim`]?.match(/^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/);
        if (!match) throw new Error(`Missing tint for ${tone}`);
        const alpha = Number(match[4]);
        const base = rgb(surface);
        const tint: Rgb = [
          Number(match[1]) * alpha + base[0] * (1 - alpha),
          Number(match[2]) * alpha + base[1] * (1 - alpha),
          Number(match[3]) * alpha + base[2] * (1 - alpha),
        ];
        const ink = tone === "accent" ? "--accent-text" : `--${tone}`;
        expect(contrast(rgb(ink), tint), `${tone} badge on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    for (const fill of ["--accent", "--accent-hover"]) {
      expect(contrast(rgb("--accent-fg"), rgb(fill)), `button ${fill}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("Graphite workshop ambience at its brightest intersection", () => {
  it.each(["light", "dark"])("%s keeps text AA over both grid lines and the light pool", mode => {
    const { rgb } = palette("graphite", mode);
    // Two 7% grid lines and the 8% light pool overlap at worst (5% each in light).
    const grid = mode === "dark" ? .07 : .05;
    const light = mode === "dark" ? .08 : .05;
    const alpha = 1 - (1 - grid) ** 2 * (1 - light);
    const base = rgb("--bg");
    const accent = rgb("--accent");
    const brightest = base.map((channel, i) => channel * (1 - alpha) + accent[i] * alpha) as Rgb;
    for (const ink of ["--text", "--text-muted", "--text-subtle", "--accent-text"]) {
      expect(contrast(rgb(ink), brightest), `${ink} over workshop grid`).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(rgb("--chart-1"), brightest), "preview bars").toBeGreaterThanOrEqual(3);
  });
});

describe("Plugins text and controls against the shipped theme surfaces", () => {
  it.each(["graphite", "hollow"].flatMap((preset) => ["light", "dark"].map((mode) => ({ preset, mode }))))("$preset $mode", ({ preset, mode }) => {
    const { rgb } = palette(preset, mode);
    for (const surface of ["--bg", "--bg-surface", "--bg-elevated", "--bg-overlay"]) {
      expect(contrast(rgb("--text"), rgb(surface)), `${surface} body text`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(rgb("--text-muted"), rgb(surface)), `${surface} metadata`).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(rgb("--accent-fg"), rgb("--accent")), "primary button").toBeGreaterThanOrEqual(4.5);
    expect(contrast(rgb("--text-muted"), rgb("--bg-elevated")), "input outline").toBeGreaterThanOrEqual(3);
  });
});
