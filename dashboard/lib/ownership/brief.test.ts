import { describe, expect, it } from "vitest";
import { buildOwnershipBriefMarkdown } from "./brief";
import type { OwnerBrief } from "./types";

describe("ownership morning brief", () => {
  it("surfaces unattended inbound work", () => {
    const brief = {
      repo: { fullName: "acme/widgets" },
      obligations: { defaultBranchCi: "failing", staleBranches: [], botPrs: 1, unassignedIssues: 2 },
      prs: [{ review: { nobodyLooking: true } }],
      gaps: [{ label: "payments", score: 8.2 }],
    } as unknown as OwnerBrief;
    const markdown = buildOwnershipBriefMarkdown([brief], []);
    expect(markdown).toContain("acme/widgets");
    expect(markdown).toContain("1 unattended");
    expect(markdown).toContain("payments");
  });
});
