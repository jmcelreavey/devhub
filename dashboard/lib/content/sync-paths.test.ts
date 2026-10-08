import { describe, expect, it } from "vitest";
import { contentSyncCommitMessage } from "./sync-paths";

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
