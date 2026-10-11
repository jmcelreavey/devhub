import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./accounts", () => ({ credential: (ref: string) => ref === "SLACK" ? "https://hooks.slack.com/services/T123/B123/secret123" : "123456:abcdefghijklmnopqrstuvwxyz" }));
import { readAlerts, saveDestination, processAlerts, decideDelivery, classifyAlert, sendTestAlert } from "./alert-store";
import { DestinationSchema, alertText, isQuiet, safeBaseUrl, type DestinationInput, type AlertEntry } from "./alert-types";
import { alertRequest, sendAlert } from "./alert-send";
let root: string;
const now = new Date("2026-10-09T12:00:00Z");
const at = new Date(now.getTime() + 1000);
function destination(extra: Partial<DestinationInput> = {}): DestinationInput { return { id: randomUUID(), label: "Work", provider: "slack", credentialRef: "SLACK", workProfile: "work", events: ["approval-ready", "check-failed"], enabled: true, ...extra }; }
const event = { id: "event1", at: at.toISOString(), taskId: "task1", kind: "approval-ready" as const };
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-alerts-")); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });
describe("opt-in durable alerts", () => {
  it.each(["slack", "telegram"] as const)("sends a fixed %s test only under saved consent, even during quiet hours", async (provider) => {
    const value = destination({ provider, ...(provider === "telegram" ? { credentialRef: "BOT", chatId: "7" } : {}), quiet: { start: "11:00", end: "14:00", timeZone: "UTC" } });
    const saved = await saveDestination(value, 0, "work", root, now);
    const send = vi.fn().mockResolvedValue({ state: "sent", detail: "Accepted by provider.", receipt: "123" });
    const requestId = randomUUID();
    const first = await sendTestAlert(saved.id, saved.revision, requestId, "work", { root, now, send });
    expect(first).toMatchObject({ kind: "test", state: "sent", attempts: 1 });
    expect(send).toHaveBeenCalledExactlyOnceWith(saved, expect.objectContaining({ kind: "test", taskId: "" }));
    expect(await sendTestAlert(saved.id, saved.revision, requestId, "work", { root, now, send })).toEqual(first);
    expect(send).toHaveBeenCalledTimes(1);
    expect(readAlerts(root).destinations).toEqual([saved]);
    expect(readAlerts(root).outbox).toHaveLength(1);
    expect(alertText("test", "private-title", "https://devhub.example.com")).not.toMatch(/private-title|https/);
  });
  it("refuses missing, wrong-profile, stale or revoked destinations without sending", async () => {
    const saved = await saveDestination(destination(), 0, "work", root, now);
    const send = vi.fn(); const options = { root, now, send };
    for (const [id, revision, profile] of [[randomUUID(), 1, "work"], [saved.id, 1, "personal"], [saved.id, 2, "work"]] as const) {
      await expect(sendTestAlert(id, revision, randomUUID(), profile, options)).rejects.toMatchObject({ kind: "conflict" });
    }
    await saveDestination({ ...destination({ id: saved.id }), enabled: false }, 1, "work", root, now);
    await expect(sendTestAlert(saved.id, 2, randomUUID(), "work", options)).rejects.toMatchObject({ kind: "conflict" });
    expect(send).not.toHaveBeenCalled(); expect(readAlerts(root).outbox).toEqual([]);
  });
  it("deduplicates concurrent tests and recovers interrupted sends without repeating them", async () => {
    const saved = await saveDestination(destination(), 0, "work", root, now);
    const requestId = randomUUID(); const send = vi.fn().mockResolvedValue({ state: "sent", detail: "Accepted." });
    const results = await Promise.all([1, 2].map(() => sendTestAlert(saved.id, 1, requestId, "work", { root, now, send })));
    expect(results[0]).toEqual(results[1]); expect(send).toHaveBeenCalledTimes(1);
    const interruptedId = randomUUID(); const later = new Date(now.getTime() + 5000);
    await expect(sendTestAlert(saved.id, 1, interruptedId, "work", { root, now: later, send: async () => { throw new Error("crash"); } })).rejects.toThrow("crash");
    expect(await sendTestAlert(saved.id, 1, interruptedId, "work", { root, now: later, send })).toMatchObject({ state: "unknown" });
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("rate-limits tests and never automatically retries a rate-limited or uncertain test", async () => {
    const saved = await saveDestination(destination(), 0, "work", root, now);
    const send = vi.fn().mockResolvedValue({ state: "pending", retryAfter: 60, detail: "rate" });
    const result = await sendTestAlert(saved.id, 1, randomUUID(), "work", { root, now, send });
    expect(result.state).toBe("failed"); expect(result.detail).toContain("No automatic retry");
    await expect(sendTestAlert(saved.id, 1, randomUUID(), "work", { root, now, send })).rejects.toMatchObject({ kind: "rate-limit" });
    await processAlerts([], "work", { root, now: new Date(now.getTime() + 70000), send });
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("keeps provider errors and token-bearing fetch failures out of results and logs", async () => {
    const saved = await saveDestination(destination({ provider: "telegram", credentialRef: "BOT", chatId: "7" }), 0, "work", root, now);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const fetcher = vi.fn().mockRejectedValue(new Error("https://api.telegram.org/bot123456:abcdefghijklmnopqrstuvwxyz/sendMessage"));
      const result = await sendAlert(saved, { kind: "test", taskId: "" } as AlertEntry, fetcher);
      expect(result.state).toBe("unknown"); expect(JSON.stringify(result)).not.toContain("abcdefghijklmnopqrstuvwxyz"); expect(log).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });
  it("sends only after consent, in the chosen profile, and deduplicates after restart", async () => {
    const send = vi.fn().mockResolvedValue({ state: "sent", receipt: "accepted", detail: "Accepted." });
    await processAlerts([event], "work", { root, now: at, send }); expect(send).not.toHaveBeenCalled();
    await saveDestination(destination(), 0, "work", root, now);
    await processAlerts([event], "personal", { root, now: at, send }); expect(send).not.toHaveBeenCalled();
    await processAlerts([{ ...event, at: new Date(now.getTime() - 1).toISOString() }], "work", { root, now: at, send }); expect(send).not.toHaveBeenCalled();
    await processAlerts([event], "work", { root, now: at, send });
    await processAlerts([event], "work", { root, now: new Date(at.getTime() + 5000), send });
    expect(send).toHaveBeenCalledTimes(1); expect(readAlerts(root).outbox[0].state).toBe("sent");
  });
  it("revokes queued sends and rejects stale settings", async () => {
    const value = destination({ quiet: { start: "11:00", end: "14:00", timeZone: "UTC" } });
    await saveDestination(value, 0, "work", root, now);
    const send = vi.fn();
    await processAlerts([event], "work", { root, now: at, send });
    await saveDestination({ ...value, enabled: false }, 1, "work", root, at);
    await expect(saveDestination(value, 1, "work", root, at)).rejects.toMatchObject({ kind: "conflict" });
    await processAlerts([event], "work", { root, now: new Date("2026-10-09T15:00:00Z"), send });
    expect(send).not.toHaveBeenCalled(); expect(readAlerts(root).outbox[0].state).toBe("cancelled");
  });
  it("honours 429 backoff and leaves uncertain sends for explicit retry", async () => {
    await saveDestination(destination(), 0, "work", root, now);
    const send = vi.fn().mockResolvedValueOnce({ state: "pending", retryAfter: 60, detail: "rate" }).mockResolvedValueOnce({ state: "unknown", detail: "timeout" }).mockResolvedValueOnce({ state: "sent", detail: "ok" });
    await processAlerts([event], "work", { root, now: at, send });
    await processAlerts([event], "work", { root, now: new Date(at.getTime() + 59000), send }); expect(send).toHaveBeenCalledTimes(1);
    await processAlerts([event], "work", { root, now: new Date(at.getTime() + 61000), send });
    await processAlerts([event], "work", { root, now: new Date(at.getTime() + 120000), send }); expect(send).toHaveBeenCalledTimes(2);
    await decideDelivery(readAlerts(root).outbox[0].id, true, "work", root);
    await processAlerts([], "work", { root, now: new Date(at.getTime() + 180000), send }); expect(send).toHaveBeenCalledTimes(3);
  });
  it("recovers a crash during POST as unknown instead of repeating it", async () => {
    await saveDestination(destination(), 0, "work", root, now);
    await expect(processAlerts([event], "work", { root, now: at, send: async () => { throw new Error("crash"); } })).rejects.toThrow("crash");
    const send = vi.fn();
    await processAlerts([event], "work", { root, now: new Date(at.getTime() + 5000), send });
    expect(send).not.toHaveBeenCalled(); expect(readAlerts(root).outbox[0].state).toBe("unknown");
  });
  it("keeps messages generic and blocks credential changes and hostile webhook endpoints", async () => {
    const d = await saveDestination(destination(), 0, "work", root, now);
    const entry = { kind: "approval-ready", taskId: "task1" } as AlertEntry;
    expect(alertRequest(d, entry, "https://hooks.slack.com/services/T123/B123/secret123").body).not.toContain("secret123");
    for (const url of ["https://evil.test/services/T/B/x", "http://hooks.slack.com/services/T/B/x", "https://hooks.slack.com/services/T/B/x?token=oops"]) expect(() => alertRequest(d, entry, url)).toThrow();
    const fetcher = vi.fn();
    expect(await sendAlert({ ...d, credentialHash: "changed" }, entry, fetcher)).toMatchObject({ state: "failed" }); expect(fetcher).not.toHaveBeenCalled();
    expect(alertText("check-failed", "private-title", undefined)).not.toContain("private-title");
    expect(alertText("check-failed", "a/b", "https://devhub.example.com")).toContain("taskId=a%2Fb");
    for (const url of ["http://devhub.example.com", "https://localhost", "https://127.0.0.1", "https://devhub.example.com?secret=x"]) expect(safeBaseUrl(url)).toBe(false);
  });
  it("handles Slack acceptance, blocked Telegram, rate limits and network uncertainty with mocked sends", async () => {
    const slack = await saveDestination(destination(), 0, "work", root, now);
    const telegram = await saveDestination(destination({ provider: "telegram", credentialRef: "BOT", chatId: "-100123" }), 0, "work", root, now);
    const entry = { kind: "check-failed", taskId: "task1" } as AlertEntry;
    expect(await sendAlert(slack, entry, vi.fn().mockResolvedValue(new Response("ok")))).toMatchObject({ state: "sent", receipt: "webhook-accepted" });
    expect(await sendAlert(telegram, entry, vi.fn().mockResolvedValue(Response.json({ ok: false, error_code: 403 }, { status: 403 })))).toMatchObject({ state: "failed" });
    expect(await sendAlert(telegram, entry, vi.fn().mockResolvedValue(Response.json({ ok: false, error_code: 429, parameters: { retry_after: 40 } }, { status: 429 })))).toMatchObject({ state: "pending", retryAfter: 40 });
    expect(await sendAlert(slack, entry, vi.fn().mockRejectedValue(new Error("secret timeout")))).toMatchObject({ state: "unknown" });
  });
  it("handles overnight quiet hours, native event classification and parked WhatsApp", () => {
    const d = destination({ quiet: { start: "22:00", end: "08:00", timeZone: "Europe/London" } });
    expect(isQuiet(d, new Date("2026-10-09T23:00:00Z"))).toBe(true); expect(isQuiet(d, now)).toBe(false);
    expect(classifyAlert("Approval requested: commit-push")).toBe("approval-ready");
    expect(classifyAlert("random secret transcript")).toBeNull();
    for (const role of ["plan", "implement", "review", "discuss", "verify"]) expect(classifyAlert(role + " run: needs-attention")).toBe("question");
    expect(DestinationSchema.safeParse({ ...d, provider: "whatsapp" }).success).toBe(false);
    expect(DestinationSchema.safeParse({ ...d, provider: "telegram" }).success).toBe(false);
  });
});
