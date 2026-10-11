import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const appDir = path.join(__dirname, "../../app");
const dashboardDir = path.join(__dirname, "../..");

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "node_modules" || entry.name.startsWith(".next") ? [] : walk(full);
    }
    return entry.name.endsWith(".css") && !entry.name.endsWith(".generated.css") ? [full] : [];
  });
}

const files = [...walk(appDir), ...walk(path.join(dashboardDir, "components"))];
const css = (file: string) => fs.readFileSync(file, "utf8");
const globals = css(path.join(appDir, "globals.css"));

/** Rules (selector + body) whose selector mentions :focus-visible or :focus-within. */
function focusRules(source: string): { selector: string; body: string }[] {
  const rules: { selector: string; body: string }[] = [];
  for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1].replace(/\/\*[\s\S]*?\*\//g, "").trim();
    if (/:focus-visible|:focus-within|:focus\b/.test(selector)) rules.push({ selector, body: match[2] });
  }
  return rules;
}

describe("focus ring: one definition, every theme inherits it", () => {
  it("defines the ring once, from tokens, with an inset offset", () => {
    expect(globals).toMatch(/--focus-ring-width:\s*2px/);
    expect(globals).toMatch(/--focus-ring-offset:\s*-2px/);
    expect(globals).toMatch(/--focus-ring-color:\s*var\(--accent-text, var\(--accent\)\)/);
    const base = focusRules(globals).find((rule) => rule.selector === ":focus-visible");
    expect(base?.body).toContain("outline: var(--focus-ring-width) solid var(--focus-ring-color)");
    expect(base?.body).toContain("outline-offset: var(--focus-ring-offset)");
    // A ring that changed the control's radius used to squash round buttons.
    expect(base?.body).not.toContain("border-radius");
  });

  it("lets no theme or component re-declare the ring on :focus-visible", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = path.relative(dashboardDir, file);
      for (const rule of focusRules(css(file))) {
        if (!/:focus-visible/.test(rule.selector)) continue;
        if (!/(^|;|\s)outline(-offset)?\s*:/.test(rule.body)) continue;
        const allowed =
          // The one definition, its filled-control and inline-link variants, the wrapper hosts.
          (rel === "app/globals.css" &&
            /^(:focus-visible|:is\(\.btn-primary|a:not\(\[class\]\)|:is\(\.focus-host)/.test(rule.selector)) ||
          // The Tools popover takes focus after a pointer open but is not a control.
          rel === "app/globals.css" && rule.selector === ".launch-menu:focus-visible";
        if (!allowed) offenders.push(`${rel}: ${rule.selector.replace(/\s+/g, " ")}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("never offsets a ring outwards, so nothing is clipped or lands on a neighbour", () => {
    const outward = files.flatMap((file) =>
      [...css(file).matchAll(/outline-offset:\s*(\d+(?:\.\d+)?)px/g)].map(
        (m) => `${path.relative(dashboardDir, file)}: outline-offset ${m[1]}px`,
      ),
    );
    // Only the drop-target highlight (a drag affordance, not focus) and the
    // cursor follower are allowed to sit outside their box.
    const allowed = /globals\.css: outline-offset 1px|theme-effects\.css: outline-offset 4px|globals\.css: outline-offset 2px/;
    const unexpected = outward.filter((entry) => !allowed.test(entry));
    expect(unexpected).toEqual([]);
  });

  it("keeps resting transparent outlines off controls (they hid a second ring)", () => {
    for (const file of files) {
      expect(css(file), path.relative(dashboardDir, file)).not.toMatch(/outline:\s*2px solid transparent/);
    }
  });

  it("names the wrapper fields that ring in place of their inner input", () => {
    expect(globals).toMatch(/:is\(\.focus-host, \.search-field, \.repo-git-filter-search, \.repo-git-branch-filter\):has\(/);
    expect(globals).toMatch(/\.search-field[\s\S]*?:is\(input, textarea, select\):focus-visible,\s*\.palette-input:focus-visible \{\s*outline: none;/);
  });

  it("gives the Tools popover a focus target without a ring", () => {
    const rule = focusRules(globals).find((r) => r.selector === ".launch-menu:focus-visible");
    expect(rule?.body).toContain("outline: none");
  });
});

describe("no component opts a text field out of the ring inline", () => {
  const roots = ["app", "components"].map((dir) => path.join(dashboardDir, dir));
  function tsx(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === "node_modules" ? [] : tsx(full);
      return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name) ? [full] : [];
    });
  }
  it("has no inline `outline: \"none\"` on fields", () => {
    const offenders = roots
      .flatMap(tsx)
      // CodeMirror draws its own focused state (caret line, selection).
      .filter((file) => !file.endsWith("components/db/SqlEditor.tsx"))
      .filter((file) => /outline:\s*"none"/.test(fs.readFileSync(file, "utf8")))
      .map((file) => path.relative(dashboardDir, file));
    expect(offenders).toEqual([]);
  });
});
