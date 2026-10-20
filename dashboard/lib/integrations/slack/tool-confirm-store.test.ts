import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CONFIRM_TTL_MS, ToolConfirmStore } from "./tool-confirm-store";

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "slack-confirm-")); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const input = { kind: "run" as const, tool: "jobs_run", args: { id: "x" }, profile: "work", teamId: "T1", userId: "U1", channel: "C1" };
const who = { userId: "U1", teamId: "T1", channel: "C1" };

describe("ToolConfirmStore kinds", () => {
  it.each(["undo", "view"] as const)("stores a %s entry with its label and only lets that kind claim it", async (kind) => {
    const store = new ToolConfirmStore(root);
    const id = await store.create({ ...input, kind, label: "Fix the ad slot" });
    expect(await store.claim(id, who, "consumed", kind === "undo" ? "view" : "undo")).toEqual({ ok: false, reason: "wrong-kind" });
    expect(await store.claim(id, who, "consumed", "run")).toEqual({ ok: false, reason: "wrong-kind" });
    expect(await store.claim(id, who, "consumed", kind)).toMatchObject({ ok: true, entry: { kind, label: "Fix the ad slot" } });
    expect(await store.claim(id, who, "consumed", kind)).toEqual({ ok: false, reason: "used" });
  });
});

describe("ToolConfirmStore", () => {
  it("lets exactly one claim win and stores the file privately", async () => {
    const store = new ToolConfirmStore(root);
    const id = await store.create(input);
    expect(id).toMatch(/^[a-f0-9]{32}$/);
    expect(await store.claim(id, who)).toMatchObject({ ok: true, entry: { tool: "jobs_run", args: { id: "x" } } });
    expect(await store.claim(id, who)).toEqual({ ok: false, reason: "used" });
    expect((fs.statSync(path.join(root, "tool-confirm.json")).mode & 0o777)).toBe(0o600);
  });
  it("expires and forgets unknown ids", async () => {
    let now = 0;
    const store = new ToolConfirmStore(root, () => now);
    const id = await store.create(input);
    expect(await store.claim("nope", who)).toEqual({ ok: false, reason: "missing" });
    now = CONFIRM_TTL_MS + 1;
    expect(await store.claim(id, who)).toEqual({ ok: false, reason: "expired" });
  });
  it("does not consume the entry for the wrong user, team or channel", async () => {
    const store = new ToolConfirmStore(root);
    const id = await store.create(input);
    for (const patch of [{ userId: "U2" }, { teamId: "T2" }, { channel: "C2" }]) expect(await store.claim(id, { ...who, ...patch })).toEqual({ ok: false, reason: "wrong-user" });
    expect((await store.claim(id, who)).ok).toBe(true);
  });
  it("marks a cancel as used", async () => {
    const store = new ToolConfirmStore(root);
    const id = await store.create(input);
    expect((await store.claim(id, who, "cancelled")).ok).toBe(true);
    expect(await store.claim(id, who)).toEqual({ ok: false, reason: "used" });
  });
  it("keeps concurrent claims single-use", async () => {
    const store = new ToolConfirmStore(root);
    const id = await store.create(input);
    const results = await Promise.all([store.claim(id, who), store.claim(id, who), store.claim(id, who)]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
  });
  it("refuses a button of the wrong kind without using the entry up", async () => {
    const store = new ToolConfirmStore(root);
    const pick = await store.create({ ...input, kind: "pick" });
    expect(await store.claim(pick, who, "consumed", "run")).toEqual({ ok: false, reason: "wrong-kind" });
    expect(await store.claim(pick, who, "consumed", "pick")).toMatchObject({ ok: true });
    const run = await store.create(input);
    expect(await store.claim(run, who, "consumed", "pick")).toEqual({ ok: false, reason: "wrong-kind" });
    expect(await store.claim(run, { ...who, userId: "U2" }, "consumed", "run")).toEqual({ ok: false, reason: "wrong-user" });
    expect(await store.claim(run, who, "consumed", "run")).toMatchObject({ ok: true });
  });
});
