import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { GithubPrRow } from "@/lib/github/prs";

describe("skipped prs", () => {
  it("hides a skipped PR until it is updated, then resurfaces and forgets the skip", async () => {
    const tmpNotes = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-skipped-prs-"));
    process.env.NOTES_DIR = tmpNotes;
    const { applySkippedPrs, skipPr, listSkippedPrs } = await import("@/lib/github/skipped-prs");

    const pr: GithubPrRow = {
      number: 1,
      title: "t",
      url: "https://github.com/a/b/pull/1",
      repo: "a/b",
      updatedAt: "2026-08-25T00:00:00Z",
    };
    expect(await applySkippedPrs([pr])).toHaveLength(1);

    await skipPr(pr);
    expect(await applySkippedPrs([pr])).toHaveLength(0);
    expect(listSkippedPrs()).toHaveLength(1);

    const pushed = { ...pr, updatedAt: "2026-08-26T00:00:00Z" };
    expect(await applySkippedPrs([pushed])).toHaveLength(1);
    // resurfaced — the stale skip is pruned so it doesn't linger in the Skipped tab
    expect(listSkippedPrs()).toHaveLength(0);
    expect(await applySkippedPrs([pushed])).toHaveLength(1);
  });
});
