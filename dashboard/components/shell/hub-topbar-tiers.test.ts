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

  it("shows panel toggles inline when the bar has room and folds them into Panels otherwise", () => {
    // Hidden by default so narrow bars render only the menu.
    expect(css).toMatch(/\.hub-topbar \.hub-panel-actions \{\s*display: none;/);
    const query = css.indexOf("@container hub-topbar (min-width: 1350px)");
    expect(query, "wide tier").toBeGreaterThan(-1);
    const block = css.slice(query, css.indexOf("\n}\n", query));
    expect(block).toContain(".hub-topbar .hub-panel-actions");
    expect(block).toMatch(/\.hub-topbar \.hub-panels-menu \{\s*display: none;/);
    // The trigger is a square icon button. A resting border and a text label
    // made the old Tools control look like a stray pill.
    expect(css).not.toMatch(/\.hub-panels-menu > \.hub-icon-btn[^{]*\{[^}]*border-color/);
  });

  it("keeps the empty RepoGitWorkspace placeholder from taking a flex gap", () => {
    expect(css).toMatch(/\.hub-topbar-actions > \.repo-git-workspace \{\s*display: contents;/);
  });

  it("does not wrap the bar onto a second row", () => {
    expect(ruleBody(".hub-topbar")).not.toMatch(/flex-wrap:\s*wrap/);
  });
});
