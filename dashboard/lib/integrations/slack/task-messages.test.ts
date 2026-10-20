import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SlackTaskMessageStore } from "./task-messages";

const audience = { teamId: "TTEAM", userId: "UOWNER", channel: "CCHANNEL" };
const ref = { profile: "work", taskId: "task-1", date: "2026-10-12", title: "Fix the ad slot" };
let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "slack-task-messages-")); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe("task message map", () => {
  it("maps a posted message to its task and thread, bound to the audience, with private permissions", async () => {
    const store = new SlackTaskMessageStore(root);
    await store.remember(audience, "CCHANNEL", "100.1", ref, "90.1");
    expect(new SlackTaskMessageStore(root).taskFor(audience, "CCHANNEL", "100.1")).toEqual({ ...ref, threadTs: "90.1" });
    expect(store.taskFor({ ...audience, userId: "UOTHER" }, "CCHANNEL", "100.1")).toBeUndefined();
    expect(store.taskFor({ ...audience, teamId: "TOTHER" }, "CCHANNEL", "100.1")).toBeUndefined();
    expect(store.taskFor(audience, "COTHER", "100.1")).toBeUndefined();
    expect(store.taskFor(audience, "CCHANNEL", "999.9")).toBeUndefined();
    expect(store.threadFor(audience, "work", "task-1")).toEqual({ channel: "CCHANNEL", ts: "90.1" });
    expect(fs.statSync(path.join(root, "task-messages.json")).mode & 0o777).toBe(0o600);
  });
  it("remembers a task's progress thread root and makes the root a message a ✅ can act on", async () => {
    const store = new SlackTaskMessageStore(root);
    await store.rememberThread(audience, "CCHANNEL", "200.1", ref);
    expect(store.threadFor(audience, "work", "task-1")).toEqual({ channel: "CCHANNEL", ts: "200.1" });
    expect(store.threadFor(audience, "personal", "task-1")).toBeUndefined();
    expect(store.threadFor({ ...audience, userId: "UOTHER" }, "work", "task-1")).toBeUndefined();
    expect(store.threadFor({ ...audience, teamId: "TOTHER" }, "work", "task-1")).toBeUndefined();
    expect(store.threadFor({ ...audience, channel: "COTHER" }, "work", "task-1")).toBeUndefined();
    expect(store.taskFor(audience, "CCHANNEL", "200.1")).toMatchObject({ taskId: "task-1", threadTs: "200.1" });
  });
  it("hands out a milestone once, and gives it back after a failure that sent nothing", async () => {
    const store = new SlackTaskMessageStore(root);
    expect(await store.claimMilestone("work:task-1:run-1:plan-ready")).toBe(true);
    expect(await new SlackTaskMessageStore(root).claimMilestone("work:task-1:run-1:plan-ready")).toBe(false);
    expect(store.announced("work:task-1:run-1:plan-ready")).toBe(true);
    await store.releaseMilestone("work:task-1:run-1:plan-ready");
    expect(await store.claimMilestone("work:task-1:run-1:plan-ready")).toBe(true);
  });
  it("seeds once and marks milestones known without claiming them for a post", async () => {
    const store = new SlackTaskMessageStore(root);
    expect(store.seeded()).toBe(false);
    await store.markAnnounced(["a", "b"]);
    await store.markSeeded();
    expect(new SlackTaskMessageStore(root).seeded()).toBe(true);
    expect(store.announced("a")).toBe(true);
    expect(await store.claimMilestone("a")).toBe(false);
  });
  it("forgets entries after 30 days, and keeps the seeded flag", async () => {
    let now = Date.parse("2026-10-18T12:00:00Z");
    const store = new SlackTaskMessageStore(root, () => now);
    await store.remember(audience, "CCHANNEL", "100.1", ref, "100.1");
    await store.claimMilestone("old");
    await store.markSeeded();
    now += 31 * 24 * 60 * 60 * 1000;
    expect(store.taskFor(audience, "CCHANNEL", "100.1")).toBeUndefined();
    expect(store.threadFor(audience, "work", "task-1")).toBeUndefined();
    await store.claimMilestone("new");
    expect(store.taskFor(audience, "CCHANNEL", "100.1")).toBeUndefined();
    expect(store.announced("old")).toBe(false);
    expect(store.seeded()).toBe(true);
  });
  it("moves a corrupt file aside and starts empty instead of breaking reactions", async () => {
    fs.writeFileSync(path.join(root, "task-messages.json"), "{nope");
    const store = new SlackTaskMessageStore(root);
    expect(store.taskFor(audience, "CCHANNEL", "1.1")).toBeUndefined();
    await store.remember(audience, "CCHANNEL", "1.1", ref, "1.1");
    expect(fs.readdirSync(root).some((name) => name.startsWith("task-messages.json.corrupt-"))).toBe(true);
  });
});
