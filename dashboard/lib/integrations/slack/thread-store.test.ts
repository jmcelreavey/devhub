import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SlackThreadStore, slackThreadItemId, type SlackThreadItem } from "./thread-store";

let root: string;
function item(profile = "work"): SlackThreadItem {
  return { profile, entityId: "task:task-id", taskId: "task-id", questionId: "q1", itemKey: "q1", title: "PTF-5135 · Feed fallback", needed: "Keep it?", href: "/storyboard?task=task-id", action: "answer", teamId: "TTEAM", userId: "UOWNER", channel: "CCHANNEL", postedAt: "2026-10-18T12:00:00.000Z", resolved: false, delivery: "sent", thread_ts: "100.1", ts: "100.1", dirty: false };
}

beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "slack-threads-")); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe("Slack thread state", () => {
  it("survives a store reload, keeps private permissions and leaves no temporary write files", async () => {
    const store = new SlackThreadStore(root);
    const entry = item();
    const id = slackThreadItemId(entry, entry);
    await store.change((state) => { state.items[id] = entry; });
    expect(new SlackThreadStore(root).read().items[id]).toEqual(entry);
    expect(fs.statSync(path.join(root, "threads.json")).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(root)).toEqual(["threads", "threads.json"]);
  });

  it("serialises concurrent read-modify-writes across store instances", async () => {
    const work = item();
    const personal = item("personal");
    const workId = slackThreadItemId(work, work);
    const personalId = slackThreadItemId(personal, personal);
    await Promise.all([
      new SlackThreadStore(root).change((state) => { state.items[workId] = work; }),
      new SlackThreadStore(root).change((state) => { state.items[personalId] = personal; }),
    ]);
    expect(new SlackThreadStore(root).read().items).toEqual({ [workId]: work, [personalId]: personal });
    expect(workId).not.toBe(personalId);
    expect(slackThreadItemId(work, { ...work, userId: "UOTHER" })).not.toBe(workId);
    expect(slackThreadItemId(work, { ...work, channel: "COTHER" })).not.toBe(workId);
  });

  it("doesn't replace the last valid file when a mutation fails schema validation", async () => {
    const store = new SlackThreadStore(root);
    await store.change((state) => { state.items.saved = item(); });
    const previous = fs.readFileSync(path.join(root, "threads.json"), "utf8");
    await expect(store.change((state) => { state.items.saved.thread_ts = "not-a-timestamp"; })).rejects.toThrow();
    expect(fs.readFileSync(path.join(root, "threads.json"), "utf8")).toBe(previous);
  });
});
