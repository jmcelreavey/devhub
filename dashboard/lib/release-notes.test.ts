import { describe, expect, it } from "vitest";
import { dismissReleaseVersion, isReleaseVersionDismissed, observeReleaseVersion } from "./release-notes";
import { normaliseReleaseVersion, parseChangelog, requireReleaseNotes } from "@shared/release-notes/index.mjs";

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

describe("release notes", () => {
  it("parses actual and bracketed headings, CRLF, subsections and prereleases", () => {
    const entries = parseChangelog("# Changelog\r\n## Unreleased\r\n- Future\r\n## [v2.1.0-beta.1] - 2026-10-10\r\n### Added\r\n- **New thing**\r\n## 2.0.5 — 2026-10-09\r\n- Fix\r\n");
    expect(entries.map((entry) => entry.version)).toEqual(["Unreleased", "2.1.0-beta.1", "2.0.5"]);
    expect(entries[1]).toMatchObject({ date: "2026-10-10", markdown: "### Added\n- **New thing**", highlights: ["**New thing**"] });
  });
  it("doesn't turn code-fence headings into releases", () => {
    const entries = parseChangelog("## 2.1.0\n```md\n## 3.0.0\n- Example, not a highlight\n```\n- Real note\n## 2.0.0\n- Old note");
    expect(entries.map((entry) => entry.version)).toEqual(["2.1.0", "2.0.0"]);
    expect(entries[0].highlights).toEqual(["Real note"]);
  });
  it("refuses missing, empty and duplicate release entries rather than using Unreleased", () => {
    expect(() => requireReleaseNotes("## Unreleased\n- Future", "2.1.0")).toThrow("Update CHANGELOG before release");
    expect(() => requireReleaseNotes("## 2.1.0\n\n## 2.0.0\n- Old", "2.1.0")).toThrow("no non-empty entry");
    expect(() => parseChangelog("## 2.1.0\n- One\n## [v2.1.0]\n- Two")).toThrow("Duplicate");
    expect(normaliseReleaseVersion("../../secrets")).toBeNull();
  });
  it.each([false, true])("shows only changes, once per version (desktop=%s)", (desktop) => {
    const store = storage();
    expect(observeReleaseVersion(store, "2.0.4", desktop)).toBe(false);
    expect(observeReleaseVersion(store, "2.0.5", desktop)).toBe(true);
    expect(observeReleaseVersion(store, "2.0.5", desktop)).toBe(false);
    expect(observeReleaseVersion(store, "2.0.4", desktop)).toBe(false);
    expect(observeReleaseVersion(store, "2.0.5", desktop)).toBe(false);
    expect(observeReleaseVersion(store, "2.1.0", desktop)).toBe(true);
  });
  it.each([false, true])("persists dismissal in the existing version store (desktop=%s)", (desktop) => {
    const store = storage();
    const key = `devhub:release-notes:${desktop ? "desktop" : "web"}`;
    store.setItem(key, JSON.stringify({ lastVersion: "2.0.4", seen: ["2.0.4"] }));
    expect(observeReleaseVersion(store, "2.0.5", desktop)).toBe(true);
    expect(dismissReleaseVersion(store, "2.0.5", desktop)).toBe(true);
    expect(dismissReleaseVersion(store, "2.0.5", desktop)).toBe(true);
    expect(JSON.parse(store.getItem(key)!)).toEqual({ lastVersion: "2.0.5", seen: ["2.0.4", "2.0.5"], dismissed: ["2.0.5"] });
    expect(observeReleaseVersion(store, "2.0.5", desktop)).toBe(false);
    expect(observeReleaseVersion(store, "2.0.6", desktop)).toBe(true);
    expect(observeReleaseVersion(store, "2.0.6", desktop)).toBe(false);
    expect(observeReleaseVersion(store, "2.0.5", desktop)).toBe(false);
  });
  it("reads existing dismissals without changing seen history or mixing web and desktop", () => {
    const store = storage();
    const saved = JSON.stringify({ lastVersion: "2.0.5", seen: ["2.0.5"], dismissed: ["2.0.5"] });
    store.setItem("devhub:release-notes:web", saved);
    expect(isReleaseVersionDismissed(store, "2.0.5", false)).toBe(true);
    expect(isReleaseVersionDismissed(store, "2.0.6", false)).toBe(false);
    expect(isReleaseVersionDismissed(store, "2.0.5", true)).toBe(false);
    expect(store.getItem("devhub:release-notes:web")).toBe(saved);
    store.setItem("devhub:release-notes:web", "bad JSON");
    expect(isReleaseVersionDismissed(store, "2.0.5", false)).toBe(false);
    expect(isReleaseVersionDismissed({ getItem: () => { throw new Error("Storage blocked"); }, setItem: () => {} }, "2.0.5", false)).toBe(false);
  });
  it("never forgets an explicitly dismissed version when the seen history rolls over", () => {
    const store = storage();
    observeReleaseVersion(store, "2.0.4", false);
    observeReleaseVersion(store, "2.0.5", false);
    dismissReleaseVersion(store, "2.0.5", false);
    for (let patch = 6; patch < 110; patch += 1) observeReleaseVersion(store, `2.0.${patch}`, false);
    expect(JSON.parse(store.getItem("devhub:release-notes:web")!).seen).not.toContain("2.0.5");
    expect(observeReleaseVersion(store, "2.0.5", false)).toBe(false);
  });
  it("repairs malformed dismissal data and reports unavailable storage", () => {
    const store = storage();
    store.setItem("devhub:release-notes:web", JSON.stringify({ lastVersion: "2.0.4", seen: [false, "2.0.4"], dismissed: [null, "2.0.3"] }));
    expect(dismissReleaseVersion(store, "2.0.5", false)).toBe(true);
    expect(JSON.parse(store.getItem("devhub:release-notes:web")!)).toEqual({ lastVersion: "2.0.4", seen: ["2.0.4"], dismissed: ["2.0.3", "2.0.5"] });
    expect(observeReleaseVersion(store, "2.0.5", false)).toBe(false);
    store.setItem("devhub:release-notes:web", "bad JSON");
    expect(dismissReleaseVersion(store, "2.0.5", false)).toBe(true);
    expect(observeReleaseVersion(store, "2.0.5", false)).toBe(false);
    expect(dismissReleaseVersion({ getItem: () => { throw new Error("Storage blocked"); }, setItem: () => {} }, "2.0.5", false)).toBe(false);
    expect(dismissReleaseVersion({ getItem: () => null, setItem: () => { throw new Error("Storage full"); } }, "2.0.5", false)).toBe(false);
  });
  it("isolates desktop and web visits, and tolerates corrupt or unavailable storage", () => {
    const store = storage();
    observeReleaseVersion(store, "2.0.4", false);
    expect(observeReleaseVersion(store, "2.0.5", true)).toBe(false);
    expect(observeReleaseVersion(store, "2.0.5", false)).toBe(true);
    store.setItem("devhub:release-notes:web", "bad JSON");
    expect(observeReleaseVersion(store, "2.0.5", false)).toBe(false);
    expect(observeReleaseVersion(store, "2.0.6", false)).toBe(true);
    expect(observeReleaseVersion({ getItem: () => { throw new Error("Storage blocked"); }, setItem: () => {} }, "2.0.5", false)).toBe(false);
  });
});
