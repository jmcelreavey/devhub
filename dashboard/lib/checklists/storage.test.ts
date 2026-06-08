import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let tmpRepo: string;
let originalRepoRoot: string | undefined;

async function freshModule() {
  const url = new URL("./storage.ts", import.meta.url).href + `?t=${Date.now()}`;
  return await import(url);
}

beforeEach(() => {
  tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-checklists-"));
  originalRepoRoot = process.env.REPO_ROOT;
  process.env.REPO_ROOT = tmpRepo;
});

afterEach(() => {
  if (originalRepoRoot === undefined) delete process.env.REPO_ROOT;
  else process.env.REPO_ROOT = originalRepoRoot;
  fs.rmSync(tmpRepo, { recursive: true, force: true });
});

describe("checklist storage", () => {
  it("creates file-backed master lists", async () => {
    const m = await freshModule();
    const master = await m.createMasterList({ name: "Garden tools", scopePath: "yard-tools" });

    expect(master.scopePath).toBe("yard-tools");
    expect(m.listMasterLists()).toHaveLength(1);
  });

  it("creates a global master when scope path is empty", async () => {
    const m = await freshModule();
    const master = await m.createMasterList({ name: "Global", scopePath: "" });

    expect(master.scopePath).toBe("");
    expect(m.getMasterByScopePath("")).toEqual(master);
  });

  it("rejects duplicate scope paths", async () => {
    const m = await freshModule();
    await m.createMasterList({ name: "A", scopePath: "dup-scope" });
    await expect(m.createMasterList({ name: "B", scopePath: "dup-scope" })).rejects.toThrow(
      /already exists/,
    );
  });

  it("toggles item checked state", async () => {
    const m = await freshModule();
    const master = await m.createMasterList({ name: "Tools", scopePath: "shed" });
    const item = await m.addMasterItem(master.id, { name: "Spade", checked: false });

    const updated = await m.updateMasterItem(master.id, item!.id, { checked: true });
    expect(updated?.checked).toBe(true);
    expect(m.getMasterList(master.id)?.items[0].checked).toBe(true);
  });

  it("promotes items to master by name", async () => {
    const m = await freshModule();
    const master = await m.createMasterList({ name: "Garden", scopePath: "promote-scope" });
    const first = await m.promoteItemToMaster(master.id, { name: "Compost", checked: true });
    const second = await m.promoteItemToMaster(master.id, { name: "compost", checked: false });

    expect(second?.id).toBe(first?.id);
    expect(second?.checked).toBe(false);
  });

  it("migrates legacy inventory collections", async () => {
    const m = await freshModule();
    const dir = path.join(tmpRepo, "collections");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "legacy.json"),
      JSON.stringify({
        id: "legacy",
        name: "Gardening",
        kind: "inventory",
        notePath: "migrated-scope",
        items: [{ id: "x", name: "Shovel", owned: true, createdAt: "2026-01-01", updatedAt: "2026-01-01" }],
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
      }),
    );

    const masters = m.listMasterLists();
    expect(masters).toHaveLength(1);
    expect(masters[0].scopePath).toBe("migrated-scope");
    expect(masters[0].items[0]).toMatchObject({ name: "Shovel", checked: true });
  });
});
