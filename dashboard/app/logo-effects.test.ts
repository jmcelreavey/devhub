import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Themes swap the mark artwork; they never paint glows, candles or backdrops on
 * or behind a logo. Those effects bled onto whatever icon was picked next.
 */
const sheets = fs
  .readdirSync(__dirname)
  .filter((name) => name.endsWith(".css"))
  .map((name) => [name, fs.readFileSync(path.join(__dirname, name), "utf8")] as const);

/** Every `selector { body }` pair, comments stripped, nested blocks flattened. */
function rules(css: string): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(re)) {
    out.push({ selector: m[1].trim(), body: m[2] });
  }
  return out;
}

const LOGO = /\.(brand-dot|boot-mark|theme-brand-image|devhub-mark|mobile-brand-logo)\b/;
const EFFECT = /(box-shadow|filter|background(-image)?)\s*:\s*(?!none|transparent|var\(--accent(-hover)?\)|var\(--bg-surface\))[^;]*(gradient|url\(|var\(--[a-z-]*glow|rgba?\(|#[0-9a-f]{3,8}|blur|drop-shadow)/i;

describe("theme logo effects", () => {
  it("no theme draws a glow, candle or backdrop on a logo", () => {
    const offenders = sheets.flatMap(([name, css]) =>
      rules(css)
        .filter(({ selector, body }) => LOGO.test(selector) && EFFECT.test(body))
        .map(({ selector }) => `${name}: ${selector}`),
    );
    expect(offenders).toEqual([]);
  });

  it("Hollow no longer overlays candlelight on the sidebar icon", () => {
    const hollow = sheets.find(([name]) => name === "hollow.css")?.[1] ?? "";
    expect(hollow).not.toMatch(/candlelight/);
    expect(hollow).not.toMatch(/\.brand-dot[^{]*::before/);
  });
});
