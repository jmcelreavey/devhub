import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTaskDirectory } from "./reactions";
import { SlackTaskMessageStore } from "./task-messages";
import { SlackThreadStore, type SlackThreadItem } from "./thread-store";

const audience = { teamId: "TTEAM", userId: "UOWNER", channel: "CCHANNEL" };
let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "slack-reactions-")); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

function item(taskId: string, patch: Partial<SlackThreadItem> = {}): SlackThreadItem {
  return { profile: "work", entityId: `task:${taskId}`, taskId, itemKey: "k", title: "T", needed: "Pick up", href: "/x", action: "open", ...audience, postedAt: "2026-10-18T12:00:00.000Z", resolved: false, delivery: "sent", dirty: false, ts: "100.1", thread_ts: "100.1", ...patch };
}

describe("which task a ✅ landed on", () => {
  it("maps a Needs-you card and its thread root to the task, replying in that thread", async () => {
    const threads = new SlackThreadStore(root);
    await threads.change((state) => { state.items.a = item("task-1", { ts: "100.2", thread_ts: "100.1" }); });
    const directory = createTaskDirectory(threads, new SlackTaskMessageStore(root));
    expect(directory.resolve(audience, "CCHANNEL", "100.2")).toEqual({ profile: "work", taskId: "task-1", threadTs: "100.1" });
    expect(directory.resolve(audience, "CCHANNEL", "100.1")).toEqual({ profile: "work", taskId: "task-1", threadTs: "100.1" });
  });
  it("maps a message the bot recorded (task card, add-task reply, progress root) through the message map", async () => {
    const messages = new SlackTaskMessageStore(root);
    const directory = createTaskDirectory(new SlackThreadStore(root), messages);
    await directory.remember(audience, { channel: "CCHANNEL", ts: "300.1" }, { channel: "CCHANNEL", text: "x", thread_ts: "250.1", taskRef: { profile: "work", taskId: "task-2", title: "Buy milk" } });
    expect(directory.resolve(audience, "CCHANNEL", "300.1")).toEqual({ profile: "work", taskId: "task-2", threadTs: "250.1" });
    await directory.remember(audience, { channel: "CCHANNEL", ts: "300.2" }, { channel: "CCHANNEL", text: "no ref" });
    expect(directory.resolve(audience, "CCHANNEL", "300.2")).toBeUndefined();
  });
  it("maps nothing for a digest that covers several tasks, another channel, another person, or an unknown message", async () => {
    const threads = new SlackThreadStore(root);
    await threads.change((state) => {
      state.items.a = item("task-1", { ts: "100.2", thread_ts: "100.2", digestTs: "100.9" });
      state.items.b = item("task-2", { ts: "100.3", thread_ts: "100.3", digestTs: "100.9" });
      state.items.c = item("task-3", { ts: "500.1", thread_ts: "500.1", userId: "UOTHER" });
    });
    const directory = createTaskDirectory(threads, new SlackTaskMessageStore(root));
    expect(directory.resolve(audience, "CCHANNEL", "100.9")).toBeUndefined();
    expect(directory.resolve(audience, "COTHER", "100.2")).toBeUndefined();
    expect(directory.resolve(audience, "CCHANNEL", "500.1")).toBeUndefined();
    expect(directory.resolve(audience, "CCHANNEL", "999.9")).toBeUndefined();
    expect(directory.resolve(audience, "CCHANNEL", "100.2")).toMatchObject({ taskId: "task-1" });
  });
  it("ignores a PR or plugin card with no task, and never throws when recording fails", async () => {
    const threads = new SlackThreadStore(root);
    await threads.change((state) => { state.items.pr = item("task-1", { taskId: undefined, entityId: "pr:1" }); });
    const failing = { remember: async () => { throw new Error("disk full"); }, taskFor: () => undefined } as unknown as SlackTaskMessageStore;
    const directory = createTaskDirectory(threads, failing);
    expect(directory.resolve(audience, "CCHANNEL", "100.1")).toBeUndefined();
    await expect(directory.remember(audience, { channel: "CCHANNEL", ts: "1.1" }, { channel: "CCHANNEL", text: "x", taskRef: { profile: "work", taskId: "t", title: "T" } })).resolves.toBeUndefined();
  });
});
