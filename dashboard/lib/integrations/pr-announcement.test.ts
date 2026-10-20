import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const settings = vi.hoisted(() => ({ allowedUserId: "UOWNER123" }));
vi.mock("./slack/settings", () => ({ readSlackSettings: () => settings }));
vi.mock("./accounts", () => ({ credential: () => "https://hooks.slack.com/services/T123/B123/testsecret" }));
import { DestinationSchema, EVENT_LABELS, EventKind, type DestinationInput } from "./alert-types";
import { alertRequest, sendAlert } from "./alert-send";
import { decideDelivery, processAlerts, readAlerts, saveDestination } from "./alert-store";
import { announcementTitle, prAnnouncementText, PrAnnouncementSchema, reviewVerdict } from "./pr-announcement";

const now = new Date("2026-10-20T12:00:00Z");
const at = new Date(now.getTime() + 1000);
const pr = { url: "https://github.com/owner/my_repo/pull/123", title: "Fix the retry", verdict: "pass" as const, notes: 2 };
const event = { id: "pr-reviewed:owner/my_repo:123:run1", at: at.toISOString(), kind: "pr-reviewed" as const, taskId: "t1", announcement: pr };
let root: string;
function destination(extra: Partial<DestinationInput> = {}): DestinationInput {
  return { id: randomUUID(), label: "Team", provider: "slack", credentialRef: "SLACK", workProfile: "work", events: ["pr-reviewed", "pr-ready"], enabled: true, ...extra };
}
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "pr-announcements-")); settings.allowedUserId = "UOWNER123"; });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe("PR announcement text", () => {
  it("includes the owner, repo, PR, title and a bounded verdict", () => {
    expect(prAnnouncementText("pr-reviewed", pr, "UOWNER123")).toBe("<@UOWNER123> your PR got an AI review: <https://github.com/owner/my_repo/pull/123|owner/my_repo#123 · Fix the retry>. Verdict: looks good with 2 notes.");
    expect(prAnnouncementText("pr-ready", { ...pr, jira: "PTF-1234" }, "UOWNER123")).toContain("your PR for PTF-1234 is ready for a human review");
    expect(prAnnouncementText("pr-ready", { ...pr, stage: "opened" }, "UOWNER123")).toContain("opened a PR:");
    expect(prAnnouncementText("pr-reviewed", { ...pr, verdict: undefined }, "UOWNER123")).not.toContain("Verdict:");
    expect(reviewVerdict("Review\n**Verdict: looks good with 2 notes.**\nsecret diff")).toEqual({ verdict: "pass", notes: 2 });
    expect(reviewVerdict("Verdict: changes requested")).toEqual({ verdict: "changes-requested" });
    expect(reviewVerdict("Pass failed: /Users/private/token")).toEqual({});
  });
  it("escapes mention, link, entity and channel injection; only the configured owner is tagged", () => {
    const title = "<@UEVIL> <!channel> <!here> <!subteam^S123> @channel @here &lt;@UEVIL&gt; | > *bold* `code` https://evil.test/token";
    const text = prAnnouncementText("pr-reviewed", { ...pr, title }, "UOWNER123");
    expect(text.match(/<@[^>]+>/g)).toEqual(["<@UOWNER123>"]);
    expect(text.match(/<https?:[^>]+>/g)).toHaveLength(1);
    expect(text).not.toMatch(/<!|@channel|@here|evil\.test|\*bold\*|`code`/);
    expect(text).toContain("&amp;lt;＠UEVIL&amp;gt;");
    expect(text).toContain("¦");
    expect(() => prAnnouncementText("pr-reviewed", pr, "UOWNER><!channel")).toThrow();
    for (const url of ["https://github.com/owner/repo/pull/1?token=secret", "https://github.com/owner/repo/pull/1#x", "https://evil.test/owner/repo/pull/1", "https://user:secret@github.com/owner/repo/pull/1", "http://github.com/owner/repo/pull/1"]) {
      expect(PrAnnouncementSchema.safeParse({ ...pr, url }).success).toBe(false);
    }
  });
  it("caps titles and removes local paths, tokens and raw review content", () => {
    const title = announcementTitle("Fix /Users/john/private/file token=secret xo" + "xb-secret-token " + "x".repeat(1000));
    expect(title.length).toBeLessThanOrEqual(240);
    expect(title).not.toMatch(/\/Users|xoxb|token=secret/);
    expect(prAnnouncementText("pr-reviewed", { ...pr, title }, "UOWNER123").length).toBeLessThan(2000);
  });
});

describe("PR alert consent and delivery", () => {
  it("adds event kinds without opting existing destinations into events or details", async () => {
    expect(EventKind.options).toEqual(Object.keys(EVENT_LABELS));
    expect(DestinationSchema.safeParse(destination({ events: [...EventKind.options] })).success).toBe(true);
    const old = destination({ events: ["review-ready"] });
    await saveDestination(old, 0, "work", root, now);
    const send = vi.fn();
    await processAlerts([event], "work", { root, now: at, send });
    expect(send).not.toHaveBeenCalled();
    expect(readAlerts(root).destinations[0].includePrDetails).toBeUndefined();
    expect(readAlerts(root).destinations[0].events).toEqual(["review-ready"]);
  });
  it("keeps details out of the outbox and payload until separately opted in", async () => {
    const saved = await saveDestination(destination(), 0, "work", root, now);
    const send = vi.fn().mockResolvedValue({ state: "sent", detail: "ok" });
    await processAlerts([event], "work", { root, now: at, send });
    const entry = readAlerts(root).outbox[0];
    expect(entry.announcement).toBeUndefined();
    const payload = JSON.parse(alertRequest(saved, { ...entry, announcement: pr }, "https://hooks.slack.com/services/T123/B123/testsecret").body);
    expect(payload.mrkdwn).toBe(false);
    expect(payload.text).not.toMatch(/my_repo|Fix the retry|<@/);
  });
  it("sends rich details through the existing sender and deduplicates repeated ticks and restarts", async () => {
    await saveDestination(destination({ includePrDetails: true }), 0, "work", root, now);
    const fetcher = vi.fn().mockResolvedValue(new Response("ok"));
    const send = vi.fn((d, e) => sendAlert(d, e, fetcher));
    await processAlerts([event, event], "work", { root, now: at, send });
    await processAlerts([event], "work", { root, now: new Date(at.getTime() + 5000), send });
    expect(send).toHaveBeenCalledTimes(1);
    expect(readAlerts(root).outbox).toHaveLength(1);
    expect(readAlerts(root).outbox[0]).toMatchObject({ announcement: pr, state: "sent", consentRevision: 1 });
    const payload = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(payload).toMatchObject({ mrkdwn: true, parse: "none", link_names: false, unfurl_links: false, unfurl_media: false });
    expect(payload.text).toContain("<@UOWNER123>");
  });
  it("requires a configured owner and refuses rich Telegram settings", async () => {
    settings.allowedUserId = "";
    await expect(saveDestination(destination({ includePrDetails: true }), 0, "work", root, now)).rejects.toThrow(/Slack user ID/);
    expect(DestinationSchema.safeParse(destination({ provider: "telegram", chatId: "123", includePrDetails: true })).success).toBe(false);
  });
  it("requires fresh consent after changing details and cancels queued content under the old revision", async () => {
    const value = destination({ includePrDetails: true, quiet: { start: "11:00", end: "14:00", timeZone: "UTC" } });
    await saveDestination(value, 0, "work", root, now);
    const send = vi.fn();
    await processAlerts([event], "work", { root, now: at, send });
    const oldEntry = readAlerts(root).outbox[0];
    expect(oldEntry.state).toBe("pending");
    const revised = await saveDestination({ ...value, includePrDetails: false }, 1, "work", root, at);
    expect(revised.revision).toBe(2);
    expect(revised.consentAt).toBe(at.toISOString());
    expect(readAlerts(root).outbox[0].state).toBe("cancelled");
    await expect(saveDestination(value, 1, "work", root, at)).rejects.toMatchObject({ kind: "conflict" });
    await expect(decideDelivery(oldEntry.id, true, "work", root)).rejects.toMatchObject({ kind: "conflict" });
    await processAlerts([event], "work", { root, now: new Date("2026-10-20T15:00:00Z"), send });
    expect(send).not.toHaveBeenCalled();
  });
  it("blocks pre-consent, stale, invalid and future timestamps and another profile", async () => {
    await saveDestination(destination({ includePrDetails: true }), 0, "work", root, new Date(now.getTime() - 3 * 86400000));
    const send = vi.fn();
    for (const stamp of [new Date(now.getTime() - 25 * 3600000).toISOString(), "invalid", new Date(now.getTime() + 60000).toISOString()]) {
      await processAlerts([{ ...event, at: stamp }], "work", { root, now, send });
    }
    await processAlerts([event], "personal", { root, now: at, send });
    expect(send).not.toHaveBeenCalled();
    expect(readAlerts(root).outbox).toEqual([]);
  });
  it("cancels queued announcements when a task is no longer eligible", async () => {
    await saveDestination(destination({ includePrDetails: true, quiet: { start: "11:00", end: "14:00", timeZone: "UTC" } }), 0, "work", root, now);
    const send = vi.fn();
    await processAlerts([event], "work", { root, now: at, send });
    await processAlerts([], "work", { root, now: new Date("2026-10-20T15:00:00Z"), send });
    expect(readAlerts(root).outbox[0].state).toBe("cancelled");
    expect(send).not.toHaveBeenCalled();
  });
  it("defers PRs when sources are unavailable while ordinary alerts keep working", async () => {
    await saveDestination(destination({ includePrDetails: true, events: ["pr-reviewed", "question"] }), 0, "work", root, now);
    const send = vi.fn().mockResolvedValueOnce({ state: "pending", retryAfter: 60, detail: "rate" }).mockResolvedValue({ state: "sent", detail: "ok" });
    await processAlerts([event], "work", { root, now: at, send });
    const later = new Date(at.getTime() + 70000);
    await processAlerts([{ id: "question", kind: "question", taskId: "t1", at: later.toISOString() }], "work", { root, now: later, send, deferPrAlerts: true });
    expect(readAlerts(root).outbox.map((entry) => entry.state)).toEqual(["pending", "sent"]);
    expect(send).toHaveBeenCalledTimes(2);
    await processAlerts([event], "work", { root, now: new Date(later.getTime() + 5000), send });
    expect(readAlerts(root).outbox[0].state).toBe("sent");
    expect(send).toHaveBeenCalledTimes(3);
  });
  it("keeps credential confirmation and never retries an unknown rich delivery automatically", async () => {
    const saved = await saveDestination(destination({ includePrDetails: true }), 0, "work", root, now);
    const fetcher = vi.fn().mockRejectedValue(new Error("timeout"));
    const send = vi.fn((d, e) => sendAlert(d, e, fetcher));
    await processAlerts([event], "work", { root, now: at, send });
    await processAlerts([event], "work", { root, now: new Date(at.getTime() + 5000), send });
    expect(readAlerts(root).outbox[0].state).toBe("unknown");
    expect(send).toHaveBeenCalledTimes(1);
    fetcher.mockClear();
    expect(await sendAlert({ ...saved, credentialHash: "changed" }, readAlerts(root).outbox[0], fetcher)).toMatchObject({ state: "failed" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
