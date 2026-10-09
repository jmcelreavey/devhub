import { describe, expect, it } from "vitest";
import { contentSyncCommitMessage, parseNulSeparatedPaths, touchesBuildPaths } from "./sync-paths";

describe("contentSyncCommitMessage", () => {
  it("names only the folders that were actually staged", () => {
    expect(contentSyncCommitMessage(["notes/a.md", "tasks/2026.json"], "2026-10-08"))
      .toBe("chore(content): sync notes and tasks 2026-10-08");
    expect(contentSyncCommitMessage(["docs/a.md"], "2026-10-08"))
      .toBe("chore(content): sync docs 2026-10-08");
    expect(contentSyncCommitMessage(["notes/a.md", "collections/b.md", "diagrams/c.md"], "2026-10-08"))
      .toBe("chore(content): sync notes, checklists, and diagrams 2026-10-08");
  });
});

describe("touchesBuildPaths", () => {
  it("is false for content folders only, true once anything else is in the range", () => {
    expect(touchesBuildPaths([])).toBe(false);
    expect(touchesBuildPaths(["notes/a.md", "tasks/x.json", "upstarts/y.md"])).toBe(false);
    expect(touchesBuildPaths(["notes/a.md", "dashboard/lib/x.ts"])).toBe(true);
    expect(touchesBuildPaths(["tasks/.local/timer.json"])).toBe(true);
    expect(touchesBuildPaths(["notesy/a.md"])).toBe(true);
  });
});

describe("parseNulSeparatedPaths", () => {
  it("keeps names with spaces and non-ASCII characters intact", () => {
    expect(parseNulSeparatedPaths("notes/é a.md\0docs/b.md\0")).toEqual(["notes/é a.md", "docs/b.md"]);
    expect(parseNulSeparatedPaths("")).toEqual([]);
  });
});
