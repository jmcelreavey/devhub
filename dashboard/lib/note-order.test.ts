import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyVaultOrder, reorderOrderedVaultEntries } from "./vault/vault-order";
import type { TreeEntry } from "./vault/vault-storage";

let tmpRoot: string;

const tree: TreeEntry[] = [
  { type: "dir", name: "daily", path: "daily", children: [] },
  { type: "file", name: "alpha.json", path: "alpha.json" },
  { type: "file", name: "beta.json", path: "beta.json" },
];

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-vault-order-"));
});

afterEach(() => {
  if (tmpRoot) {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

describe("vault-order", () => {
  it("defaults to directories first, then alpha sort", async () => {
    const ordered = applyVaultOrder([...tree].reverse(), tmpRoot);

    expect(ordered.map((entry: TreeEntry) => entry.path)).toEqual(["daily", "alpha.json", "beta.json"]);
  });

  it("reorders entries from an explicit sibling path list", async () => {
    const ok = await reorderOrderedVaultEntries(tree, tmpRoot, ["beta.json", "daily", "alpha.json"]);

    expect(ok).toBe(true);
    expect(applyVaultOrder(tree, tmpRoot).map((entry: TreeEntry) => entry.path)).toEqual([
      "beta.json",
      "daily",
      "alpha.json",
    ]);
  });

  it("reorders explicit sibling subsets while preserving omitted siblings", async () => {
    const ok = await reorderOrderedVaultEntries(tree, tmpRoot, ["beta.json", "alpha.json"]);

    expect(ok).toBe(true);
    expect(applyVaultOrder(tree, tmpRoot).map((entry: TreeEntry) => entry.path)).toEqual([
      "daily",
      "beta.json",
      "alpha.json",
    ]);
  });

  it("rejects explicit sibling path lists with unknown paths", async () => {
    const ok = await reorderOrderedVaultEntries(tree, tmpRoot, ["beta.json", "missing.json"]);

    expect(ok).toBe(false);
    expect(applyVaultOrder(tree, tmpRoot).map((entry: TreeEntry) => entry.path)).toEqual([
      "daily",
      "alpha.json",
      "beta.json",
    ]);
  });

  it("serializes concurrent reorder writes", async () => {
    await Promise.all([
      reorderOrderedVaultEntries(tree, tmpRoot, ["beta.json", "daily", "alpha.json"]),
      reorderOrderedVaultEntries(tree, tmpRoot, ["beta.json", "daily", "alpha.json"]),
    ]);

    const ordered = applyVaultOrder(tree, tmpRoot).map((entry: TreeEntry) => entry.path);
    expect(ordered).toEqual(["beta.json", "daily", "alpha.json"]);
  });

  it("reorders nested folder children independently from an explicit path list", async () => {
    const nested: TreeEntry[] = [
      {
        type: "dir",
        name: "garden",
        path: "garden",
        children: [
          { type: "file", name: "compost.json", path: "garden/compost.json" },
          { type: "file", name: "beds.json", path: "garden/beds.json" },
        ],
      },
    ];

    const ok = await reorderOrderedVaultEntries(nested, tmpRoot, ["garden/beds.json", "garden/compost.json"]);

    expect(ok).toBe(true);
    expect(applyVaultOrder(nested, tmpRoot)[0].children?.map((entry: TreeEntry) => entry.path)).toEqual([
      "garden/beds.json",
      "garden/compost.json",
    ]);
  });
});
