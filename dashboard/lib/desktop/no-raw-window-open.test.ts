import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const SOURCE_DIRS = ["app", "components", "lib"];
// The bridge is the one place allowed to call it: it is the browser fallback.
const ALLOWED = new Set([join("lib", "desktop", "bridge.ts")]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" || entry.name.startsWith(".") ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

/** A code line that calls window.open — comments that mention it don't count. */
function isRawWindowOpen(line: string): boolean {
  return !/^\s*(\/\/|\*|\/\*)/.test(line) && /\bwindow\.open\(/.test(line);
}

describe("external links in the desktop app", () => {
  it("never call window.open directly — Tauri blocks it silently; use openInBrowser", () => {
    const offenders = SOURCE_DIRS.flatMap((d) => sourceFiles(join(ROOT, d)))
      .map((file) => relative(ROOT, file))
      .filter((file) => !ALLOWED.has(file))
      .filter((file) => readFileSync(join(ROOT, file), "utf8").split("\n").some(isRawWindowOpen));

    expect(offenders).toEqual([]);
  });
});
