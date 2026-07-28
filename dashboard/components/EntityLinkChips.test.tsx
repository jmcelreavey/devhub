import { describe, it, expect } from "vitest";
import { chipDisplayLabel } from "@/components/EntityLinkChips";

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
