import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { claimSlackEnvelope, knownSlackBotThread, rememberSlackBotThread, recordSlackTest, reserveSlackSend } from "./store";

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "slack-store-")); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe("Slack durable dedupe", () => {
  it("recognises only recorded bot threads, scoped to device, owner, workspace and channel, across reloads", async () => {
    const key = JSON.stringify(["device", "T1", "U1", "C1", "1.000"]);
    expect(knownSlackBotThread(key, root, 1000)).toBe(false);
    await rememberSlackBotThread(key, root, 1000);
    expect(knownSlackBotThread(key, root, 2000)).toBe(true);
    expect(knownSlackBotThread(key.replace("C1", "C2"), root, 2000)).toBe(false);
    expect(knownSlackBotThread(key, root, 31 * 86400_000)).toBe(false);
  });
  it("deduplicates envelopes, event retries and message/app-mention copies after reload", async () => {
    expect(await claimSlackEnvelope(["envelope:1", "event:1", "message:1"], root, 1000)).toBe(true);
    for (const keys of [["envelope:1"], ["envelope:2", "event:1"], ["event:2", "message:1"]]) expect(await claimSlackEnvelope(keys, root, 2000)).toBe(false);
    expect(await claimSlackEnvelope(["envelope:3", "event:3", "message:3"], root, 2000)).toBe(true);
    expect(fs.readFileSync(path.join(root, "state.json"), "utf8")).not.toContain("envelope:");
    expect(fs.statSync(path.join(root, "state.json")).mode & 0o777).toBe(0o600);
  });
  it("allows exactly one claim under concurrency", async () => {
    expect(await Promise.all([claimSlackEnvelope(["same"], root), claimSlackEnvelope(["same"], root)])).toEqual([true, false]);
  });
  it("expires claims after a day and starts clean, keeping the evidence, when the state file is corrupt", async () => {
    await claimSlackEnvelope(["same"], root, 0);
    expect(await claimSlackEnvelope(["same"], root, 24 * 60 * 60 * 1000 + 1)).toBe(true);
    fs.writeFileSync(path.join(root, "state.json"), "broken");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await claimSlackEnvelope(["new"], root)).toBe(true);
    expect(fs.readdirSync(root).some((name) => name.startsWith("state.json.corrupt-"))).toBe(true);
  });
  it("paces posts persistently across callers", async () => {
    expect(await reserveSlackSend(root, 1000)).toBe(0);
    expect(await reserveSlackSend(root, 1000)).toBe(1100);
    expect(await reserveSlackSend(root, 1500)).toBe(1700);
  });
  it("sends a test once for a request ID without losing the shared pacing state", async () => {
    const send = vi.fn(async () => { await reserveSlackSend(root, 1000); return { state: "sent" as const, detail: "Sent." }; });
    await recordSlackTest("request", "revision", "work", send, root);
    expect(await recordSlackTest("request", "revision", "work", send, root)).toEqual({ state: "sent", detail: "Sent." });
    expect(send).toHaveBeenCalledTimes(1);
    expect(await reserveSlackSend(root, 1000)).toBe(1100);
  });
  it("never retries an interrupted/unknown test and binds its settings and profile", async () => {
    const send = vi.fn(async () => { throw new Error("interrupted"); });
    await expect(recordSlackTest("request", "revision", "work", send, root)).rejects.toThrow();
    expect(await recordSlackTest("request", "revision", "work", send, root)).toMatchObject({ state: "unknown" });
    expect(send).toHaveBeenCalledTimes(1);
    await expect(recordSlackTest("request", "changed", "work", send, root)).rejects.toThrow("test-settings-changed");
    await expect(recordSlackTest("request", "revision", "personal", send, root)).rejects.toThrow("test-settings-changed");
  });
});
