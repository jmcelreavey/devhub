import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { OneTimeRecord, ShareRecord } from "./share-public";

/**
 * `share-store` resolves its state path from `$HOME` at module load, so each
 * test gets a fresh home and a fresh module registry rather than sharing one
 * `shares.json` across the file.
 */
async function loadStore(home: string) {
  process.env.HOME = home;
  vi.resetModules();
  return import("./share-store");
}

function sharesFile(home: string): string {
  return path.join(home, ".local/state/devhub/shares.json");
}

function writeRegistry(home: string, contents: unknown): void {
  const file = sharesFile(home);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(contents, null, 2));
}

function gistShare(overrides: Partial<ShareRecord> = {}): ShareRecord {
  return {
    key: "notes:projects/garden",
    vault: "notes",
    path: "projects/garden",
    title: "Garden",
    gistId: "abc123",
    url: "https://gist.github.com/me/abc123",
    createdAt: 1_000,
    updatedAt: 1_000,
    contentHash: "hash",
    ...overrides,
  };
}

function oneTime(overrides: Partial<OneTimeRecord> = {}): OneTimeRecord {
  return {
    id: "one",
    vault: "notes",
    path: "projects/garden",
    title: "Garden",
    url: "https://privatebin.net/?deadbeef#-key",
    pasteId: "deadbeef",
    deleteToken: "token",
    hasPassword: true,
    burnAfterReading: true,
    expire: "1day",
    createdAt: 1_000,
    expiresAt: 100_000,
    ...overrides,
  };
}

let home: string;
const originalHome = process.env.HOME;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-share-store-"));
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
  process.env.HOME = originalHome;
});

describe("v1 → v2 migration", () => {
  it("preserves existing gist shares", async () => {
    // The regression this guards: a version bump that falls through to the
    // default file silently drops every live gist, orphaning them on GitHub
    // with no local record left to delete them by.
    writeRegistry(home, { version: 1, shares: [gistShare()] });

    const store = await loadStore(home);
    const shares = store.listShares();

    expect(shares).toHaveLength(1);
    expect(shares[0].gistId).toBe("abc123");
    expect(store.listOneTimeShares()).toEqual([]);
  });

  it("persists as v2 once something is written", async () => {
    writeRegistry(home, { version: 1, shares: [gistShare()] });

    const store = await loadStore(home);
    await store.addOneTimeShare(oneTime({ expiresAt: Date.now() + 60_000 }));

    const written = JSON.parse(fs.readFileSync(sharesFile(home), "utf8")) as {
      version: number;
      shares: unknown[];
      oneTime: unknown[];
    };
    expect(written.version).toBe(2);
    expect(written.shares).toHaveLength(1);
    expect(written.oneTime).toHaveLength(1);
  });

  it("tolerates a v2 file with no oneTime array", async () => {
    writeRegistry(home, { version: 2, shares: [gistShare()] });

    const store = await loadStore(home);
    expect(store.listOneTimeShares()).toEqual([]);
    expect(store.listShares()).toHaveLength(1);
  });

  it("falls back to empty for an unknown future version", async () => {
    writeRegistry(home, { version: 99, shares: [gistShare()] });

    const store = await loadStore(home);
    expect(store.listShares()).toEqual([]);
  });
});

describe("one-time records", () => {
  it("round-trips through the store", async () => {
    const store = await loadStore(home);
    const record = oneTime({ expiresAt: Date.now() + 60_000 });
    await store.addOneTimeShare(record);

    expect(store.getOneTimeShare("one")).toMatchObject({ pasteId: "deadbeef" });
    expect(store.listOneTimeShares()).toHaveLength(1);
  });

  it("keeps multiple links for the same note", async () => {
    // Re-sharing must not replace the first link — it may already be in
    // somebody's inbox, and burning it early would strand them.
    const store = await loadStore(home);
    const expiresAt = Date.now() + 60_000;
    await store.addOneTimeShare(oneTime({ id: "a", expiresAt }));
    await store.addOneTimeShare(oneTime({ id: "b", expiresAt }));

    expect(store.listOneTimeShares()).toHaveLength(2);
  });

  it("hides expired links without deleting them", async () => {
    const store = await loadStore(home);
    await store.addOneTimeShare(oneTime({ id: "old", expiresAt: 1 }));
    await store.addOneTimeShare(oneTime({ id: "new", expiresAt: Date.now() + 60_000 }));

    expect(store.listOneTimeShares().map((r) => r.id)).toEqual(["new"]);
    expect(store.getOneTimeShare("old")).not.toBeNull();
  });

  it("sorts newest first", async () => {
    const store = await loadStore(home);
    const expiresAt = Date.now() + 60_000;
    await store.addOneTimeShare(oneTime({ id: "older", createdAt: 1, expiresAt }));
    await store.addOneTimeShare(oneTime({ id: "newer", createdAt: 2, expiresAt }));

    expect(store.listOneTimeShares().map((r) => r.id)).toEqual(["newer", "older"]);
  });

  it("returns the record on remove so the caller can revoke the paste", async () => {
    const store = await loadStore(home);
    await store.addOneTimeShare(oneTime({ expiresAt: Date.now() + 60_000 }));

    const removed = await store.removeOneTimeShare("one");
    expect(removed?.deleteToken).toBe("token");
    expect(store.getOneTimeShare("one")).toBeNull();
    expect(await store.removeOneTimeShare("one")).toBeNull();
  });

  it("prunes only expired records", async () => {
    const store = await loadStore(home);
    await store.addOneTimeShare(oneTime({ id: "old", expiresAt: 1 }));
    await store.addOneTimeShare(oneTime({ id: "new", expiresAt: Date.now() + 60_000 }));

    expect(await store.pruneExpiredOneTimeShares()).toBe(1);
    expect(store.getOneTimeShare("old")).toBeNull();
    expect(store.getOneTimeShare("new")).not.toBeNull();
    expect(await store.pruneExpiredOneTimeShares()).toBe(0);
  });
});

describe("clearing is scoped to one kind of link", () => {
  it("clearShares leaves one-time links alone", async () => {
    // One button wiping both lists would be a genuinely nasty surprise.
    const store = await loadStore(home);
    await store.upsertShare(gistShare());
    await store.addOneTimeShare(oneTime({ expiresAt: Date.now() + 60_000 }));

    const removed = await store.clearShares();
    expect(removed).toHaveLength(1);
    expect(store.listShares()).toEqual([]);
    expect(store.listOneTimeShares()).toHaveLength(1);
  });

  it("clearOneTimeShares leaves gist shares alone", async () => {
    const store = await loadStore(home);
    await store.upsertShare(gistShare());
    await store.addOneTimeShare(oneTime({ expiresAt: Date.now() + 60_000 }));

    const removed = await store.clearOneTimeShares();
    expect(removed).toHaveLength(1);
    expect(store.listOneTimeShares()).toEqual([]);
    expect(store.listShares()).toHaveLength(1);
  });
});
