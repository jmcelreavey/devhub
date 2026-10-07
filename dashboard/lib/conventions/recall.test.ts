import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let notesDir: string;

vi.mock("@/lib/notes/dir", () => ({
  getNotesDir: () => notesDir,
}));

const { conventionRecallDocs, conventionsNewestMtime } = await import("./recall");
const { updateConventions } = await import("./store");
const { saveConventionsPrefs } = await import("./prefs");

const NOW = "2026-10-06T09:00:00.000Z";

function addRule(repo: string, over: Record<string, unknown> = {}) {
  return updateConventions(repo, (file) => {
    file.rules.push({
      id: "r_1",
      text: "Put each handler in its own file",
      category: "structure",
      status: "accepted",
      origin: "review",
      evidence: [],
      prs: [1078, 1000],
      firstSeen: NOW,
      lastSeen: NOW,
      ...over,
    } as never);
    file.runs.unshift({ at: NOW, trigger: "manual", ok: true, prsScanned: 1, comments: 1, considered: 1, added: 1, reinforced: 0, ms: 1, guidanceFiles: [] });
  });
}

beforeEach(() => {
  notesDir = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-conv-recall-"));
});

afterEach(() => {
  fs.rmSync(notesDir, { recursive: true, force: true });
});

describe("conventionRecallDocs", () => {
  it("indexes a repo's active rules as one learning document with repo and PR refs", async () => {
    await addRule("acme/widgets");
    const [doc] = conventionRecallDocs();
    expect(doc).toMatchObject({
      sourceKind: "learning",
      sourceId: "conventions/acme__widgets",
      title: "Conventions — acme/widgets",
      href: "/conventions?repo=acme%2Fwidgets",
      ts: Date.parse(NOW),
    });
    expect(doc.text).toContain("Put each handler in its own file");
    expect(doc.refs).toEqual(expect.arrayContaining(["repo:widgets", "pr:acme/widgets#1078"]));
  });

  it("leaves out repos with nothing in force", async () => {
    await addRule("acme/widgets", { status: "rejected" });
    await addRule("acme/gadgets", { status: "suggested", prs: [1] });
    expect(conventionRecallDocs()).toEqual([]);
  });

  it("indexes only decided rules, including automatic acceptance", async () => {
    await addRule("acme/widgets", { status: "suggested", prs: [1] });
    expect(conventionRecallDocs()).toHaveLength(0);
    await updateConventions("acme/widgets", (file) => {
      file.rules[0].status = "accepted";
      file.rules[0].automaticDecision = { status: "accepted", reason: "Supported repo convention.", at: NOW };
    });
    expect(conventionRecallDocs()).toHaveLength(1);
  });
});

describe("conventionsNewestMtime", () => {
  it("is zero with nothing mined and moves when a repo file or the prefs change", async () => {
    expect(conventionsNewestMtime()).toBe(0);
    await addRule("acme/widgets");
    const afterRule = conventionsNewestMtime();
    expect(afterRule).toBeGreaterThan(0);

    // Whole seconds survive utimes' floating-point conversion without losing a millisecond.
    const future = new Date(Math.ceil(Date.now() / 1000) * 1000 + 60_000);
    await saveConventionsPrefs({ enabled: false });
    fs.utimesSync(path.join(notesDir, ".config", "conventions-prefs.json"), future, future);
    expect(conventionsNewestMtime()).toBeGreaterThanOrEqual(Math.floor(future.getTime()));
  });
});
