import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SlackNeedsYou, type SlackNeedsDependencies, type SlackNeedsTransport } from "./needs-you";
import { SlackThreadStore, slackThreadItemId } from "./thread-store";
import type { SlackNeed } from "./needs-you-source";
import type { SlackIncomingMessage, SlackInteraction } from "./security";
import { SlackNotSentError } from "./client";
import { slackTextMessage } from "./needs-you-format";
import { SlackTaskMessageStore } from "./task-messages";
import { createHash } from "node:crypto";
import type { SlackTaskReplyDependencies } from "./thread-reply";
import type { SlackSettings } from "./shared";
import type { SlackMilestone } from "./milestones";

const settings = { botToken: "xoxb-fake", appToken: "xapp-fake", channelId: "CCHANNEL", allowedUserId: "UOWNER", teamId: "TTEAM" };
const audience = { teamId: "TTEAM", userId: "UOWNER", channel: "CCHANNEL" };
let root: string;

function need(taskId = "task-1", questionId = "q1", patch: Partial<SlackNeed> = {}): SlackNeed {
  const jiraKey = `PTF-${taskId === "task-1" ? "5135" : taskId.replace(/\D/g, "")}`;
  return { profile: "work", entityId: `task:${taskId}`, taskId, jiraKey, questionId, itemKey: questionId, title: `${jiraKey} · Task ${taskId}`, needed: `Question ${questionId}?`, action: "answer", href: `/storyboard?task=${taskId}&profile=work`, ...patch };
}

function setup(patch: Partial<SlackSettings> = {}, deviceId?: string) {
  let activeProfile = "work";
  let connected = true;
  let sequence = 0;
  const sources: Record<string, SlackNeed[]> = { work: [], personal: [] };
  const store = new SlackThreadStore(root);
  const dependencies: SlackNeedsDependencies = {
    store, profile: () => activeProfile, primary: () => process.env.DEVHUB_SCHEDULER !== "0", now: () => Date.now(),
    snapshot: vi.fn(async (profile) => ({ items: [...sources[profile]], peersKnown: true })),
    questions: vi.fn<SlackNeedsDependencies["questions"]>((profile, taskId) => ({ closed: false, questions: sources[profile].filter((item) => item.taskId === taskId && item.questionId).map((item) => ({ id: item.questionId!, text: item.needed, kind: item.action === "repo" ? "repo" : "note", options: item.options })) })),
    answer: vi.fn<SlackNeedsDependencies["answer"]>(async (profile, taskId) => {
      const item = sources[profile].find((entry) => entry.taskId === taskId && entry.questionId);
      if (!item) return { remaining: 0 };
      sources[profile] = sources[profile].filter((entry) => entry !== item);
      return { question: { id: item.questionId!, text: item.needed, kind: item.action === "repo" ? "repo" : "note" }, remaining: sources[profile].filter((entry) => entry.taskId === taskId && entry.questionId).length };
    }),
    retry: vi.fn(async (profile, taskId) => { sources[profile] = sources[profile].filter((item) => item.taskId !== taskId); }),
    decidePlan: vi.fn(async (profile, taskId) => { sources[profile] = sources[profile].filter((item) => item.taskId !== taskId); }),
    quiet: vi.fn(() => false),
    taskReply: { state: vi.fn<SlackTaskReplyDependencies["state"]>(() => ({ kind: "idle" })), revisePlan: vi.fn(async () => {}), saveNote: vi.fn() },
  };
  const transport: SlackNeedsTransport = {
    active: () => connected,
    post: vi.fn(async (message, guard) => {
      if (guard?.() === false) throw new Error("profile changed");
      return { channel: message.channel, ts: `100.${++sequence}` };
    }),
    update: vi.fn(async () => {}),
  };
  const propose = vi.fn(async (action: "plan" | "implement") => [slackTextMessage("CCHANNEL", `Confirm ${action}?`, "1.1")]);
  const target = { ...audience, channel: patch.channelId ?? audience.channel, ...(deviceId ? { deviceId } : {}) };
  const create = () => new SlackNeedsYou({ ...settings, ...patch }, target, transport, { ...dependencies, store: new SlackThreadStore(root) }, propose);
  const worker = create();
  const reply = (threadTs: string, text = "Keep the last result", change: Partial<SlackIncomingMessage> = {}) => worker.reply({ teamId: "TTEAM", userId: "UOWNER", channelId: target.channel, eventId: `Ev-${++sequence}`, ts: `200.${sequence}`, threadTs, text, ...change });
  const button = (id: string, action: SlackInteraction["action"] = "devhub_answer", change: Partial<SlackInteraction> = {}) => worker.interact({ teamId: "TTEAM", userId: "UOWNER", channelId: target.channel, ts: store.read().items[id]?.ts ?? "100.1", action, value: id, actionTs: `300.${++sequence}`, ...change });
  return { worker, create, sources, store, dependencies, transport, propose, reply, button, profile: (profile: string) => { activeProfile = profile; }, connected: (value: boolean) => { connected = value; } };
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "slack-needs-you-"));
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-18T12:00:00Z"));
  vi.stubEnv("DEVHUB_SCHEDULER", "1");
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });

describe("Needs you Slack delivery", () => {
  it.each(["Keep <all> & retry", "Thanks", "help"])("saves the selected option verbatim once: %s", async (option) => {
    const test = setup();
    await test.worker.tick();
    const item = need("task-1", "q1", { options: [option, "Other"] });
    test.sources.work = [item]; await test.worker.tick();
    const id = slackThreadItemId(item, audience);
    await test.button(id, "devhub_answer_option_0");
    await test.button(id, "devhub_answer_option_0");
    expect(test.dependencies.answer).toHaveBeenCalledExactlyOnceWith("work", "task-1", option, expect.stringContaining("slack-option-"), expect.anything());
    expect(test.dependencies.taskReply?.saveNote).not.toHaveBeenCalled();
  });

  it("keeps gateway option answers behind the existing device-bound confirmation", async () => {
    const test = setup({ mode: "gateway", channelId: "DOWNER" }, "device-one");
    await test.worker.tick();
    const item = need("task-1", "q1", { options: ["Keep it", "Drop it"] });
    test.sources.work = [item]; await test.worker.tick();
    const id = slackThreadItemId(item, { ...audience, channel: "DOWNER" });
    await test.button(id, "devhub_answer_option_0", { deviceId: "device-one" });
    expect(test.dependencies.answer).not.toHaveBeenCalled();
    const [token, confirmation] = Object.entries(test.store.read().confirmations)[0];
    expect(confirmation).toMatchObject({ answer: "Keep it", questionId: "q1", deviceId: "device-one" });
    await test.button(token, "devhub_confirm_answer", { deviceId: "device-one", ts: confirmation.ts });
    expect(test.dependencies.answer).toHaveBeenCalledExactlyOnceWith("work", "task-1", "Keep it", token, expect.anything());
  });

  it.each(["options", "question", "message", "owner"])("rejects an option click when its %s changed", async (change) => {
    const test = setup();
    await test.worker.tick();
    const item = need("task-1", "q1", { options: ["Keep it", "Drop it"] });
    test.sources.work = [item]; await test.worker.tick();
    if (change === "options") test.sources.work = [{ ...item, options: ["Changed", "Drop it"] }];
    if (change === "question") test.sources.work = [{ ...item, questionId: "q2", needed: "Different question" }];
    await test.button(slackThreadItemId(item, audience), "devhub_answer_option_0", change === "message" ? { ts: "999.9" } : change === "owner" ? { userId: "UOTHER" } : {});
    expect(test.dependencies.answer).not.toHaveBeenCalled();
    expect(test.dependencies.taskReply?.saveNote).not.toHaveBeenCalled();
  });

  const states: NonNullable<SlackNeed["state"]>[] = ["plan-ready", "question", "failed-run", "review-ready", "finished-feedback", "push-failed"];
  function waiting(state: NonNullable<SlackNeed["state"]>, version = "one"): SlackNeed {
    return need("task-1", version, { state, itemKey: `${state}:${version}`, questionId: state === "question" ? version : undefined,
      action: state === "plan-ready" ? "approve-plan" : state === "question" ? "answer" : state === "failed-run" || state === "push-failed" ? "retry" : "open",
      needed: state, ...(state === "plan-ready" ? { plan: { runId: `run-${version}`, fingerprint: version, summary: "Keep saved articles available offline." } } : {}) });
  }

  it.each(states)("posts %s exactly once per changed fingerprint, not on repeat ticks or restart", async (state) => {
    const test = setup();
    await test.worker.tick(); test.sources.work = [waiting(state)]; await test.worker.tick(); await test.worker.tick();
    const restarted = test.create(); await restarted.tick(); await restarted.tick();
    expect(test.transport.post).toHaveBeenCalledTimes(1);
    test.sources.work = [waiting(state, "two")]; await restarted.tick(); await restarted.tick();
    expect(test.transport.post).toHaveBeenCalledTimes(2);
  });

  it.each(states)("baselines %s at startup, after sleep, and after a restart", async (state) => {
    const test = setup(); test.sources.work = [waiting(state)]; await test.worker.tick(); await test.worker.tick();
    vi.setSystemTime(Date.now() + 60000); test.sources.work = [waiting(state, "sleep")]; await test.worker.tick(); await test.worker.tick();
    test.sources.work = [waiting(state, "restart")]; const restarted = test.create(); await restarted.tick(); await restarted.tick();
    expect(test.transport.post).not.toHaveBeenCalled();
    expect(Object.values(test.store.read().items).every((item) => item.delivery === "skipped")).toBe(true);
  });

  it.each(states)("revives a %s snapshot blink instead of reposting", async (state) => {
    const test = setup(); await test.worker.tick(); const item = waiting(state); test.sources.work = [item]; await test.worker.tick();
    const id = slackThreadItemId(item, audience); const ts = test.store.read().items[id].ts;
    test.sources.work = []; await test.worker.tick(); test.sources.work = [item]; await test.worker.tick();
    expect(test.transport.post).toHaveBeenCalledTimes(1); expect(test.store.read().items[id]).toMatchObject({ ts, resolved: false });
    expect(test.transport.update).toHaveBeenCalledWith(expect.objectContaining({ ts }));
  });

  it("does not turn a baselined plan blink into a new notification", async () => {
    const test = setup(); const item = waiting("plan-ready"); test.sources.work = [item]; await test.worker.tick();
    test.sources.work = []; await test.worker.tick(); test.sources.work = [item]; await test.worker.tick();
    expect(test.transport.post).not.toHaveBeenCalled();
  });

  it.each(["CCHANNEL", "DCHANNEL"])("uses a mapped task thread and explicitly notifies the owner in %s", async (channel) => {
    const test = setup({ channelId: channel }); const messages = new SlackTaskMessageStore(root);
    test.dependencies.messages = messages;
    await messages.rememberThread({ ...audience, channel }, channel, "90.1", { profile: "work", taskId: "task-1", title: "Saved articles" });
    const worker = test.create(); await worker.tick(); test.sources.work = [waiting("plan-ready")]; await worker.tick();
    const message = vi.mocked(test.transport.post).mock.calls[0][0];
    expect(message).toMatchObject({ channel, thread_ts: "90.1" });
    if (channel.startsWith("C")) { expect(message.text).toContain("<@UOWNER>"); expect(JSON.stringify(message.blocks)).toContain("<@UOWNER>"); }
    else expect(message.reply_broadcast).toBe(true);
    expect(vi.mocked(test.transport.update).mock.calls.some(([update]) => update.ts === "90.1")).toBe(false);
  });

  it("posts a new mentioned card when no mapped task thread exists", async () => {
    const test = setup(); await test.worker.tick(); test.sources.work = [waiting("plan-ready")]; await test.worker.tick();
    expect(test.transport.post).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ thread_ts: undefined, text: expect.stringContaining("<@UOWNER>") }), expect.any(Function));
  });

  it("approves once through the existing decision dependency and removes the card's buttons", async () => {
    const test = setup(); const item = waiting("plan-ready"); const id = slackThreadItemId(item, audience);
    await test.worker.tick(); test.sources.work = [item]; await test.worker.tick();
    await Promise.all([test.button(id, "devhub_approve_plan"), test.button(id, "devhub_approve_plan")]);
    expect(test.dependencies.decidePlan).toHaveBeenCalledExactlyOnceWith("work", "task-1", item.plan, "approve", id, undefined);
    const update = vi.mocked(test.transport.update).mock.calls.at(-1)![0];
    expect(update.text).toContain("Plan approved"); expect(update.blocks?.some((block) => block.type === "actions")).toBe(false);
    test.sources.work = [item]; await test.worker.tick(); expect(test.transport.post).toHaveBeenCalledTimes(2);
  });

  it.each(["changed-plan", "resolved", "wrong-owner", "wrong-channel", "wrong-device"])("refuses a %s plan approval", async (reason) => {
    const test = setup({}, "device-one"); const item = waiting("plan-ready"); const id = slackThreadItemId(item, audience);
    await test.worker.tick(); test.sources.work = [item]; await test.worker.tick();
    if (reason === "changed-plan") test.sources.work = [waiting("plan-ready", "two")];
    if (reason === "resolved") test.sources.work = [];
    await test.button(id, "devhub_approve_plan", { deviceId: reason === "wrong-device" ? "device-other" : "device-one", ...(reason === "wrong-owner" ? { userId: "UOTHER" } : {}), ...(reason === "wrong-channel" ? { channelId: "COTHER" } : {}) });
    expect(test.dependencies.decidePlan).not.toHaveBeenCalled();
  });

  it("opens a direct revision modal with trigger_id and passes submitted text to revise once", async () => {
    const test = setup(); test.transport.openModal = vi.fn(async () => {}); const item = waiting("plan-ready"); const id = slackThreadItemId(item, audience);
    await test.worker.tick(); test.sources.work = [item]; await test.worker.tick();
    await test.button(id, "devhub_revise_plan", { triggerId: "trigger-one" });
    const modal = vi.mocked(test.transport.openModal).mock.calls[0][1];
    expect(modal).toMatchObject({ type: "modal", callback_id: "devhub_submit_plan_revision" });
    expect(test.transport.openModal).toHaveBeenCalledWith("trigger-one", modal);
    expect(test.dependencies.decidePlan).not.toHaveBeenCalled();
    const revisionToken = test.store.read().items[id].revision!.token;
    const text = "Keep the cache local.\nDon't add another service.";
    await test.button(id, "devhub_submit_plan_revision", { surface: "modal", ts: "", revisionToken, revisionText: text });
    await test.button(id, "devhub_submit_plan_revision", { surface: "modal", ts: "", revisionToken, revisionText: text });
    expect(test.dependencies.decidePlan).toHaveBeenCalledExactlyOnceWith("work", "task-1", item.plan, "revise", id, text);
  });

  it("persists a fallback revision prompt across restart and accepts only the owner's next thread reply", async () => {
    const test = setup(); const item = waiting("plan-ready"); const id = slackThreadItemId(item, audience);
    await test.worker.tick(); test.sources.work = [item]; await test.worker.tick(); await test.button(id, "devhub_revise_plan");
    const parent = test.store.read().items[id].thread_ts!;
    expect(vi.mocked(test.transport.post).mock.calls.at(-1)![0].text).toContain("Reply in this thread with what to change");
    expect((await test.reply(parent, "No", { userId: "UOTHER" })).handled).toBe(false);
    const restarted = test.create(); await restarted.tick();
    await restarted.reply({ teamId: "TTEAM", userId: "UOWNER", channelId: "CCHANNEL", eventId: "revision-one", ts: "400.1", threadTs: parent, text: "Keep offline reads &amp; retries local" });
    expect(test.dependencies.decidePlan).toHaveBeenCalledExactlyOnceWith("work", "task-1", item.plan, "revise", id, "Keep offline reads & retries local");
    expect(test.dependencies.answer).not.toHaveBeenCalled();
  });

  it.each(["expired", "stale", "empty", "too-long"])("does not revise a %s plan prompt", async (reason) => {
    const test = setup(); const item = waiting("plan-ready"); const id = slackThreadItemId(item, audience);
    await test.worker.tick(); test.sources.work = [item]; await test.worker.tick(); await test.button(id, "devhub_revise_plan");
    if (reason === "expired") vi.setSystemTime(Date.now() + 600001);
    if (reason === "stale") test.sources.work = [waiting("plan-ready", "two")];
    await test.reply(test.store.read().items[id].thread_ts!, reason === "empty" ? "  " : reason === "too-long" ? "x".repeat(4001) : "Revise the cache");
    expect(test.dependencies.decidePlan).not.toHaveBeenCalled(); expect(test.dependencies.answer).not.toHaveBeenCalled();
  });

  it("quietly resolves a plan elsewhere without retaining action buttons", async () => {
    const test = setup(); await test.worker.tick(); test.sources.work = [waiting("plan-ready")]; await test.worker.tick();
    test.sources.work = []; await test.worker.tick();
    const update = vi.mocked(test.transport.update).mock.calls.at(-1)![0];
    expect(update.text).toContain("Resolved"); expect(update.blocks?.some((block) => block.type === "actions")).toBe(false);
    expect(test.transport.post).toHaveBeenCalledTimes(1);
  });

  it("routes team needs only to the owner DM and pings for a thread reply", async () => {
    const test = setup({ mode: "gateway", channelId: "DOWNER" }, "device-one");
    const messages = new SlackTaskMessageStore(root); test.dependencies.messages = messages;
    await messages.rememberThread({ ...audience, channel: "DOWNER" }, "DOWNER", "90.1", { profile: "work", taskId: "task-1", title: "Task" });
    const worker = test.create(); await worker.tick(); test.sources.work = [waiting("plan-ready")]; await worker.tick(); await worker.tick();
    expect(test.transport.post).toHaveBeenCalledTimes(2);
    expect(vi.mocked(test.transport.post).mock.calls.map(([message]) => [message.channel, message.thread_ts])).toEqual([["DOWNER", "90.1"], ["DOWNER", undefined]]);
    const invalid = setup({ mode: "gateway", channelId: "CSHARED" }, "device-one");
    invalid.sources.work = [waiting("plan-ready")]; await invalid.worker.tick(); expect(invalid.transport.post).not.toHaveBeenCalled();
  });

  it("does not replay progress at restart or after sleep and does not double-post plan/failed cards", async () => {
    const test = setup(); test.dependencies.messages = new SlackTaskMessageStore(root);
    const milestone: SlackMilestone = { profile: "work", taskId: "task-1", title: "Task", kind: "plan-ready", runId: "one", key: "plan-one" };
    let milestones: SlackMilestone[] = [milestone];
    vi.mocked(test.dependencies.snapshot).mockImplementation(async () => ({ items: test.sources.work, peersKnown: true, milestones }));
    const worker = test.create(); await worker.tick();
    milestones = [{ ...milestone, key: "plan-two", runId: "two" }]; test.sources.work = [waiting("plan-ready", "two")]; await worker.tick();
    expect(test.transport.post).toHaveBeenCalledTimes(1);
    milestones = [{ ...milestone, key: "plan-three" }]; const restarted = test.create(); await restarted.tick();
    vi.setSystemTime(Date.now() + 60000); milestones = [{ ...milestone, key: "plan-sleep" }]; await restarted.tick();
    expect(test.transport.post).toHaveBeenCalledTimes(1);
    test.sources.work = [waiting("failed-run")]; milestones = [{ ...milestone, kind: "failed", key: "failed-one" }]; await restarted.tick();
    expect(test.transport.post).toHaveBeenCalledTimes(2);
  });
  it.each(["help", "what can you do?", "tools", "tools notes"])("passes %s to the local catalog without saving a task answer", async (text) => {
    const test = setup({}, "device-one");
    await test.worker.tick(); test.sources.work = [need()]; await test.worker.tick();
    const parent = Object.values(test.store.read().items)[0].thread_ts!;
    test.profile("personal");
    expect(await test.reply(parent, text)).toEqual({ handled: false, profile: "work" });
    expect(test.dependencies.answer).not.toHaveBeenCalled();
    expect(Object.keys(test.store.read().confirmations)).toHaveLength(0);
  });
  it("requires a bound, single-use Confirm before saving a Team Slack thread answer", async () => {
    const test = setup({}, "device-one");
    await test.worker.tick(); test.sources.work = [need()]; await test.worker.tick();
    const parent = Object.values(test.store.read().items)[0].thread_ts!;
    await test.reply(parent, "Keep &amp;lt;literal&amp;gt;");
    expect(test.dependencies.answer).not.toHaveBeenCalled();
    expect(test.transport.post).toHaveBeenLastCalledWith(expect.objectContaining({ text: expect.stringContaining("Save this answer?") }));
    const [token, confirmation] = Object.entries(test.store.read().confirmations)[0];
    expect(confirmation).toMatchObject({ deviceId: "device-one", nonce: token, kind: "answer", questionId: "q1", answer: "Keep &lt;literal&gt;" });
    await test.button(token, "devhub_confirm_answer", { ts: confirmation.ts!, deviceId: "other" });
    expect(test.dependencies.answer).not.toHaveBeenCalled(); expect(test.store.read().confirmations[token].state).toBe("pending");
    await test.button(token, "devhub_confirm_answer", { ts: confirmation.ts!, deviceId: "device-one" });
    await test.button(token, "devhub_confirm_answer", { ts: confirmation.ts!, deviceId: "device-one" });
    expect(test.dependencies.answer).toHaveBeenCalledExactlyOnceWith("work", "task-1", "Keep &lt;literal&gt;", token, expect.anything());
  });

  it.each(["cancel", "expired", "changed-question", "changed-text", "tampered"])("does not save a %s Team Slack answer", async (scenario) => {
    const test = setup({}, "device-one");
    await test.worker.tick(); test.sources.work = [need()]; await test.worker.tick();
    await test.reply(Object.values(test.store.read().items)[0].thread_ts!, "Use the new endpoint");
    const [token, confirmation] = Object.entries(test.store.read().confirmations)[0];
    if (scenario === "expired") vi.setSystemTime(Date.now() + 600000);
    if (scenario === "changed-question") vi.mocked(test.dependencies.questions).mockReturnValue({ closed: false, questions: [{ id: "q2", text: "Another question", kind: "note" }] });
    if (scenario === "changed-text") vi.mocked(test.dependencies.questions).mockReturnValue({ closed: false, questions: [{ id: "q1", text: "Edited question", kind: "note" }] });
    if (scenario === "tampered") await test.store.change((state) => { state.confirmations[token].answer = "Changed behind the card"; });
    await test.button(token, scenario === "cancel" ? "devhub_cancel_answer" : "devhub_confirm_answer", { ts: confirmation.ts!, deviceId: "device-one" });
    expect(test.dependencies.answer).not.toHaveBeenCalled();
  });
  it("posts progress independently when Needs-you posting is off, using one snapshot per tick", async () => {
    const test = setup({ postNeedsYou: false });
    const messages = new SlackTaskMessageStore(root);
    const milestone = { profile: "work", taskId: "t1", title: "Task", kind: "plan-ready" as const, runId: "r1", key: "work:t1:r1:plan-ready" };
    vi.mocked(test.dependencies.snapshot).mockResolvedValueOnce({ items: [], peersKnown: true, milestones: [] });
    vi.mocked(test.dependencies.snapshot).mockResolvedValue({ items: [], peersKnown: true, milestones: [milestone] });
    const worker = new SlackNeedsYou({ ...settings, postNeedsYou: false }, audience, test.transport, { ...test.dependencies, messages });
    await worker.tick(); await worker.tick();
    expect(test.dependencies.snapshot).toHaveBeenCalledTimes(2);
    expect(test.transport.post).toHaveBeenCalledTimes(2);
    expect(vi.mocked(test.transport.post).mock.calls[1][0].text).toContain("Plan ready");
    await worker.tick();
    expect(test.transport.post).toHaveBeenCalledTimes(2);
  });

  it("revalidates Home actions and posts a proposal in the configured channel without executing it", async () => {
    const test = setup();
    const waiting = need("task-1", "open", { action: "open", questionId: undefined });
    test.sources.work = [waiting];
    const id = slackThreadItemId(waiting, audience);
    await test.button(id, "devhub_need_plan", { surface: "home", ts: "" });
    expect(test.propose).toHaveBeenCalledExactlyOnceWith("plan", expect.objectContaining({ profile: "work", taskId: "task-1", channel: "CCHANNEL", threadTs: undefined, teamId: "TTEAM", userId: "UOWNER" }));
    expect(test.transport.post).toHaveBeenCalledWith(expect.objectContaining({ text: "Confirm plan?", channel: "CCHANNEL" }));
    expect(test.dependencies.retry).not.toHaveBeenCalled();
    test.propose.mockClear(); test.sources.work = [];
    await test.button(id, "devhub_need_implement", { surface: "home", ts: "" });
    expect(test.propose).not.toHaveBeenCalled();
    expect(test.transport.post).toHaveBeenLastCalledWith(expect.objectContaining({ text: expect.stringContaining("isn't waiting") }));
  });

  it("does not propose Home actions if the profile changes during their source read", async () => {
    const test = setup();
    const waiting = need("task-1", "open", { action: "open", questionId: undefined });
    vi.mocked(test.dependencies.snapshot).mockImplementationOnce(async () => { test.profile("personal"); return { items: [waiting], peersKnown: true }; });
    await test.button(slackThreadItemId(waiting, audience), "devhub_need_plan", { surface: "home", ts: "" });
    expect(test.propose).not.toHaveBeenCalled();
  });

  it("offers one Home retry confirmation, never Plan/Implement, then consumes it once", async () => {
    const test = setup({}, "device-1");
    const waiting = need("task-1", "failed", { action: "retry", questionId: undefined, needed: "Workflow run failed" });
    test.sources.work = [waiting];
    const id = slackThreadItemId(waiting, audience);
    await test.button(id, "devhub_retry", { surface: "home", ts: "", deviceId: "device-1" });
    expect(test.transport.post).toHaveBeenCalledOnce(); expect(test.propose).not.toHaveBeenCalled(); expect(test.dependencies.retry).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(test.transport.post).mock.calls[0][0])).toContain("Confirm retry");
    const [token, confirmation] = Object.entries(test.store.read().confirmations)[0];
    await test.button(token, "devhub_confirm_retry", { ts: confirmation.ts!, deviceId: "device-1" });
    await test.button(token, "devhub_confirm_retry", { ts: confirmation.ts!, deviceId: "device-1" });
    expect(test.dependencies.retry).toHaveBeenCalledExactlyOnceWith("work", "task-1", token);
  });
  it("seeds the first connection, reconnects, profile switches and sleep gaps without catch-up", async () => {
    const test = setup();
    test.sources.work = [need()];
    await test.worker.tick();
    expect(test.transport.post).not.toHaveBeenCalled();
    expect(Object.values(test.store.read().items)[0].delivery).toBe("skipped");
    test.worker.reset();
    test.sources.work.push(need("task-2"));
    await test.worker.tick();
    vi.setSystemTime(Date.now() + 60000);
    test.sources.work.push(need("task-3"));
    await test.worker.tick();
    expect(test.transport.post).not.toHaveBeenCalled();
  });

  it("posts one parent per task and later questions in that task's thread", async () => {
    const test = setup();
    await test.worker.tick();
    test.sources.work.push(need());
    await test.worker.tick();
    const first = Object.values(test.store.read().items)[0];
    expect(first).toMatchObject({ profile: "work", taskId: "task-1", questionId: "q1", channel: "CCHANNEL", thread_ts: first.ts, delivery: "sent", resolved: false });
    expect(test.transport.post).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ text: expect.stringContaining("PTF-5135 · Task task-1 — Question q1?"), thread_ts: undefined }), expect.any(Function));
    test.sources.work.push(need("task-1", "q2"));
    await test.worker.tick();
    expect(test.transport.post).toHaveBeenLastCalledWith(expect.objectContaining({ thread_ts: first.ts, text: expect.stringContaining("Question q2?") }), expect.any(Function));
    expect(Object.values(test.store.read().items).every((item) => item.thread_ts === first.ts)).toBe(true);
    await test.worker.tick();
    expect(test.transport.post).toHaveBeenCalledTimes(2);
  });

  it("deduplicates on disk across restarts and keeps the original parent", async () => {
    const test = setup();
    await test.worker.tick(); test.sources.work = [need()]; await test.worker.tick();
    const parent = Object.values(test.store.read().items)[0].ts;
    const restarted = test.create();
    await restarted.tick();
    test.sources.work.push(need("task-1", "q2"));
    await restarted.tick();
    expect(test.transport.post).toHaveBeenCalledTimes(2);
    expect(test.transport.post).toHaveBeenLastCalledWith(expect.objectContaining({ thread_ts: parent }), expect.any(Function));
    expect(fs.statSync(path.join(root, "threads.json")).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(root).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it.each([5, 6])("uses a single digest above five new items, not at %i", async (count) => {
    const test = setup();
    await test.worker.tick();
    test.sources.work = Array.from({ length: count }, (_, index) => need(`task-${index + 1}`));
    await test.worker.tick();
    expect(test.transport.post).toHaveBeenCalledTimes(count > 5 ? 1 : count);
    if (count > 5) {
      const message = vi.mocked(test.transport.post).mock.calls[0][0];
      expect(message.text).toContain("Needs you · 6 · work");
      expect(JSON.stringify(message.blocks)).toContain("Open in DevHub");
      expect(Object.values(test.store.read().items).every((item) => item.digestTs === "100.1" && !item.ts)).toBe(true);
    }
  });

  it("doesn't guess a task in a digest; a named answer creates that task's own thread", async () => {
    const test = setup();
    await test.worker.tick();
    test.sources.work = Array.from({ length: 6 }, (_, index) => need(`task-${index + 1}`));
    await test.worker.tick();
    await test.reply("100.1", "yes");
    expect(test.dependencies.answer).not.toHaveBeenCalled();
    expect(test.transport.post).toHaveBeenLastCalledWith(expect.objectContaining({ text: expect.stringContaining("so I know which task") }));
    await test.reply("100.1", "PTF-5135: Keep it");
    expect(test.dependencies.answer).toHaveBeenCalledWith("work", "task-1", "Keep it", expect.any(String), expect.anything());
    const entry = test.store.read().items[slackThreadItemId(need(), audience)];
    expect(entry.thread_ts).not.toBe(entry.digestTs);
    expect(entry.resolved).toBe(true);
    expect(test.transport.post).toHaveBeenLastCalledWith(expect.objectContaining({ thread_ts: entry.thread_ts, text: expect.stringContaining("✅ Answered") }));
  });

  it("never treats a Jira-looking title on a keyless child as its ticket identity", async () => {
    const test = setup();
    await test.worker.tick();
    test.sources.work = [need("task-1", "q1", { jiraKey: undefined, title: "PTF-5135 · Parent mentioned, not linked" }), ...Array.from({ length: 5 }, (_, index) => need(`task-${index + 2}`))];
    await test.worker.tick();
    expect(vi.mocked(test.transport.post).mock.calls[0][0].text).toContain("[task-1]");
    await test.reply("100.1", "PTF-5135: Yes");
    expect(test.dependencies.answer).not.toHaveBeenCalled();
    await test.reply("100.1", "task-1: Yes");
    expect(test.dependencies.answer).toHaveBeenCalledExactlyOnceWith("work", "task-1", "Yes", expect.any(String), expect.anything());
  });

  it("keeps existing task parents current when a burst of follow-ups becomes a digest", async () => {
    const test = setup();
    await test.worker.tick(); test.sources.work = [need()]; await test.worker.tick();
    const parent = Object.values(test.store.read().items)[0].thread_ts!;
    test.sources.work = [need("task-1", "q2"), ...Array.from({ length: 5 }, (_, index) => need(`task-${index + 2}`))];
    await test.worker.tick();
    expect(test.transport.post).toHaveBeenCalledTimes(3);
    expect(test.transport.update).toHaveBeenCalledWith(expect.objectContaining({ ts: parent, text: expect.stringContaining("Question q2?") }));
    const followUp = test.store.read().items[slackThreadItemId(need("task-1", "q2"), audience)];
    expect(followUp.thread_ts).toBe(parent);
    expect(followUp.digestTs).toBeUndefined();
    expect(test.transport.post).toHaveBeenLastCalledWith(expect.objectContaining({ thread_ts: parent, text: expect.stringContaining("<@UOWNER>") }), expect.any(Function));
  });

  it("records uncertain sends before delivery and never automatically retries them", async () => {
    const test = setup();
    await test.worker.tick(); test.sources.work = [need()];
    vi.mocked(test.transport.post).mockImplementationOnce(async () => {
      expect(Object.values(test.store.read().items)[0].delivery).toBe("sending");
      throw new Error("network lost");
    });
    await expect(test.worker.tick()).rejects.toThrow("network lost");
    expect(Object.values(test.store.read().items)[0].delivery).toBe("unknown");
    await test.worker.tick(); await test.create().tick();
    expect(test.transport.post).toHaveBeenCalledTimes(1);
  });

  it("sets a corrupt thread file aside and re-baselines instead of posting everything again", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const test = setup();
    await test.worker.tick(); test.sources.work = [need()]; await test.worker.tick();
    expect(test.transport.post).toHaveBeenCalledTimes(1);
    fs.writeFileSync(path.join(root, "threads.json"), "broken");
    await test.worker.tick();
    expect(test.transport.post).toHaveBeenCalledTimes(1);
    expect(fs.readdirSync(root).some((name) => name.startsWith("threads.json.corrupt-"))).toBe(true);
    expect(Object.values(test.store.read().items)[0].delivery).toBe("skipped");
    test.sources.work.push(need("task-2"));
    await test.worker.tick();
    expect(test.transport.post).toHaveBeenCalledTimes(2);
  });

  it("leaves open posts alone when task data or GitHub is unavailable", async () => {
    const test = setup();
    await test.worker.tick(); test.sources.work = [need()]; await test.worker.tick();
    vi.mocked(test.dependencies.snapshot).mockRejectedValueOnce(new Error("unavailable"));
    await expect(test.worker.tick()).rejects.toThrow("unavailable");
    expect(test.transport.update).not.toHaveBeenCalled();
    expect(Object.values(test.store.read().items)[0].resolved).toBe(false);
    const peer = need("peer", "", { entityId: "pr:acme/app#1", taskId: undefined, questionId: undefined, action: "open" });
    test.sources.work = [peer]; await test.worker.tick();
    vi.mocked(test.transport.update).mockClear();
    vi.mocked(test.dependencies.snapshot).mockResolvedValueOnce({ items: [], peersKnown: false });
    await test.worker.tick();
    expect(test.transport.update).not.toHaveBeenCalled();
  });

  it("defers quiet-hour posts and still resolves mapped messages", async () => {
    const test = setup();
    await test.worker.tick();
    vi.mocked(test.dependencies.quiet).mockReturnValue(true);
    test.sources.work = [need()]; await test.worker.tick();
    expect(test.transport.post).not.toHaveBeenCalled();
    vi.setSystemTime(Date.now() + 5000);
    vi.mocked(test.dependencies.quiet).mockReturnValue(false);
    await test.worker.tick();
    expect(test.transport.post).toHaveBeenCalledTimes(1);
    vi.mocked(test.dependencies.quiet).mockReturnValue(true);
    test.sources.work = []; await test.worker.tick();
    expect(test.transport.update).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining("Answered in DevHub") }));
  });

  it("never posts, resolves or even loads data on DEVHUB_SCHEDULER=0", async () => {
    vi.stubEnv("DEVHUB_SCHEDULER", "0");
    const test = setup(); test.sources.work = [need()];
    await test.worker.tick();
    expect(test.dependencies.snapshot).not.toHaveBeenCalled();
    expect(test.transport.post).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(root, "threads.json"))).toBe(false);
  });

  it("honours the posting toggle and skips new notifications while it is off", async () => {
    const test = setup({ postNeedsYou: false });
    await test.worker.tick(); test.sources.work = [need()]; await test.worker.tick();
    expect(test.transport.post).not.toHaveBeenCalled();
    expect(Object.values(test.store.read().items)[0].delivery).toBe("skipped");
  });
});

describe("Task thread answers and profiles", () => {
  it.each([1, 6])("routes replies under %i peer PRs to the read-only router, not a task picker", async (count) => {
    const test = setup();
    await test.worker.tick();
    test.sources.work = Array.from({ length: count }, (_, index) => need(`peer-${index}`, "", { entityId: `pr:acme/app#${index + 1}`, taskId: undefined, questionId: undefined, action: "open" }));
    await test.worker.tick();
    const first = Object.values(test.store.read().items)[0];
    const parent = (first.thread_ts ?? first.digestTs)!;
    expect(await test.reply(parent, "help")).toEqual({ handled: false, profile: "work" });
    expect(test.dependencies.answer).not.toHaveBeenCalled();
    expect(test.transport.post).toHaveBeenCalledTimes(1);
  });

  it("answers the question a card belongs to, not just the first open one", async () => {
    const test = setup();
    await test.worker.tick();
    const first = need("task-1", "q1", { options: ["A", "B"] });
    const second = need("task-1", "q2", { options: ["C", "D"] });
    test.sources.work = [first, second]; await test.worker.tick();
    await test.button(slackThreadItemId(second, audience), "devhub_answer_option_1");
    expect(test.dependencies.answer).toHaveBeenCalledExactlyOnceWith("work", "task-1", "D", expect.stringContaining("slack-option-"), "q2");
  });

  it("answers the oldest question, says which, and marks the parent Answered after the last answer", async () => {
    const test = setup();
    await test.worker.tick(); test.sources.work = [need(), need("task-1", "q2")]; await test.worker.tick();
    const parent = Object.values(test.store.read().items)[0].thread_ts!;
    await test.reply(parent, "Exact answer\nwith formatting");
    expect(test.dependencies.answer).toHaveBeenCalledWith("work", "task-1", "Exact answer\nwith formatting", expect.any(String), expect.anything());
    expect(test.transport.post).toHaveBeenLastCalledWith(expect.objectContaining({ text: expect.stringContaining("Question q1?"), thread_ts: parent }));
    expect(vi.mocked(test.transport.post).mock.calls.at(-1)![0].text).toContain("1 question still needs");
    expect(test.transport.update).toHaveBeenLastCalledWith(expect.objectContaining({ ts: parent, text: expect.stringContaining("Answered · Next: Question q2?") }));
    await test.reply(parent, "Second answer");
    expect(test.transport.update).toHaveBeenLastCalledWith(expect.objectContaining({ ts: parent, text: expect.stringContaining("Answered") }));
    expect(Object.values(test.store.read().items).every((item) => item.resolved)).toBe(true);
  });

  it("edits questions answered elsewhere and ignores a late answer even before the next tick", async () => {
    const test = setup();
    await test.worker.tick(); test.sources.work = [need()]; await test.worker.tick();
    const parent = Object.values(test.store.read().items)[0].thread_ts!;
    test.sources.work = [];
    // The reply still belongs to the task: it is saved as a note, not bounced to generic chat.
    expect(await test.reply(parent)).toEqual({ handled: true });
    expect(test.dependencies.answer).not.toHaveBeenCalled();
    expect(test.dependencies.taskReply!.saveNote).toHaveBeenCalledWith("work", "task-1", "Slack: Keep the last result");
    expect(test.transport.post).toHaveBeenLastCalledWith(expect.objectContaining({ text: "📝 Saved to the task note for PTF-5135.", thread_ts: parent }));
    expect(JSON.stringify(vi.mocked(test.transport.post).mock.calls)).not.toContain("Nothing to answer");
    expect(test.transport.update).toHaveBeenCalledWith(expect.objectContaining({ ts: parent, text: expect.stringContaining("Answered in DevHub") }));
    await test.worker.tick();
    expect(Object.values(test.store.read().items)[0].resolved).toBe(true);
  });

  describe("a reply with no open question goes to the task by its current state", () => {
    async function waitingOnPlan() {
      const test = setup();
      await test.worker.tick(); test.sources.work = [need("task-1", undefined, { action: "open", questionId: undefined, itemKey: "plan", needed: "Plan ready" })]; await test.worker.tick();
      const parent = Object.values(test.store.read().items)[0].thread_ts!;
      return { test, parent };
    }

    it("treats a reply to a ready plan as revision feedback, saves it and confirms in the thread", async () => {
      const { test, parent } = await waitingOnPlan();
      const taskReply = test.dependencies.taskReply!;
      vi.mocked(taskReply.state).mockReturnValue({ kind: "plan-ready", planRunId: "run-plan-1" });
      const text = "Can we just make sure this applies to games too";
      expect(await test.reply(parent, text, { eventId: "EvPlan" })).toEqual({ handled: true });
      expect(taskReply.revisePlan).toHaveBeenCalledExactlyOnceWith("work", "task-1", "run-plan-1", text, "EvPlan");
      expect(taskReply.saveNote).toHaveBeenCalledWith("work", "task-1", `Plan feedback (Slack): ${text}`);
      expect(test.transport.post).toHaveBeenLastCalledWith(expect.objectContaining({ text: "📝 Sent back for a revised plan with your feedback. Saved to the task note.", thread_ts: parent }));
      expect(test.dependencies.answer).not.toHaveBeenCalled();
    });

    it("saves a reply to a running task as a note", async () => {
      const { test, parent } = await waitingOnPlan();
      vi.mocked(test.dependencies.taskReply!.state).mockReturnValue({ kind: "running" });
      expect(await test.reply(parent, "Also check the games page")).toEqual({ handled: true });
      expect(test.dependencies.taskReply!.saveNote).toHaveBeenCalledWith("work", "task-1", "Slack: Also check the games page");
      expect(test.dependencies.taskReply!.revisePlan).not.toHaveBeenCalled();
      expect(vi.mocked(test.transport.post).mock.calls.at(-1)![0].text).toContain("Saved to the task note for PTF-5135");
    });

    it("saves a reply to an idle task as a note and keeps 'thanks' silent", async () => {
      const { test, parent } = await waitingOnPlan();
      const posts = vi.mocked(test.transport.post).mock.calls.length;
      expect(await test.reply(parent, "thanks")).toEqual({ handled: true });
      expect(test.transport.post).toHaveBeenCalledTimes(posts);
      expect(test.dependencies.taskReply!.saveNote).not.toHaveBeenCalled();
      expect(await test.reply(parent, "Remember the games page")).toEqual({ handled: true });
      expect(test.dependencies.taskReply!.saveNote).toHaveBeenCalledOnce();
      expect(vi.mocked(test.transport.post).mock.calls.at(-1)![0].text).toBe("📝 Saved to the task note for PTF-5135.");
    });

    it("leaves the open-question answer flow alone, even while a plan is ready", async () => {
      const test = setup();
      await test.worker.tick(); test.sources.work = [need()]; await test.worker.tick();
      const parent = Object.values(test.store.read().items)[0].thread_ts!;
      vi.mocked(test.dependencies.taskReply!.state).mockReturnValue({ kind: "plan-ready", planRunId: "run-plan-1" });
      await test.reply(parent, "Exact answer");
      expect(test.dependencies.answer).toHaveBeenCalledWith("work", "task-1", "Exact answer", expect.any(String), expect.anything());
      expect(test.dependencies.taskReply!.revisePlan).not.toHaveBeenCalled();
      expect(test.dependencies.taskReply!.saveNote).not.toHaveBeenCalled();
    });

    it("still ignores a reply from someone else or in another channel", async () => {
      const { test, parent } = await waitingOnPlan();
      expect(await test.reply(parent, "Hi", { userId: "UOTHER" })).toEqual({ handled: false });
      expect(await test.reply(parent, "Hi", { channelId: "COTHER" })).toEqual({ handled: false });
      expect(test.dependencies.taskReply!.saveNote).not.toHaveBeenCalled();
    });

    it("says so, without changing anything, when the task can't be read", async () => {
      const { test, parent } = await waitingOnPlan();
      vi.mocked(test.dependencies.taskReply!.state).mockImplementation(() => { throw new Error("private-detail"); });
      expect(await test.reply(parent, "Hello there")).toEqual({ handled: true });
      expect(test.dependencies.taskReply!.saveNote).not.toHaveBeenCalled();
      expect(vi.mocked(test.transport.post).mock.calls.at(-1)![0].text).toContain("Nothing changed");
      expect(JSON.stringify(vi.mocked(test.transport.post).mock.calls)).not.toContain("private-detail");
    });
  });

  it("names what was resolved when a need clears, instead of a bare 'Resolved'", async () => {
    const test = setup();
    await test.worker.tick(); test.sources.work = [need("task-1", undefined, { action: "open", questionId: undefined, itemKey: "plan", needed: "Plan ready" })]; await test.worker.tick();
    const parent = Object.values(test.store.read().items)[0].thread_ts!;
    test.sources.work = []; await test.worker.tick();
    expect(test.transport.update).toHaveBeenLastCalledWith(expect.objectContaining({ ts: parent, text: expect.stringContaining("Resolved · Plan ready") }));
  });

  it("explains a task-source failure without guessing an answer or exposing the error", async () => {
    const test = setup();
    await test.worker.tick(); test.sources.work = [need()]; await test.worker.tick();
    const parent = Object.values(test.store.read().items)[0].thread_ts!;
    vi.mocked(test.dependencies.snapshot).mockRejectedValueOnce(new Error("private-source-detail"));
    expect(await test.reply(parent)).toEqual({ handled: true });
    expect(test.dependencies.answer).not.toHaveBeenCalled();
    expect(test.transport.post).toHaveBeenLastCalledWith(expect.objectContaining({ text: expect.stringContaining("Check the task in DevHub") }));
    expect(JSON.stringify(vi.mocked(test.transport.post).mock.calls)).not.toContain("private-source-detail");
  });

  it("shows an answer made in DevHub while keeping the next open question actionable", async () => {
    const test = setup();
    await test.worker.tick(); test.sources.work = [need(), need("task-1", "q2")]; await test.worker.tick();
    const parent = Object.values(test.store.read().items)[0].thread_ts!;
    test.sources.work = [need("task-1", "q2")]; await test.worker.tick();
    expect(test.transport.update).toHaveBeenLastCalledWith(expect.objectContaining({ ts: parent, text: expect.stringContaining("Answered in DevHub · Next: Question q2?") }));
    expect(vi.mocked(test.transport.update).mock.calls.at(-1)![0].blocks?.find((block) => block.type === "actions")).toMatchObject({ type: "actions", elements: [{ action_id: "devhub_answer" }, { action_id: "devhub_open" }] });
  });

  it("updates non-question items to Resolved instead of claiming an answer", async () => {
    const test = setup();
    await test.worker.tick(); test.sources.work = [need("task-1", "", { questionId: undefined, action: "open" })]; await test.worker.tick();
    test.sources.work = []; await test.worker.tick();
    expect(test.transport.update).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining("Resolved") }));
  });

  it("revives a need that blinks out of one snapshot in place instead of posting it again", async () => {
    const test = setup();
    const pr = (index: number) => need(`pr-${index}`, "", { questionId: undefined, action: "open", entityId: `pr:repo#${index}`, taskId: undefined });
    await test.worker.tick(); test.sources.work = Array.from({ length: 6 }, (_, index) => pr(index)); await test.worker.tick();
    expect(test.transport.post).toHaveBeenCalledTimes(1);
    const digest = Object.values(test.store.read().items).find((item) => item.digestTs)!.digestTs!;
    const saved = test.sources.work;
    test.sources.work = []; await test.worker.tick();
    test.sources.work = saved; await test.worker.tick();
    expect(test.transport.post).toHaveBeenCalledTimes(1);
    expect(test.transport.update).toHaveBeenLastCalledWith(expect.objectContaining({ ts: digest }));
    expect(Object.values(test.store.read().items).every((item) => !item.resolved)).toBe(true);
  });

  it("posts only in the active profile; an old thread always answers its recorded profile", async () => {
    const test = setup();
    await test.worker.tick(); test.sources.work = [need()]; await test.worker.tick();
    const parent = Object.values(test.store.read().items)[0].thread_ts!;
    test.profile("personal"); test.sources.personal = [need("personal-1", "pq", { profile: "personal" })];
    await test.worker.tick();
    expect(test.transport.post).toHaveBeenCalledTimes(1);
    expect(test.transport.update).not.toHaveBeenCalled();
    test.sources.personal.push(need("personal-2", "pq2", { profile: "personal" }));
    await test.worker.tick();
    await test.reply(parent, "Answer in personal is just my text");
    expect(test.dependencies.answer).toHaveBeenCalledWith("work", "task-1", "Answer in personal is just my text", expect.any(String), expect.anything());
    expect(test.sources.personal).toHaveLength(2);
  });

  it("drops a snapshot if the active profile changes during the read", async () => {
    const test = setup();
    await test.worker.tick(); test.sources.work = [need()];
    vi.mocked(test.dependencies.snapshot).mockImplementationOnce(async () => { test.profile("personal"); return { items: [need()], peersKnown: true }; });
    await test.worker.tick();
    expect(test.transport.post).not.toHaveBeenCalled();
  });

  it.each([{ userId: "UOTHER" }, { channelId: "COTHER" }, { teamId: "TOTHER" }])("never answers an untrusted thread reply: %j", async (change) => {
    const test = setup();
    await test.worker.tick(); test.sources.work = [need()]; await test.worker.tick();
    await test.reply(Object.values(test.store.read().items)[0].thread_ts!, "yes", change);
    expect(test.dependencies.answer).not.toHaveBeenCalled();
    expect(test.transport.post).toHaveBeenCalledTimes(1);
  });
});

describe("Slack action confirmations", () => {
  async function posted(action: SlackNeed["action"] = "retry") {
    const test = setup();
    await test.worker.tick();
    const item = need("task-1", action === "retry" ? "" : "q1", { action, questionId: action === "retry" ? undefined : "q1" });
    test.sources.work = [item]; await test.worker.tick();
    return { ...test, id: slackThreadItemId(item, audience) };
  }

  describe("Plan and Implement buttons", () => {
    async function open() {
      const test = setup();
      await test.worker.tick();
      const item = need("task-1", "", { action: "open", questionId: undefined });
      test.sources.work = [item];
      await test.worker.tick();
      return { ...test, id: slackThreadItemId(item, audience) };
    }
    it.each([["devhub_need_plan", "plan"], ["devhub_need_implement", "implement"]] as const)("%s hands the task to the Confirm path and posts its card in the thread", async (action, kind) => {
      const test = await open();
      await test.button(test.id, action);
      const parent = test.store.read().items[test.id].thread_ts;
      expect(test.propose).toHaveBeenCalledExactlyOnceWith(kind, { profile: "work", taskId: "task-1", channel: "CCHANNEL", threadTs: parent, teamId: "TTEAM", userId: "UOWNER" });
      expect(test.transport.post).toHaveBeenLastCalledWith(expect.objectContaining({ text: `Confirm ${kind}?` }));
      expect(test.dependencies.retry).not.toHaveBeenCalled();
    });
    it("does nothing for a task that is waiting on an answer, or once it has been resolved in DevHub", async () => {
      const waiting = await posted("answer");
      await waiting.button(waiting.id, "devhub_need_plan");
      expect(waiting.propose).not.toHaveBeenCalled();
      const gone = await open();
      gone.sources.work = [];
      await gone.button(gone.id, "devhub_need_implement");
      expect(gone.propose).not.toHaveBeenCalled();
    });
  });

  it("Answer only explains how to reply; it never invents or submits an answer", async () => {
    const test = await posted("answer");
    await test.button(test.id);
    expect(test.transport.post).toHaveBeenLastCalledWith(expect.objectContaining({ text: expect.stringContaining("Reply in this thread") }));
    expect(test.dependencies.answer).not.toHaveBeenCalled();
  });

  it("doesn't offer Retry confirmation when it can't check the task", async () => {
    const test = await posted();
    vi.mocked(test.dependencies.snapshot).mockRejectedValueOnce(new Error("private-source-detail"));
    await test.button(test.id, "devhub_retry");
    expect(Object.keys(test.store.read().confirmations)).toHaveLength(0);
    expect(test.dependencies.retry).not.toHaveBeenCalled();
    expect(test.transport.post).toHaveBeenLastCalledWith(expect.objectContaining({ text: expect.stringContaining("Nothing changed") }));
    expect(JSON.stringify(vi.mocked(test.transport.post).mock.calls)).not.toContain("private-source-detail");
  });

  it("requires Confirm after Retry and consumes that expiring confirmation exactly once", async () => {
    const test = await posted();
    await test.button(test.id, "devhub_retry");
    expect(test.dependencies.retry).not.toHaveBeenCalled();
    const [token, confirmation] = Object.entries(test.store.read().confirmations)[0];
    expect(test.transport.post).toHaveBeenLastCalledWith(expect.objectContaining({ text: expect.stringContaining("Retry PTF-5135") }));
    await test.button(token, "devhub_confirm_retry", { ts: confirmation.ts! });
    await test.button(token, "devhub_confirm_retry", { ts: confirmation.ts! });
    expect(test.dependencies.retry).toHaveBeenCalledExactlyOnceWith("work", "task-1", token);
    expect(test.store.read().confirmations[token].state).toBe("consumed");
    await test.create().interact({ teamId: "TTEAM", userId: "UOWNER", channelId: "CCHANNEL", ts: confirmation.ts!, value: token, action: "devhub_confirm_retry", actionTs: "999.1" });
    expect(test.dependencies.retry).toHaveBeenCalledTimes(1);
  });

  it("binds gateway Retry confirms to device, arguments and nonce without consuming a stolen click", async () => {
    const test = await posted();
    await test.button(test.id, "devhub_retry");
    const [token, confirmation] = Object.entries(test.store.read().confirmations)[0];
    const item = test.store.read().items[confirmation.itemId];
    await test.store.change((state) => {
      Object.assign(state.confirmations[token], { deviceId: "device-one", nonce: token, argsHash: createHash("sha256").update(JSON.stringify([item.profile, item.taskId, confirmation.itemId])).digest("hex") });
    });
    await test.button(token, "devhub_confirm_retry", { ts: confirmation.ts!, deviceId: "device-two" });
    expect(test.dependencies.retry).not.toHaveBeenCalled();
    expect(test.store.read().confirmations[token].state).toBe("pending");
    await test.button(token, "devhub_confirm_retry", { ts: confirmation.ts!, deviceId: "device-one" });
    await test.button(token, "devhub_confirm_retry", { ts: confirmation.ts!, deviceId: "device-one" });
    expect(test.dependencies.retry).toHaveBeenCalledTimes(1);
  });

  it.each(["cancel", "expire", "stale"])("doesn't retry a %s confirmation", async (scenario) => {
    const test = await posted();
    await test.button(test.id, "devhub_retry");
    const [token, confirmation] = Object.entries(test.store.read().confirmations)[0];
    if (scenario === "expire") vi.setSystemTime(Date.now() + 300000);
    if (scenario === "stale") test.sources.work = [];
    await test.button(token, scenario === "cancel" ? "devhub_cancel_retry" : "devhub_confirm_retry", { ts: confirmation.ts! });
    expect(test.dependencies.retry).not.toHaveBeenCalled();
  });

  it.each([{ userId: "UOTHER" }, { channelId: "COTHER" }, { teamId: "TOTHER" }, { ts: "999.9" }])("rejects a stolen or transplanted confirmation: %j", async (change) => {
    const test = await posted();
    await test.button(test.id, "devhub_retry", change);
    expect(Object.keys(test.store.read().confirmations)).toHaveLength(0);
    await test.button(test.id, "devhub_retry");
    const [token, confirmation] = Object.entries(test.store.read().confirmations)[0];
    await test.button(token, "devhub_confirm_retry", { ts: confirmation.ts!, ...change });
    expect(test.dependencies.retry).not.toHaveBeenCalled();
  });

  it("never treats free text as consent to Retry", async () => {
    const test = await posted();
    const parent = test.store.read().items[test.id].thread_ts!;
    // Free text is task chatter: it is saved as a note for the task, and nothing is retried.
    expect(await test.reply(parent, "retry start resume please")).toEqual({ handled: true });
    expect(test.dependencies.taskReply!.saveNote).toHaveBeenCalledWith("work", "task-1", "Slack: retry start resume please");
    expect(test.dependencies.retry).not.toHaveBeenCalled();
    expect(test.dependencies.answer).not.toHaveBeenCalled();
  });

  it("records a failed retry as consumed rather than risking another run", async () => {
    const test = await posted();
    await test.button(test.id, "devhub_retry");
    const [token, confirmation] = Object.entries(test.store.read().confirmations)[0];
    vi.mocked(test.dependencies.retry).mockRejectedValue(new Error("private-token"));
    await test.button(token, "devhub_confirm_retry", { ts: confirmation.ts! });
    await test.button(token, "devhub_confirm_retry", { ts: confirmation.ts! });
    expect(test.dependencies.retry).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(vi.mocked(test.transport.update).mock.calls)).not.toContain("private-token");
  });

  it("consumes Confirm and replaces its buttons even if the final task check fails", async () => {
    const test = await posted();
    await test.button(test.id, "devhub_retry");
    const [token, confirmation] = Object.entries(test.store.read().confirmations)[0];
    vi.mocked(test.dependencies.snapshot).mockRejectedValueOnce(new Error("private-source-detail"));
    await test.button(token, "devhub_confirm_retry", { ts: confirmation.ts! });
    expect(test.dependencies.retry).not.toHaveBeenCalled();
    expect(test.store.read().confirmations[token].state).toBe("consumed");
    expect(test.transport.update).toHaveBeenLastCalledWith(expect.objectContaining({ ts: confirmation.ts, text: expect.stringContaining("Check DevHub before requesting another retry") }));
    expect(JSON.stringify(vi.mocked(test.transport.update).mock.calls)).not.toContain("private-source-detail");
  });
});

describe("a failed post only affects the item in flight", () => {
  const rateLimited = () => Object.assign(new Error("rate limited"), { code: "slack_webapi_rate_limited_error", retryAfter: 30 });
  const deliveries = (test: ReturnType<typeof setup>) => Object.fromEntries(Object.values(test.store.read().items).map((item) => [item.taskId, item.delivery]));
  const three = () => [need("task-1"), need("task-2"), need("task-3")];

  it("an unknown outcome marks only that item unknown; later items are untouched and sent on the next tick", async () => {
    const test = setup();
    await test.worker.tick(); test.sources.work = three();
    vi.mocked(test.transport.post).mockImplementationOnce(async (message) => ({ channel: message.channel, ts: "100.1" }));
    vi.mocked(test.transport.post).mockImplementationOnce(async () => { throw new Error("connection reset"); });
    await expect(test.worker.tick()).rejects.toThrow("connection reset");
    expect(deliveries(test)).toEqual({ "task-1": "sent", "task-2": "unknown" });
    expect(test.transport.post).toHaveBeenCalledTimes(2);
    await test.worker.tick();
    expect(deliveries(test)).toEqual({ "task-1": "sent", "task-2": "unknown", "task-3": "sent" });
    expect(test.transport.post).toHaveBeenCalledTimes(3);
    expect(vi.mocked(test.transport.post).mock.calls[2][0].text).toContain("task-3");
    await test.worker.tick();
    expect(test.transport.post).toHaveBeenCalledTimes(3);
  });
  it.each([
    ["a rate limit that outlasted the retries", rateLimited],
    ["a DNS failure", () => Object.assign(new Error("request failed"), { code: "slack_webapi_request_error", original: { cause: { code: "ENOTFOUND" } } })],
    ["a send we stopped ourselves", () => new SlackNotSentError("Slack delivery stopped")],
  ])("%s leaves that item and everything after it eligible for the next tick", async (_name, failure) => {
    const test = setup();
    await test.worker.tick(); test.sources.work = three();
    vi.mocked(test.transport.post).mockImplementationOnce(async (message) => ({ channel: message.channel, ts: "100.1" }));
    vi.mocked(test.transport.post).mockImplementationOnce(async () => { throw failure(); });
    await expect(test.worker.tick()).rejects.toThrow();
    expect(deliveries(test)).toEqual({ "task-1": "sent" });
    await test.worker.tick();
    expect(deliveries(test)).toEqual({ "task-1": "sent", "task-2": "sent", "task-3": "sent" });
    expect(test.transport.post).toHaveBeenCalledTimes(4);
  });
  it("reserves each item only just before its own request", async () => {
    const test = setup();
    await test.worker.tick(); test.sources.work = three();
    const seen: string[][] = [];
    vi.mocked(test.transport.post).mockImplementation(async (message) => {
      seen.push(Object.values(test.store.read().items).filter((item) => item.delivery === "sending").map((item) => item.taskId!));
      return { channel: message.channel, ts: `100.${seen.length}` };
    });
    await test.worker.tick();
    expect(seen).toEqual([["task-1"], ["task-2"], ["task-3"]]);
  });
  it("puts a re-posted need's earlier resolved entry back when the send provably failed", async () => {
    const test = setup();
    await test.worker.tick(); test.sources.work = [need()]; await test.worker.tick();
    const id = slackThreadItemId(need(), audience);
    await test.store.change((state) => { state.items[id].resolved = true; });
    test.sources.work = [];
    await test.worker.tick();
    test.sources.work = [need()];
    vi.mocked(test.transport.post).mockRejectedValueOnce(rateLimited());
    await expect(test.worker.tick()).rejects.toThrow();
    expect(test.store.read().items[id]).toMatchObject({ resolved: true, delivery: "sent" });
    await test.worker.tick();
    expect(test.store.read().items[id]).toMatchObject({ resolved: false, delivery: "sent" });
    expect(test.transport.post).toHaveBeenCalledTimes(3);
  });
  it("a digest that never reached Slack is retried whole; one with an unknown outcome is not", async () => {
    const test = setup();
    await test.worker.tick(); test.sources.work = Array.from({ length: 6 }, (_, index) => need(`task-${index + 1}`));
    vi.mocked(test.transport.post).mockRejectedValueOnce(rateLimited());
    await expect(test.worker.tick()).rejects.toThrow();
    expect(Object.keys(test.store.read().items)).toHaveLength(0);
    await test.worker.tick();
    expect(Object.values(test.store.read().items).every((item) => item.delivery === "sent" && item.digestTs)).toBe(true);
    const other = setup();
    await other.worker.tick(); other.sources.work = Array.from({ length: 6 }, (_, index) => need(`task-${index + 1}`));
    vi.mocked(other.transport.post).mockRejectedValueOnce(new Error("connection reset"));
    await expect(other.worker.tick()).rejects.toThrow();
    expect(Object.values(other.store.read().items).every((item) => item.delivery === "unknown")).toBe(true);
    await other.worker.tick();
    expect(other.transport.post).toHaveBeenCalledTimes(1);
  });
});

describe("answers typed in a Needs you thread", () => {
  async function waiting() {
    const test = setup();
    await test.worker.tick(); test.sources.work = [need()]; await test.worker.tick();
    return { test, parent: Object.values(test.store.read().items)[0].thread_ts! };
  }
  it("is saved as the person wrote it, not as Slack's wire format", async () => {
    const { test, parent } = await waiting();
    await test.reply(parent, "Use &lt;staging&gt; &amp; ask <@U123ABC|sam> see <https://example.com/a?b=1&amp;c=2|the doc> or <https://example.com/x>");
    expect(test.dependencies.answer).toHaveBeenCalledExactlyOnceWith("work", "task-1", "Use <staging> & ask @sam see the doc (https://example.com/a?b=1&c=2) or https://example.com/x", expect.any(String), expect.anything());
  });
  it("unescapes a digest answer too, after the task key", async () => {
    const test = setup();
    await test.worker.tick();
    test.sources.work = Array.from({ length: 6 }, (_, index) => need(`task-${index + 1}`));
    await test.worker.tick();
    const digest = Object.values(test.store.read().items)[0].digestTs!;
    await test.reply(digest, "task-2: a &amp; b");
    expect(test.dependencies.answer).toHaveBeenCalledExactlyOnceWith("work", "task-2", "a & b", expect.any(String), expect.anything());
  });
  it.each(["thanks", "Thank you!", "ok", "okay", "ty", "cheers", "nice", "great", "👍", ":thumbsup:"])("%j is not an answer: nothing is saved, no reply, no model", async (text) => {
    const { test, parent } = await waiting();
    const posts = vi.mocked(test.transport.post).mock.calls.length;
    expect(await test.reply(parent, text)).toEqual({ handled: true });
    expect(test.dependencies.answer).not.toHaveBeenCalled();
    expect(vi.mocked(test.transport.post).mock.calls).toHaveLength(posts);
    expect(Object.values(test.store.read().items)[0].resolved).toBe(false);
  });
  it("still takes a real answer that starts with a polite word", async () => {
    const { test, parent } = await waiting();
    await test.reply(parent, "ok but keep the old behaviour");
    expect(test.dependencies.answer).toHaveBeenCalledTimes(1);
  });
});
