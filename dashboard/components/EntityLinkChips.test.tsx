import { describe, it, expect } from "vitest";
import { chipDisplayLabel, isRedundantChip } from "@/components/EntityLinkChips";

describe("chipDisplayLabel", () => {
  it("collapses companion note labels that echo the task title", () => {
    expect(
      chipDisplayLabel(
        { kind: "note", id: "task-notes/x", label: "Complete discovery task PTF-4485" },
        { suppressJiraKey: "PTF-4485", hostLabel: "PTF-4485 Complete discovery task" },
      ),
    ).toBe("Note");
  });

  it("collapses task-notes companions even when the key is at the end of the title", () => {
    expect(
      chipDisplayLabel(
        {
          kind: "note",
          id: "task-notes/2026-07-28-e7dab8e8-4b0c-49e2-b62c-e4d6eb850850",
          label: "Complete discovery task PTF-4485",
        },
        { suppressJiraKey: "PTF-4485", hostLabel: "Complete discovery task PTF-4485" },
      ),
    ).toBe("Note");
  });

  it("strips the ticket key from a longer note label", () => {
    expect(
      chipDisplayLabel(
        { kind: "note", id: "n", label: "Discovery notes PTF-4485 follow-up" },
        { suppressJiraKey: "PTF-4485" },
      ),
    ).toBe("Discovery notes follow-up");
  });

  it("keeps unrelated hop labels intact", () => {
    expect(
      chipDisplayLabel(
        { kind: "pr", id: "org/repo#1", label: "Fix the thing" },
        { suppressJiraKey: "PTF-4485" },
      ),
    ).toBe("Fix the thing");
  });
});

describe("isRedundantChip", () => {
  it("hides the host Jira key even when it is a removable seed", () => {
    expect(
      isRedundantChip(
        { kind: "jira", id: "PTF-4783", label: "PTF-4783" },
        { suppressJiraKey: "PTF-4783" },
      ),
    ).toBe(true);
  });

  it("hides hashtags already shown in the title", () => {
    expect(
      isRedundantChip(
        { kind: "tag", id: "mobile-app", label: "#mobile-app" },
        { hostTags: ["mobile-app"] },
      ),
    ).toBe(true);
  });

  it("hides companion task notes when the row already has a note glyph", () => {
    expect(
      isRedundantChip(
        { kind: "note", id: "task-notes/x", label: "Note" },
        { hideCompanionNotes: true },
      ),
    ).toBe(true);
  });

  it("keeps unrelated hops", () => {
    expect(
      isRedundantChip(
        { kind: "pr", id: "org/repo#1", label: "Fix" },
        { suppressJiraKey: "PTF-4783", hostTags: ["mobile-app"] },
      ),
    ).toBe(false);
  });
});
