import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readStateFile } from "./state-file";
import { claimSlackEnvelope, reserveSlackSend } from "./store";
import { SlackThreadStore } from "./thread-store";
import { ToolConfirmStore } from "./tool-confirm-store";

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "slack-corrupt-")); vi.spyOn(console, "warn").mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }); });

const quarantined = (name: string) => fs.readdirSync(root).filter((file) => file.startsWith(`${name}.corrupt-`));

describe("corrupt Slack state files", () => {
  it("moves unparseable JSON aside and starts empty instead of throwing", () => {
    const file = path.join(root, "x.json");
    fs.writeFileSync(file, "{ not json");
    expect(readStateFile(file, (value) => value as { ok: true }, () => ({ ok: true as const }), () => 42)).toEqual({ ok: true });
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.readFileSync(`${file}.corrupt-42`, "utf8")).toBe("{ not json");
  });
  it("treats a schema mismatch the same way, and a missing file as plain empty state", () => {
    const file = path.join(root, "x.json");
    fs.writeFileSync(file, JSON.stringify({ version: 2 }));
    const parse = (value: unknown) => { if ((value as { version?: number }).version !== 1) throw new Error("bad"); return value; };
    expect(readStateFile(file, parse, () => "empty")).toBe("empty");
    expect(quarantined("x.json")).toHaveLength(1);
    expect(readStateFile(path.join(root, "absent.json"), parse, () => "empty")).toBe("empty");
    expect(fs.readdirSync(root).filter((name) => name.startsWith("absent"))).toEqual([]);
  });
  it("does not move aside a file a writer replaced while we were reading", () => {
    const file = path.join(root, "x.json");
    fs.writeFileSync(file, JSON.stringify({ stale: true }));
    const parse = () => { fs.writeFileSync(file, JSON.stringify({ fresh: true })); throw new Error("bad"); };
    readStateFile(file, parse, () => null);
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ fresh: true });
  });
  it("still throws on a real I/O error", () => {
    const file = path.join(root, "dir.json");
    fs.mkdirSync(file);
    expect(() => readStateFile(file, (value) => value, () => null)).toThrow();
  });
  it("resets the confirmation store and keeps issuing confirmations", async () => {
    fs.writeFileSync(path.join(root, "tool-confirm.json"), "\u0000\u0000garbage");
    const store = new ToolConfirmStore(root);
    const id = await store.create({ kind: "run", tool: "jobs_run", args: {}, profile: "work", teamId: "T", userId: "U", channel: "C" });
    expect(await store.claim(id, { userId: "U", teamId: "T", channel: "C" })).toMatchObject({ ok: true });
    expect(quarantined("tool-confirm.json")).toHaveLength(1);
  });
  it("resets the thread store", async () => {
    fs.writeFileSync(path.join(root, "threads.json"), "{\"version\":1,\"items\":");
    const store = new SlackThreadStore(root);
    expect(store.read()).toEqual({ version: 1, items: {}, confirmations: {} });
    await store.change((state) => { state.confirmations = {}; });
    expect(quarantined("threads.json")).toHaveLength(1);
  });
  it("resets the dedupe/send-pacing state", async () => {
    fs.writeFileSync(path.join(root, "state.json"), "oops");
    expect(await claimSlackEnvelope(["a"], root)).toBe(true);
    expect(await reserveSlackSend(root, 1000)).toBe(0);
    expect(quarantined("state.json")).toHaveLength(1);
  });
});
