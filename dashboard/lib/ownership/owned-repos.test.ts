import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let repoRoot: string;

vi.mock("@/lib/notes/dir", () => ({
  getRepoRoot: () => repoRoot,
  getNotesDir: () => path.join(repoRoot, "notes"),
}));

vi.mock("@/lib/repos", () => ({
  listRepos: async () => [],
  getGithubFullNameForLocalRepo: () => null,
}));

vi.mock("@/lib/gh-exec", () => ({
  execGh: async () => ({ stdout: "", stderr: "", status: 0 }),
}));

const {
  addOwnedRepo,
  getOwnedRepo,
  listOwnedRepos,
  readLearnedDomains,
  recordLearnedDomain,
  recordOwnedRepoVisit,
  removeOwnedRepo,
} = await import("./owned-repos");

beforeEach(() => {
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-owned-"));
});

afterEach(() => {
  fs.rmSync(repoRoot, { recursive: true, force: true });
});

describe("owned repo storage", () => {
  it("starts empty and survives a missing file", () => {
    expect(listOwnedRepos()).toEqual([]);
  });

  it("adds a repo and reads it back", async () => {
    const added = await addOwnedRepo("acme/widgets");
    expect(added.fullName).toBe("acme/widgets");
    expect(added.name).toBe("widgets");
    expect(added.lastSeenSha).toBeNull();
    expect(listOwnedRepos().map((repo) => repo.fullName)).toEqual(["acme/widgets"]);
  });

  it("keeps the list sorted so tab order is stable", async () => {
    await addOwnedRepo("acme/zebra");
    await addOwnedRepo("acme/apple");
    expect(listOwnedRepos().map((repo) => repo.fullName)).toEqual(["acme/apple", "acme/zebra"]);
  });

  it("is idempotent, and stays so under concurrent adds", async () => {
    // The check used to sit outside the mutex, so two simultaneous adds could
    // both observe "absent" and append duplicate entries.
    await Promise.all([
      addOwnedRepo("acme/widgets"),
      addOwnedRepo("acme/widgets"),
      addOwnedRepo("acme/widgets"),
    ]);
    expect(listOwnedRepos()).toHaveLength(1);
  });

  it("matches case-insensitively without rewriting what the user typed", async () => {
    await addOwnedRepo("Acme/Widgets");
    expect(getOwnedRepo("acme/widgets")?.fullName).toBe("Acme/Widgets");
    await addOwnedRepo("acme/widgets");
    expect(listOwnedRepos()).toHaveLength(1);
  });

  it("rejects anything that is not owner/name", async () => {
    await expect(addOwnedRepo("widgets")).rejects.toThrow(/owner\/name/);
    await expect(addOwnedRepo("acme/widgets/extra")).rejects.toThrow(/owner\/name/);
    await expect(addOwnedRepo("acme/wid gets")).rejects.toThrow(/owner\/name/);
  });

  it("removes a repo without disturbing the others", async () => {
    await addOwnedRepo("acme/widgets");
    await addOwnedRepo("acme/gadgets");
    await removeOwnedRepo("ACME/WIDGETS");
    expect(listOwnedRepos().map((repo) => repo.fullName)).toEqual(["acme/gadgets"]);
  });

  it("removing something absent is a no-op", async () => {
    await addOwnedRepo("acme/widgets");
    await removeOwnedRepo("acme/nothing");
    expect(listOwnedRepos()).toHaveLength(1);
  });
});

describe("catch-up watermark", () => {
  it("records the sha the owner has caught up to", async () => {
    await addOwnedRepo("acme/widgets");
    await recordOwnedRepoVisit("acme/widgets", "abc1234");
    const repo = getOwnedRepo("acme/widgets");
    expect(repo?.lastSeenSha).toBe("abc1234");
    expect(repo?.lastVisited).toBeTruthy();
  });

  it("keeps the previous sha when handed an empty one", async () => {
    await addOwnedRepo("acme/widgets");
    await recordOwnedRepoVisit("acme/widgets", "abc1234");
    await recordOwnedRepoVisit("acme/widgets", "");
    expect(getOwnedRepo("acme/widgets")?.lastSeenSha).toBe("abc1234");
  });
});

describe("familiarity records", () => {
  it("round-trips learned domains per repo", async () => {
    await addOwnedRepo("acme/widgets");
    await recordLearnedDomain("acme/widgets", "payments");
    expect(Object.keys(readLearnedDomains("acme/widgets"))).toEqual(["payments"]);
    expect(readLearnedDomains("acme/gadgets")).toEqual({});
  });

  it("keeps each repo's records in its own file", async () => {
    await recordLearnedDomain("acme/widgets", "payments");
    await recordLearnedDomain("acme/gadgets", "search");
    expect(readLearnedDomains("acme/widgets")).toHaveProperty("payments");
    expect(readLearnedDomains("acme/widgets")).not.toHaveProperty("search");
  });

  it("writes inside the ownership directory, never outside it", async () => {
    await recordLearnedDomain("acme/widgets", "payments");
    const files = fs.readdirSync(path.join(repoRoot, ".devhub", "ownership"));
    expect(files).toContain("acme__widgets.json");
  });
});
