import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = fs.readFileSync(path.join(__dirname, "../../app/globals.css"), "utf8");

/** Body of the first rule whose selector is exactly `selector`. */
function ruleBody(selector: string): string {
  const start = css.indexOf(`\n${selector} {`);
  expect(start, `${selector} rule`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("\n}", start));
}

describe("top bar layout contract", () => {
  it("tiers follow the bar's own width, not the window's", () => {
    // The bar sits beside a 232px sidebar, so a viewport breakpoint is off by
    // that much (and by 188px less when the sidebar is collapsed).
    expect(ruleBody(".hub-topbar")).toContain("container: hub-topbar / inline-size");
    for (const query of [
      "@container hub-topbar (max-width: 1159px)",
      "@container hub-topbar (min-width: 840px)",
      "@container hub-topbar (min-width: 1040px)",
    ]) {
      expect(css, query).toContain(query);
    }
  });

  it("keeps controls within the 32-36px target range", () => {
    const body = ruleBody(".hub-topbar");
    const icon = Number(/--hub-topbar-icon:\s*(\d+)px/.exec(body)?.[1]);
    const field = Number(/--hub-topbar-field:\s*(\d+)px/.exec(body)?.[1]);
    expect(icon).toBeGreaterThanOrEqual(32);
    expect(field).toBeLessThanOrEqual(36);
    expect(field).toBeGreaterThanOrEqual(icon);
  });

  it("does not wrap the bar onto a second row", () => {
    expect(ruleBody(".hub-topbar")).not.toMatch(/flex-wrap:\s*wrap/);
  });
});
