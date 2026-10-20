import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SlackNotSentError, type SlackMessage } from "./client";
import type { SlackMilestone } from "./milestones";
import { SlackProgress } from "./progress";
import { SlackTaskMessageStore } from "./task-messages";
import type { SlackThreadItem } from "./thread-store";

const audience = { teamId: "TTEAM", userId: "UOWNER", channel: "CCHANNEL" };
const milestone: SlackMilestone = { profile: "work", taskId: "t1", title: "Fix ads", runId: "r1", kind: "plan-ready", key: "work:t1:r1:plan-ready" };
let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "slack-progress-")); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

function setup(deviceId?: string) {
  const messages = new SlackTaskMessageStore(root);
  let sequence = 0;
  const post = vi.fn(async (message: SlackMessage) => ({ channel: message.channel, ts: `100.${++sequence}` }));
  const transport = { active: () => true, post, update: vi.fn(async () => {}) };
  const worker = new SlackProgress({ ...audience, ...(deviceId ? { deviceId } : {}) }, transport, messages);
  const options = { enabled: true, quiet: false, items: (): SlackThreadItem[] => [] };
  return { messages, post, transport, worker, options };
}

describe("agent progress delivery", () => {
  it("baselines newly discovered milestones even when progress was seeded before restart or sleep", async () => {
    const test = setup(); await test.messages.markSeeded();
    await test.worker.run([milestone], { ...test.options, baseline: true });
    await test.worker.run([milestone], test.options); expect(test.post).not.toHaveBeenCalled();
    await test.worker.run([{ ...milestone, key: "new-plan" }], test.options); expect(test.post).toHaveBeenCalledTimes(2);
  });
  it.each(["skipped", "unknown", "sent"] as const)("does not duplicate a %s waiting plan card, but preserves independent progress", async (delivery) => {
    const test = setup(); await test.messages.markSeeded();
    const item: SlackThreadItem = { ...audience, profile: "work", entityId: "task:t1", taskId: "t1", title: "T", needed: "Plan ready", href: "/", action: "approve-plan", state: "plan-ready", itemKey: "plan", postedAt: new Date().toISOString(), resolved: false, delivery, dirty: false, thread_ts: "90.1" };
    await test.worker.run([milestone], { ...test.options, items: () => [item] }); expect(test.post).not.toHaveBeenCalled();
    await test.worker.run([{ ...milestone, key: "another-plan" }], { ...test.options, needsEnabled: false, items: () => [item] }); expect(test.post).toHaveBeenCalledTimes(1);
  });
  it("adds team controls and bound task references to both root and progress cards only in team mode", async () => {
    const team = setup("device-one");
    await team.messages.markSeeded();
    await team.worker.run([milestone], team.options);
    expect(team.post).toHaveBeenCalledTimes(2);
    for (const [message] of team.post.mock.calls) {
      expect(message.taskRef).toEqual({ taskId: milestone.taskId, profile: milestone.profile, title: milestone.title });
      expect(JSON.stringify(message.blocks)).toContain("Hand off to…");
    }
  });
  it("baselines history, then creates a root and persistently dedupes the milestone across restarts", async () => {
    const test = setup();
    await test.worker.run([], test.options);
    await test.worker.run([milestone], test.options);
    expect(test.post).toHaveBeenCalledTimes(2);
    expect(test.post.mock.calls[0][0]).toMatchObject({ channel: audience.channel, text: expect.stringContaining("Fix ads") });
    expect(test.post.mock.calls[0][0].thread_ts).toBeUndefined();
    expect(test.post.mock.calls[1][0]).toMatchObject({ thread_ts: "100.1", text: expect.stringContaining("Plan ready") });
    const persisted = new SlackTaskMessageStore(root);
    expect(persisted.taskFor(audience, audience.channel, "100.1")).toMatchObject({ taskId: "t1" });
    await new SlackProgress(audience, test.transport, persisted).run([milestone], test.options);
    expect(test.post).toHaveBeenCalledTimes(2);
    await test.worker.run([{ ...milestone, key: "work:t1:r1:failed", kind: "failed" }], test.options);
    expect(test.post).toHaveBeenCalledTimes(3);
    expect(test.post.mock.calls[2][0].thread_ts).toBe("100.1");
  });

  it("uses an existing Needs-you thread only for the same profile and audience", async () => {
    const test = setup();
    await test.messages.markSeeded();
    const item: SlackThreadItem = { ...audience, profile: "work", entityId: "task:t1", taskId: "t1", title: "T", needed: "Pick up", href: "/", action: "open", itemKey: "k", postedAt: new Date().toISOString(), resolved: false, delivery: "sent", dirty: false, thread_ts: "90.1" };
    await test.worker.run([milestone], { ...test.options, items: () => [{ ...item, userId: "UOTHER", thread_ts: "80.1" }, { ...item, profile: "personal", thread_ts: "70.1" }, item] });
    expect(test.post).toHaveBeenCalledTimes(1);
    expect(test.post.mock.calls[0][0].thread_ts).toBe("90.1");
  });

  it("reuses a recorded task card or add-task reply's thread instead of creating another root", async () => {
    const test = setup();
    await test.messages.markSeeded();
    await test.messages.remember(audience, audience.channel, "90.2", { profile: "work", taskId: "t1", title: "T" }, "90.1");
    await test.worker.run([milestone], test.options);
    expect(test.post).toHaveBeenCalledTimes(1);
    expect(test.post.mock.calls[0][0].thread_ts).toBe("90.1");
  });

  it("does not replay history, switch-off periods or a question already announced in Needs-you", async () => {
    const test = setup();
    await test.worker.run([milestone], test.options);
    const failed = { ...milestone, kind: "failed" as const, key: "failed" };
    await test.worker.run([failed], { ...test.options, enabled: false });
    await test.worker.run([milestone, failed], test.options);
    expect(test.post).not.toHaveBeenCalled();
    const question = { ...milestone, kind: "needs-input" as const, key: "question" };
    const item: SlackThreadItem = { ...audience, profile: "work", entityId: "task:t1", taskId: "t1", title: "T", needed: "Question", href: "/", action: "answer", itemKey: "q", postedAt: new Date().toISOString(), resolved: false, delivery: "sent", dirty: false, thread_ts: "90.1" };
    await test.worker.run([question], { ...test.options, items: () => [item] });
    expect(test.post).not.toHaveBeenCalled();
    expect(test.messages.announced("question")).toBe(true);
  });

  it("does not repeat a waiting state a live Needs-you card already carries", async () => {
    const test = setup();
    await test.messages.markSeeded();
    const card: SlackThreadItem = { ...audience, profile: "work", entityId: "task:t1", taskId: "t1", title: "T", needed: "Plan ready", href: "/", action: "open", itemKey: "plan", postedAt: new Date().toISOString(), resolved: false, delivery: "sent", dirty: false, thread_ts: "90.1" };
    const waiting = { ...milestone, kind: "needs-input" as const, key: "waiting", detail: "2 open questions." };
    await test.worker.run([milestone, waiting], { ...test.options, items: () => [card] });
    expect(test.post).not.toHaveBeenCalled();
    expect(test.messages.announced(milestone.key)).toBe(true);
    expect(test.messages.announced("waiting")).toBe(true);
  });

  it("still announces plan-ready when the live card is about something else, or the card is resolved", async () => {
    const test = setup();
    await test.messages.markSeeded();
    const card: SlackThreadItem = { ...audience, profile: "work", entityId: "task:t1", taskId: "t1", title: "T", needed: "Choose the repo", href: "/", action: "open", itemKey: "repo", postedAt: new Date().toISOString(), resolved: false, delivery: "sent", dirty: false, thread_ts: "90.1" };
    await test.worker.run([milestone], { ...test.options, items: () => [card] });
    expect(test.post).toHaveBeenCalledTimes(1);
    const second = { ...milestone, runId: "r2", key: "r2" };
    await test.worker.run([second], { ...test.options, items: () => [{ ...card, needed: "Plan ready", resolved: true }] });
    expect(test.post).toHaveBeenCalledTimes(2);
  });

  it("holds quiet-hour milestones and spreads a burst over ticks", async () => {
    const test = setup();
    await test.messages.markSeeded();
    const milestones = Array.from({ length: 4 }, (_, index) => ({ ...milestone, runId: `r${index}`, key: `key${index}` }));
    await test.worker.run(milestones, { ...test.options, quiet: true });
    expect(test.post).not.toHaveBeenCalled();
    await test.worker.run(milestones, test.options);
    expect(test.post).toHaveBeenCalledTimes(4);
    await test.worker.run(milestones, test.options);
    expect(test.post).toHaveBeenCalledTimes(5);
  });

  it.each([true, false])("retries only provably unsent failures, not unknown outcomes: %s", async (retryable) => {
    const test = setup();
    await test.messages.markSeeded();
    await test.messages.rememberThread(audience, audience.channel, "90.1", { profile: "work", taskId: "t1", title: "T" });
    test.post.mockRejectedValueOnce(retryable ? new SlackNotSentError("stopped") : new Error("socket hang up"));
    await expect(test.worker.run([milestone], test.options)).rejects.toThrow();
    expect(test.messages.announced(milestone.key)).toBe(!retryable);
    await test.worker.run([milestone], test.options);
    expect(test.post).toHaveBeenCalledTimes(retryable ? 2 : 1);
  });
});
