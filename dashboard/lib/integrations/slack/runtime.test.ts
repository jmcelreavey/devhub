import { afterEach, describe, expect, it, vi } from "vitest";
import { SlackRuntime, startRetryDelay, START_RETRY_MAX_MS, type SlackDependencies } from "./runtime";
import type { SlackLockResult } from "./process-lock";
import type { SlackClient, SlackEnvelope } from "./client";
import type { SlackConnectionState } from "./shared";
import { buildSlackAnswer } from "./answers";
import { NEEDS_YOU_TICK_MS, type SlackNeedsTransport, type SlackReplyResult } from "./needs-you";
import { HOME_DEBOUNCE_MS } from "./runtime";
import * as slackSettings from "./settings";
import { teamFixture } from "@/lib/team/fixtures.test-helper";

const settings = { botToken: "xoxb-fake", appToken: "xapp-private-app", channelId: "CCHANNEL", allowedUserId: "UOWNER", teamId: "TTEAM" };
const body = { team_id: "TTEAM", event_id: "Ev123", event: { type: "message", user: "UOWNER", channel: "CCHANNEL", text: "help", ts: "123.456" } };
const runtimes: SlackRuntime[] = [];
const interactionBody = {
  type: "block_actions", team: { id: "TTEAM" }, user: { id: "UOWNER" }, channel: { id: "CCHANNEL" },
  container: { type: "message", channel_id: "CCHANNEL", message_ts: "999.1", is_ephemeral: false }, message: { ts: "999.1" },
  actions: [{ type: "button", action_id: "devhub_retry", value: "a".repeat(64), action_ts: "999.2" }],
};

afterEach(async () => { for (const runtime of runtimes.splice(0)) await runtime.stop(); vi.useRealTimers(); });

function setup() {
  const clients: Array<SlackClient & { emit: (envelope: Partial<SlackEnvelope>) => Promise<void>; state: (state: SlackConnectionState, error?: unknown) => void }> = [];
  const seen = new Set<string>();
  const needsYou = { reset: vi.fn(), tick: vi.fn(async () => {}), reply: vi.fn(async (): Promise<SlackReplyResult> => ({ handled: false })), interact: vi.fn(async () => {}), stop: vi.fn(async () => {}) };
  const tools = {
    handle: vi.fn(async (_text: string, context: { channel: string; threadTs?: string }) => [{ channel: context.channel, thread_ts: context.threadTs, text: "from tools" }]),
    interact: vi.fn(async () => ({ update: { channel: "CCHANNEL", text: "Confirmed" }, post: [{ channel: "CCHANNEL", text: "tool result" }] })),
    recordRule: vi.fn(), close: vi.fn(async () => {}),
    checkOff: vi.fn(async (target: { channel: string; threadTs?: string }) => [{ channel: target.channel, thread_ts: target.threadTs, text: "Checked off · A task", taskRef: { profile: "work", taskId: "task-1", title: "A task" } }]),
  };
  const taskDirectory = {
    resolve: vi.fn((_audience: unknown, _channel: string, ts: string) => ts === "50.1" ? { profile: "work", taskId: "task-1", threadTs: "40.1" } : undefined),
    remember: vi.fn(async () => {}),
  };
  const dependencies: SlackDependencies = {
    createClient: vi.fn(() => {
      let envelopeListener: (event: SlackEnvelope) => Promise<void> = async () => {};
      let stateListener: (state: SlackConnectionState, error?: unknown) => void = () => {};
      const client = {
        authenticate: vi.fn(async () => ({ userId: "UBOT", name: "DevHub", teamId: "TTEAM" })),
        start: vi.fn(async () => { stateListener("connected"); }), stop: vi.fn(async () => {}), postMessage: vi.fn(async () => ({ channel: "CCHANNEL", ts: "123.456" })), updateMessage: vi.fn(async () => {}), publishHome: vi.fn(async () => {}), openModal: vi.fn(async () => {}),
        onEnvelope: (listener: typeof envelopeListener) => { envelopeListener = listener; },
        onState: (listener: typeof stateListener) => { stateListener = listener; },
        emit: (envelope: Partial<SlackEnvelope>) => envelopeListener({ envelopeId: "envelope-1", type: "events_api", body, acknowledge: async () => {}, ...envelope }),
        state: (state: SlackConnectionState, error?: unknown) => stateListener(state, error),
      };
      clients.push(client);
      return client;
    }),
    readSettings: vi.fn(() => ({ ...settings })), primary: vi.fn(() => true),
    context: vi.fn(() => ({ activeProfile: "work", profiles: ["work", "personal"] })),
    answer: vi.fn((text, context) => buildSlackAnswer({ kind: text === "help" ? "help" : "unknown", profile: context.activeProfile })),
    claim: vi.fn(async (keys: readonly string[]) => {
      if (keys.some((key) => seen.has(key))) return false;
      keys.forEach((key) => seen.add(key));
      return true;
    }),
    reserveSend: vi.fn(async () => 0), wait: vi.fn(async () => {}),
    createNeedsYou: vi.fn(() => needsYou),
    tools, taskDirectory: () => taskDirectory,
    buildHome: vi.fn(async () => ({ type: "home" as const, blocks: [{ type: "section" as const, text: { type: "plain_text" as const, text: "live dashboard" } }] })),
  };
  const runtime = new SlackRuntime(dependencies);
  runtimes.push(runtime);
  return { runtime, dependencies, clients, needsYou, tools, taskDirectory };
}

describe("Slack Socket Mode lifecycle", () => {
  it("posts an acknowledgement before background work, handles the next message, then posts in the original thread", async () => {
    const { runtime, clients, tools } = setup();
    let finish!: () => void;
    const held = new Promise<void>((resolve) => { finish = resolve; });
    tools.handle.mockImplementation(async (text, raw) => {
      const context = raw as import("./tool-handler").SlackToolContext;
      if (text === "large question") {
        await context.background!({ channel: context.channel, thread_ts: context.threadTs, text: "Working on it" }, async () => {
          expect(clients[0].postMessage).toHaveBeenCalledWith(expect.objectContaining({ text: "Working on it" }));
          await held;
          return [{ channel: context.channel, thread_ts: context.threadTs, text: "Finished" }];
        });
        return [];
      }
      return [{ channel: context.channel, text: "Quick answer", thread_ts: context.threadTs }];
    });
    await runtime.refresh();
    await clients[0].emit({ body: { ...body, event: { ...body.event, text: "large question" } } });
    await clients[0].emit({ envelopeId: "second", body: { ...body, event_id: "Ev2", event: { ...body.event, text: "quick question", ts: "200.0" } } });
    expect(clients[0].postMessage).toHaveBeenCalledWith(expect.objectContaining({ text: "Quick answer", thread_ts: "200.0" }));
    expect(clients[0].postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ text: "Finished" }));
    finish();
    await vi.waitFor(() => expect(clients[0].postMessage).toHaveBeenCalledWith(expect.objectContaining({ text: "Finished", thread_ts: "123.456" })));
  });

  it("aborts a background answer on shutdown and never posts its late result", async () => {
    const { runtime, clients, tools } = setup();
    let signal: AbortSignal | undefined;
    tools.handle.mockImplementation(async (_text, raw) => {
      const context = raw as import("./tool-handler").SlackToolContext;
      await context.background!({ channel: context.channel, text: "Working" }, async (cancel) => {
        signal = cancel;
        await new Promise<void>((resolve) => cancel.addEventListener("abort", () => resolve(), { once: true }));
        return [{ channel: context.channel, text: "Late answer" }];
      });
      return [];
    });
    await runtime.refresh();
    await clients[0].emit({});
    await runtime.stop();
    expect(signal?.aborted).toBe(true);
    expect(clients[0].postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ text: "Late answer" }));
  });

  it("passes direct modal support to Needs you and routes an owner revision submission once", async () => {
    const { runtime, dependencies, clients, needsYou } = setup(); await runtime.refresh();
    const transport = vi.mocked(dependencies.createNeedsYou).mock.calls[0][2];
    const view = { type: "modal" as const, title: { type: "plain_text" as const, text: "Revise plan" }, blocks: [] };
    await transport.openModal!("trigger-one", view);
    expect(clients[0].openModal).toHaveBeenCalledWith("trigger-one", view);
    const body = { type: "view_submission", team: { id: "TTEAM" }, user: { id: "UOWNER" }, view: { id: "VREVISION", callback_id: "devhub_submit_plan_revision", private_metadata: `${"a".repeat(64)}:11111111-1111-4111-8111-111111111111`, state: { values: { plan_revision: { guidance: { type: "plain_text_input", value: "Keep reads local" } } } } } };
    await clients[0].emit({ type: "interactive", body });
    await clients[0].emit({ envelopeId: "revision-retry", type: "interactive", body });
    expect(needsYou.interact).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ surface: "modal", action: "devhub_submit_plan_revision", revisionText: "Keep reads local" }));
  });
  it("reconciles saved handoffs on first connection, reconnect and the periodic check", async () => {
    vi.useFakeTimers();
    const current = teamFixture("UOWNER");
    const configured = vi.spyOn(slackSettings, "slackConfigured").mockReturnValue(true);
    const reconcile = vi.spyOn(current.service.handoffs, "reconcile").mockResolvedValue();
    const { runtime, dependencies, clients } = setup();
    current.env.audience().teamId = "TTEAM";
    dependencies.team = current.service;
    vi.mocked(dependencies.readSettings).mockReturnValue({ ...settings, mode: "gateway", gatewayUrl: "http://localhost:9999", deviceId: current.env.audience().deviceId });
    try {
      await runtime.refresh();
      expect(reconcile).toHaveBeenCalledTimes(1);
      clients[0].state("reconnecting"); clients[0].state("connected");
      expect(reconcile).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(reconcile).toHaveBeenCalledTimes(3);
    } finally { await runtime.stop(); configured.mockRestore(); current.cleanup(); }
  });
  it("silently ignores the owner's ask-thread message before any answer or tool router", async () => {
    const current = teamFixture("UOWNER");
    const configured = vi.spyOn(slackSettings, "slackConfigured").mockReturnValue(true);
    const { runtime, dependencies, clients, needsYou, tools } = setup();
    current.env.audience().teamId = "TTEAM";
    dependencies.team = current.service;
    vi.mocked(dependencies.readSettings).mockReturnValue({ ...settings, mode: "gateway", gatewayUrl: "http://localhost:9999", deviceId: current.env.audience().deviceId });
    await current.env.store.change((state) => { state.asks.ask = { ...current.env.audience(), askId: "ask", taskId: "task-one", helperUserId: "U2", question: "Question", questionId: "q1", questionHash: "hash", channel: "CCHANNEL", groupDm: false, ts: "1.000", createdAt: Date.now(), expiresAt: Date.now() + 86400000, status: "active" }; });
    try {
      await runtime.refresh();
      const payload = { ...body, event: { ...body.event, text: "<@UBOT> help", thread_ts: "1.000" } };
      await clients[0].emit({ body: payload, gateway: { deviceId: current.env.audience().deviceId, envelope: { id: "envelope-1", kind: "message", teamId: "TTEAM", userId: "UOWNER", channelId: "CCHANNEL", threadTs: "1.000", deadline: Date.now() + 120000, payload } } });
      expect(needsYou.reply).not.toHaveBeenCalled();
      expect(dependencies.answer).not.toHaveBeenCalled();
      expect(tools.handle).not.toHaveBeenCalled();
      expect(clients[0].postMessage).not.toHaveBeenCalled();
    } finally { await runtime.stop(); configured.mockRestore(); current.cleanup(); }
  });
  it.each(["botToken", "appToken", "channelId", "allowedUserId"])("does not create a client without %s", async (field) => {
    const { runtime, dependencies } = setup();
    vi.mocked(dependencies.readSettings).mockReturnValue({ ...settings, [field]: "" });
    await runtime.refresh();
    expect(dependencies.createClient).not.toHaveBeenCalled();
    expect(runtime.status()).toMatchObject({ configured: false, connection: { state: "not-configured" } });
  });
  it("never starts a secondary dashboard, even with valid tokens", async () => {
    const { runtime, dependencies } = setup();
    vi.mocked(dependencies.primary).mockReturnValue(false);
    await runtime.refresh();
    expect(dependencies.createClient).not.toHaveBeenCalled();
    expect(runtime.status().connection.state).toBe("disabled");
  });
  it("starts once, even if status was read before instrumentation", async () => {
    const { runtime, clients } = setup();
    runtime.status(); runtime.start(); runtime.start();
    await vi.waitFor(() => expect(clients[0]?.start).toHaveBeenCalledTimes(1));
    expect(clients).toHaveLength(1);
    expect(runtime.status().connection.message).toBe("Connected as @DevHub in CCHANNEL");
    expect(JSON.stringify(runtime.status())).not.toMatch(/private-bot|private-app/);
    await runtime.stop();
  });
  it("acknowledges before work, replies in the message thread and never executes actions", async () => {
    const { runtime, dependencies, clients } = setup();
    await runtime.refresh();
    const acknowledge = vi.fn(async () => {});
    await clients[0].emit({ acknowledge });
    expect(acknowledge).toHaveBeenCalledTimes(1);
    expect(acknowledge.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(dependencies.claim).mock.invocationCallOrder[0]);
    expect(clients[0].postMessage).toHaveBeenCalledTimes(1);
    expect(clients[0].postMessage).toHaveBeenCalledWith(expect.objectContaining({ channel: "CCHANNEL", thread_ts: "123.456" }));
    expect(dependencies.answer).toHaveBeenCalledWith("help", { activeProfile: "work", profiles: ["work", "personal"] });
  });
  it("acknowledges but silently ignores unrelated users, bots, channels, workspaces and interactivity", async () => {
    const { runtime, dependencies, clients } = setup();
    await runtime.refresh();
    const acknowledge = vi.fn(async () => {});
    for (const patch of [{ user: "UOTHER" }, { channel: "COTHER" }, { bot_id: "BBOT" }, { subtype: "message_changed" }]) {
      await clients[0].emit({ acknowledge, body: { ...body, event: { ...body.event, ...patch } } });
    }
    await clients[0].emit({ acknowledge, body: { ...body, team_id: "TOTHER" } });
    await clients[0].emit({ acknowledge, type: "interactive" });
    expect(acknowledge).toHaveBeenCalledTimes(6);
    expect(dependencies.claim).not.toHaveBeenCalled();
    expect(clients[0].postMessage).not.toHaveBeenCalled();
  });
  it("deduplicates envelopes, retries and message/app-mention copies without querying history", async () => {
    const { runtime, clients } = setup();
    await runtime.refresh();
    await clients[0].emit({});
    await clients[0].emit({});
    await clients[0].emit({ envelopeId: "retry-2" });
    await clients[0].emit({ envelopeId: "mention-3", body: { ...body, event_id: "EvMention", event: { ...body.event, type: "app_mention" } } });
    expect(clients[0].postMessage).toHaveBeenCalledTimes(1);
  });
  it("reflects SDK reconnects without starting another client or replaying history", async () => {
    const { runtime, clients, needsYou } = setup();
    await runtime.refresh();
    clients[0].state("reconnecting");
    expect(runtime.status().connection.state).toBe("reconnecting");
    clients[0].state("connected");
    expect(runtime.status().connection.state).toBe("connected");
    expect(clients[0].start).toHaveBeenCalledTimes(1);
    expect(clients[0].postMessage).not.toHaveBeenCalled();
    expect(needsYou.reset).toHaveBeenCalledTimes(3);
  });
  it("does not strand a healthy socket after an SDK error that isn't a disconnect", async () => {
    const { runtime, clients, needsYou } = setup();
    await runtime.refresh();
    clients[0].state("error", new Error("private-token"));
    expect(runtime.status().connection.state).toBe("error");
    await clients[0].emit({});
    expect(clients[0].postMessage).toHaveBeenCalledTimes(1);
    expect(clients[0].start).toHaveBeenCalledTimes(1);
    expect(needsYou.reset).toHaveBeenCalledTimes(1);
    expect(runtime.status().connection.state).toBe("connected");
  });
  it("always disconnects even if tool teardown fails, and a later save can recover", async () => {
    const { runtime, clients, tools } = setup();
    await runtime.refresh();
    tools.close.mockRejectedValueOnce(new Error("private-token"));
    await runtime.refresh();
    expect(clients[0].stop).toHaveBeenCalledTimes(1);
    expect(runtime.status().connection.state).toBe("error");
    expect(JSON.stringify(runtime.status())).not.toContain("private-token");
    await runtime.refresh();
    expect(clients).toHaveLength(2);
    expect(runtime.status().connection.state).toBe("connected");
  });
  it("restarts on save, closes the old socket and rejects its late messages", async () => {
    const { runtime, dependencies, clients } = setup();
    await runtime.refresh();
    vi.mocked(dependencies.readSettings).mockReturnValue({ ...settings, channelId: "COTHER" });
    await runtime.refresh();
    expect(clients[0].stop).toHaveBeenCalledTimes(1);
    expect(clients).toHaveLength(2);
    await clients[0].emit({});
    await clients[1].emit({ body: { ...body, event: { ...body.event, channel: "COTHER" } } });
    expect(clients[0].postMessage).not.toHaveBeenCalled();
    expect(clients[1].postMessage).toHaveBeenCalledTimes(1);
  });
  it("stops processing in-flight answers as soon as settings change", async () => {
    const { runtime, dependencies, clients } = setup();
    await runtime.refresh();
    let finish: ((answer: ReturnType<typeof buildSlackAnswer>) => void) | undefined;
    vi.mocked(dependencies.answer).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const incoming = clients[0].emit({});
    await vi.waitFor(() => expect(finish).toBeDefined());
    const saving = runtime.refresh();
    finish!(buildSlackAnswer({ kind: "help", profile: "work" }));
    await Promise.all([incoming, saving]);
    expect(clients[0].postMessage).not.toHaveBeenCalled();
  });
  it("waits for pacing and ignores events after stop", async () => {
    const { runtime, dependencies, clients } = setup();
    vi.mocked(dependencies.reserveSend).mockResolvedValue(1100);
    await runtime.refresh();
    await clients[0].emit({});
    expect(dependencies.wait).toHaveBeenCalledWith(1100);
    await runtime.stop();
    await clients[0].emit({ envelopeId: "late" });
    expect(clients[0].postMessage).toHaveBeenCalledTimes(1);
  });
  it("does not start a socket in a different workspace or for the bot's member ID", async () => {
    const { runtime, dependencies, clients } = setup();
    vi.mocked(dependencies.readSettings).mockReturnValue({ ...settings, allowedUserId: "UBOT" });
    await runtime.refresh();
    expect(clients[0].start).not.toHaveBeenCalled();
    expect(runtime.status().connection.state).toBe("error");
  });
  it("surfaces errors in plain words without logging tokens or retrying uncertain replies", async () => {
    const { runtime, clients } = setup();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await runtime.refresh();
      vi.mocked(clients[0].postMessage).mockRejectedValue(new Error("private-token"));
      await clients[0].emit({});
      await clients[0].emit({ envelopeId: "retry" });
      expect(runtime.status().connection.state).toBe("error");
      expect(JSON.stringify(runtime.status())).not.toContain("private-token");
      expect(clients[0].postMessage).toHaveBeenCalledTimes(1);
      expect(log).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });
  it("routes mapped replies to the task handler before the read-only router", async () => {
    const { runtime, clients, dependencies, needsYou } = setup();
    needsYou.reply.mockResolvedValue({ handled: true });
    await runtime.refresh();
    const acknowledge = vi.fn(async () => {});
    await clients[0].emit({ acknowledge, body: { ...body, event: { ...body.event, thread_ts: "100.1", text: "Answer" } } });
    expect(needsYou.reply).toHaveBeenCalledWith(expect.objectContaining({ threadTs: "100.1", text: "Answer" }));
    expect(acknowledge.mock.invocationCallOrder[0]).toBeLessThan(needsYou.reply.mock.invocationCallOrder[0]);
    expect(dependencies.answer).not.toHaveBeenCalled();
  });
  it("falls back to read-only answers in a mapped thread's recorded profile", async () => {
    const { runtime, clients, dependencies, needsYou } = setup();
    needsYou.reply.mockResolvedValue({ handled: false, profile: "personal" });
    await runtime.refresh(); await clients[0].emit({});
    expect(dependencies.answer).toHaveBeenCalledWith("help", { activeProfile: "personal", profiles: ["work", "personal"] });
  });
  it("acknowledges and deduplicates button interactions before handling them", async () => {
    const { runtime, clients, dependencies, needsYou } = setup();
    await runtime.refresh();
    const acknowledge = vi.fn(async () => {});
    await clients[0].emit({ type: "interactive", body: interactionBody, acknowledge });
    await clients[0].emit({ envelopeId: "retry-envelope", type: "interactive", body: interactionBody, acknowledge });
    expect(acknowledge).toHaveBeenCalledTimes(2);
    expect(acknowledge.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(dependencies.claim).mock.invocationCallOrder[0]);
    expect(needsYou.interact).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ action: "devhub_retry", userId: "UOWNER", ts: "999.1" }));
  });
  it.each([{ user: { id: "UOTHER" } }, { channel: { id: "COTHER" } }, { team: { id: "TOTHER" } }])("acks but ignores interaction allowlist failures: %j", async (patch) => {
    const { runtime, clients, dependencies, needsYou } = setup();
    await runtime.refresh();
    const acknowledge = vi.fn(async () => {});
    await clients[0].emit({ type: "interactive", body: { ...interactionBody, ...patch }, acknowledge });
    expect(acknowledge).toHaveBeenCalledTimes(1);
    expect(dependencies.claim).not.toHaveBeenCalled();
    expect(needsYou.interact).not.toHaveBeenCalled();
  });
  it("acks another interaction immediately even while an earlier action is waiting", async () => {
    vi.useFakeTimers();
    const { runtime, clients, needsYou } = setup();
    await runtime.refresh();
    let finish: (() => void) | undefined;
    needsYou.interact.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const first = clients[0].emit({ type: "interactive", body: interactionBody });
    await vi.advanceTimersByTimeAsync(0);
    expect(finish).toBeDefined();
    const acknowledge = vi.fn(async () => {});
    const second = clients[0].emit({ envelopeId: "second-action", type: "interactive", body: { ...interactionBody, actions: [{ ...interactionBody.actions[0], action_ts: "999.3" }] }, acknowledge });
    await vi.advanceTimersByTimeAsync(0);
    expect(acknowledge).toHaveBeenCalledTimes(1);
    expect(needsYou.interact).toHaveBeenCalledTimes(1);
    finish!(); await Promise.all([first, second]);
  });
  it("paces automatic posts, replies and edits through one shared sender", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-18T12:00:00Z"));
    const { runtime, clients, dependencies } = setup();
    let nextSendAt = 0;
    vi.mocked(dependencies.reserveSend).mockImplementation(async () => {
      const sendAt = Math.max(Date.now(), nextSendAt);
      nextSendAt = sendAt + 1100;
      return sendAt - Date.now();
    });
    vi.mocked(dependencies.wait).mockImplementation((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    await runtime.refresh();
    const sender = vi.mocked(dependencies.createNeedsYou).mock.calls[0][2];
    const posted: number[] = [];
    vi.mocked(clients[0].postMessage).mockImplementation(async () => { posted.push(Date.now()); return { channel: "CCHANNEL", ts: "100.1" }; });
    const first = sender.post({ channel: "CCHANNEL", text: "Needs you" });
    const second = clients[0].emit({});
    const edit = sender.update({ channel: "CCHANNEL", text: "Resolved", ts: "100.1" });
    await vi.advanceTimersByTimeAsync(0);
    expect(clients[0].postMessage).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1099);
    expect(clients[0].postMessage).toHaveBeenCalledTimes(1);
    expect(clients[0].updateMessage).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1101);
    await Promise.all([first, second, edit]);
    expect(clients[0].postMessage).toHaveBeenCalledTimes(2);
    expect(clients[0].updateMessage).toHaveBeenCalledTimes(1);
    expect(posted[1] - posted[0]).toBeGreaterThanOrEqual(1100);
  });
  it("rechecks the active profile after pacing before posting an automatic notification", async () => {
    const { runtime, clients, dependencies } = setup();
    let currentProfile = "work";
    vi.mocked(dependencies.reserveSend).mockResolvedValue(1100);
    vi.mocked(dependencies.wait).mockImplementation(async () => { currentProfile = "personal"; });
    await runtime.refresh();
    const sender = vi.mocked(dependencies.createNeedsYou).mock.calls[0][2];
    await expect(sender.post({ channel: "CCHANNEL", text: "Work needs you" }, () => currentProfile === "work")).rejects.toThrow("Slack delivery stopped");
    expect(clients[0].postMessage).not.toHaveBeenCalled();
  });
  it("recovers the status after a transient Needs you read failure", async () => {
    vi.useFakeTimers();
    const { runtime, needsYou } = setup();
    needsYou.tick.mockRejectedValueOnce(new Error("Task sources are unavailable"));
    await runtime.refresh();
    await vi.advanceTimersByTimeAsync(0);
    expect(runtime.status().connection.state).toBe("error");
    await vi.advanceTimersByTimeAsync(NEEDS_YOU_TICK_MS);
    expect(needsYou.tick).toHaveBeenCalledTimes(2);
    expect(runtime.status().connection.state).toBe("connected");
  });
  it("hands messages the rules could not answer to the tool router, in the message thread", async () => {
    const { runtime, clients, tools } = setup();
    await runtime.refresh();
    await clients[0].emit({ body: { ...body, event: { ...body.event, text: "what did I do last week" } } });
    expect(tools.handle).toHaveBeenCalledWith("what did I do last week", { profile: "work", channel: "CCHANNEL", threadTs: "123.456", teamId: "TTEAM", userId: "UOWNER", background: expect.any(Function) });
    expect(clients[0].postMessage).toHaveBeenCalledWith(expect.objectContaining({ text: "from tools", thread_ts: "123.456" }));
    expect(tools.recordRule).not.toHaveBeenCalled();
  });
  it("sends help to the live catalog handler without counting the rule twice", async () => {
    const { runtime, clients, tools } = setup();
    await runtime.refresh();
    await clients[0].emit({});
    expect(tools.handle).toHaveBeenCalledWith("help", expect.objectContaining({ profile: "work", threadTs: "123.456" }));
    expect(tools.recordRule).not.toHaveBeenCalled();
  });
  it("sends tool button clicks to the tool router, settles the card and posts the result", async () => {
    const { runtime, clients, tools, needsYou } = setup();
    await runtime.refresh();
    const click = { ...interactionBody, actions: [{ type: "button", action_id: "devhub_tool_confirm", value: "a".repeat(32), action_ts: "999.3" }] };
    await clients[0].emit({ type: "interactive", body: click });
    expect(tools.interact).toHaveBeenCalledTimes(1);
    expect(needsYou.interact).not.toHaveBeenCalled();
    expect(clients[0].updateMessage).toHaveBeenCalledWith(expect.objectContaining({ ts: "999.1", text: "Confirmed" }));
    expect(clients[0].postMessage).toHaveBeenCalledWith(expect.objectContaining({ text: "tool result" }));
  });
  it("ignores tool clicks from anyone but the allowed user", async () => {
    const { runtime, clients, tools } = setup();
    await runtime.refresh();
    await clients[0].emit({ type: "interactive", body: { ...interactionBody, user: { id: "UOTHER" }, actions: [{ type: "button", action_id: "devhub_tool_confirm", value: "a".repeat(32), action_ts: "999.3" }] } });
    expect(tools.interact).not.toHaveBeenCalled();
  });
});

describe("startup that fails before the socket opens", () => {
  const offline = () => Object.assign(new Error("getaddrinfo ENOTFOUND slack.com"), { code: "slack_webapi_request_error" });
  /** The first `failures` authenticate calls on the first client fail. */
  function failAuthentication(dependencies: SlackDependencies, failures: Array<unknown>) {
    const base = vi.mocked(dependencies.createClient).getMockImplementation()!;
    vi.mocked(dependencies.createClient).mockImplementationOnce((settings) => {
      const client = base(settings);
      for (const failure of failures) vi.mocked(client.authenticate).mockRejectedValueOnce(failure);
      return client;
    });
  }

  it("backs off 5s, 10s, … and connects as soon as authentication works, without creating another client", async () => {
    const { runtime, dependencies, clients } = setup();
    const waits: number[] = [];
    const states: string[] = [];
    dependencies.sleep = async (milliseconds) => { waits.push(milliseconds); states.push(`${runtime.status().connection.state}: ${runtime.status().connection.message}`); };
    failAuthentication(dependencies, [offline(), offline(), offline()]);
    await runtime.refresh();
    expect(waits).toEqual([5000, 10000, 20000]);
    expect(states[0]).toBe("reconnecting: Couldn't reach Slack. Retrying in 5s.");
    expect(states[2]).toContain("Retrying in 20s");
    expect(clients).toHaveLength(1);
    expect(clients[0].authenticate).toHaveBeenCalledTimes(4);
    expect(clients[0].start).toHaveBeenCalledTimes(1);
    expect(runtime.status().connection).toMatchObject({ state: "connected", message: "Connected as @DevHub in CCHANNEL" });
  });
  it("retries when the socket itself won't start, and doesn't build the Needs you handler twice", async () => {
    const { runtime, dependencies, clients } = setup();
    dependencies.sleep = async () => {};
    const base = vi.mocked(dependencies.createClient).getMockImplementation()!;
    vi.mocked(dependencies.createClient).mockImplementationOnce((settings) => {
      const client = base(settings);
      vi.mocked(client.start).mockRejectedValueOnce(offline());
      return client;
    });
    await runtime.refresh();
    expect(clients[0].start).toHaveBeenCalledTimes(2);
    expect(dependencies.createNeedsYou).toHaveBeenCalledTimes(1);
    expect(runtime.status().connection.state).toBe("connected");
  });
  it("caps the wait at five minutes", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 20].map(startRetryDelay)).toEqual([5000, 10000, 20000, 40000, 80000, 160000, 300000, 300000, 300000]);
    expect(START_RETRY_MAX_MS).toBe(300000);
  });
  it("doesn't keep retrying a rejected token; Setup has to change first", async () => {
    const { runtime, dependencies, clients } = setup();
    const sleep = vi.fn(async () => {});
    dependencies.sleep = sleep;
    failAuthentication(dependencies, [{ data: { error: "invalid_auth" } }]);
    await runtime.refresh();
    expect(sleep).not.toHaveBeenCalled();
    expect(clients[0].authenticate).toHaveBeenCalledTimes(1);
    expect(runtime.status().connection).toMatchObject({ state: "error", message: expect.stringContaining("rejected the token") });
  });
  it("stops retrying the moment settings change, and the new connection starts fresh", async () => {
    const { runtime, dependencies, clients } = setup();
    dependencies.sleep = (_milliseconds, signal) => new Promise<void>((resolve) => { signal.addEventListener("abort", () => resolve(), { once: true }); });
    failAuthentication(dependencies, [offline(), offline(), offline()]);
    const first = runtime.refresh();
    await vi.waitFor(() => expect(runtime.status().connection.state).toBe("reconnecting"));
    expect(clients[0].authenticate).toHaveBeenCalledTimes(1);
    vi.mocked(dependencies.readSettings).mockReturnValue({ ...settings, channelId: "CNEW" });
    const second = runtime.refresh();
    await Promise.all([first, second]);
    expect(clients[0].authenticate).toHaveBeenCalledTimes(1);
    expect(runtime.status().connection.state).toBe("connected");
    expect(runtime.status().connection.message).toContain("CNEW");
  });
  it("stops retrying on shutdown", async () => {
    const { runtime, dependencies, clients } = setup();
    dependencies.sleep = (_milliseconds, signal) => new Promise<void>((resolve) => { signal.addEventListener("abort", () => resolve(), { once: true }); });
    failAuthentication(dependencies, Array.from({ length: 20 }, offline));
    void runtime.refresh();
    await vi.waitFor(() => expect(runtime.status().connection.state).toBe("reconnecting"));
    await runtime.stop();
    expect(clients[0].authenticate).toHaveBeenCalledTimes(1);
  });
});

describe("one Socket Mode connection per machine", () => {
  const held = (pid: number): SlackLockResult => ({ ok: false, holderPid: pid });
  function lockable(results: SlackLockResult[]) {
    const release = vi.fn();
    const acquire = vi.fn((): SlackLockResult => {
      const next = results.shift() ?? held(0);
      return next.ok ? { ok: true, lock: { held: () => true, heartbeat: () => true, release } } : next;
    });
    return { acquire, release };
  }

  it("doesn't connect while another DevHub process holds the lock, and says so", async () => {
    const { runtime, dependencies } = setup();
    const { acquire } = lockable([held(4242)]);
    dependencies.acquireLock = acquire;
    await runtime.refresh();
    expect(dependencies.createClient).not.toHaveBeenCalled();
    expect(runtime.status().connection).toMatchObject({ state: "disabled", message: expect.stringContaining("Connected in another DevHub process (pid 4242)") });
  });
  it("connects once the holder is gone, checking back every 30s", async () => {
    vi.useFakeTimers();
    const { runtime, dependencies, clients } = setup();
    const { acquire } = lockable([held(4242), held(4242), { ok: true, lock: undefined as never }]);
    dependencies.acquireLock = acquire;
    await runtime.refresh();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(dependencies.createClient).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(clients).toHaveLength(1);
    expect(runtime.status().connection.state).toBe("connected");
    expect(acquire).toHaveBeenCalledTimes(3);
  });
  it("keeps its lock across a settings change and gives it up on shutdown", async () => {
    const { runtime, dependencies } = setup();
    const { acquire, release } = lockable([{ ok: true, lock: undefined as never }]);
    dependencies.acquireLock = acquire;
    await runtime.refresh();
    await runtime.refresh();
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();
    await runtime.stop();
    expect(release).toHaveBeenCalledTimes(1);
  });
  it("gives the lock up when this dashboard stops being the primary", async () => {
    const { runtime, dependencies } = setup();
    const { acquire, release } = lockable([{ ok: true, lock: undefined as never }]);
    dependencies.acquireLock = acquire;
    await runtime.refresh();
    vi.mocked(dependencies.primary).mockReturnValue(false);
    await runtime.refresh();
    expect(release).toHaveBeenCalledTimes(1);
  });
  it("stands down when the lock is taken from it (a long sleep), instead of running two connections", async () => {
    vi.useFakeTimers();
    const { runtime, dependencies, clients } = setup();
    let stillHeld = true;
    const release = vi.fn();
    dependencies.acquireLock = vi.fn((): SlackLockResult => stillHeld
      ? { ok: true, lock: { held: () => stillHeld, heartbeat: () => stillHeld, release } }
      : held(777));
    await runtime.refresh();
    expect(clients).toHaveLength(1);
    stillHeld = false;
    await vi.advanceTimersByTimeAsync(15_000);
    expect(runtime.status().connection.message).toContain("Connected in another DevHub process (pid 777)");
    expect(clients[0].stop).toHaveBeenCalled();
  });
  it("is off by default in tests: no lock dependency means no lock file", async () => {
    const { runtime, dependencies } = setup();
    expect(dependencies.acquireLock).toBeUndefined();
    await runtime.refresh();
    expect(runtime.status().connection.state).toBe("connected");
  });
});

const reactionBody = { team_id: "TTEAM", event_id: "EvR1", event: { type: "reaction_added", user: "UOWNER", reaction: "white_check_mark", item: { type: "message", channel: "CCHANNEL", ts: "50.1" }, item_user: "UBOT" } };

describe("✅ reaction check-off", () => {
  it("keeps the tool handler bound when calling its check-off method", async () => {
    const { runtime, clients, tools } = setup();
    tools.checkOff = vi.fn(async function (this: typeof tools) {
      expect(this).toBe(tools);
      return [];
    });
    await runtime.refresh();
    await clients[0].emit({ body: reactionBody });
    expect(tools.checkOff).toHaveBeenCalledOnce();
  });
  it("checks off the task a bot message is about, replying in that message's thread, and remembers the reply's task", async () => {
    const { runtime, clients, tools, taskDirectory } = setup();
    await runtime.refresh();
    await clients[0].emit({ body: reactionBody });
    expect(tools.checkOff).toHaveBeenCalledExactlyOnceWith({ profile: "work", taskId: "task-1", threadTs: "40.1", channel: "CCHANNEL", teamId: "TTEAM", userId: "UOWNER" });
    expect(clients[0].postMessage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ channel: "CCHANNEL", thread_ts: "40.1", text: "Checked off · A task" }));
    expect(taskDirectory.remember).toHaveBeenCalledExactlyOnceWith({ teamId: "TTEAM", userId: "UOWNER", channel: "CCHANNEL" }, { channel: "CCHANNEL", ts: "123.456" }, expect.objectContaining({ taskRef: expect.objectContaining({ taskId: "task-1" }) }));
  });
  it("does the check-off once per event, even when Slack retries it", async () => {
    const { runtime, clients, tools } = setup();
    await runtime.refresh();
    await clients[0].emit({ body: reactionBody });
    await clients[0].emit({ body: reactionBody });
    await clients[0].emit({ envelopeId: "retry", body: reactionBody });
    expect(tools.checkOff).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["someone else", { user: "UOTHER" }], ["another channel", { item: { type: "message", channel: "COTHER", ts: "50.1" } }], ["a different emoji", { reaction: "thumbsup" }],
    ["a message from someone other than the bot", { item_user: "UOTHER" }], ["a removal", { type: "reaction_removed" }], ["the bot itself", { user: "UBOT" }],
  ])("ignores a reaction from %s", async (_label, patch) => {
    const { runtime, clients, tools } = setup();
    await runtime.refresh();
    await clients[0].emit({ body: { ...reactionBody, event: { ...reactionBody.event, ...patch } } });
    expect(tools.checkOff).not.toHaveBeenCalled();
    expect(clients[0].postMessage).not.toHaveBeenCalled();
  });
  it("ignores a ✅ on a message that isn't about a task, a reaction from another workspace, and a non-primary process", async () => {
    const { runtime, clients, tools, dependencies } = setup();
    await runtime.refresh();
    await clients[0].emit({ body: { ...reactionBody, event_id: "EvR2", event: { ...reactionBody.event, item: { ...reactionBody.event.item, ts: "77.7" } } } });
    await clients[0].emit({ body: { ...reactionBody, event_id: "EvR3", team_id: "TOTHER" } });
    vi.mocked(dependencies.primary).mockReturnValue(false);
    await clients[0].emit({ body: { ...reactionBody, event_id: "EvR4" } });
    expect(tools.checkOff).not.toHaveBeenCalled();
  });
});

describe("App Home tab", () => {
  const opened = (user: string, extra: Record<string, unknown> = {}) => ({ team_id: "TTEAM", event_id: `EvH-${user}-${Math.random()}`, event: { type: "app_home_opened", user, tab: "home", ...extra } });
  const homeClick = (action: string, value?: string) => ({
    type: "block_actions", team: { id: "TTEAM" }, user: { id: "UOWNER" }, container: { type: "view", view_id: "V1" }, view: { type: "home" },
    actions: [{ type: "button", action_id: action, value, action_ts: `9.${Math.floor(Math.random() * 1e6)}` }],
  });

  it("publishes the live dashboard when the configured user opens Home", async () => {
    const { runtime, clients, dependencies } = setup();
    await runtime.refresh();
    await clients[0].emit({ body: opened("UOWNER") });
    expect(dependencies.buildHome).toHaveBeenCalledExactlyOnceWith({ teamId: "TTEAM", userId: "UOWNER", channel: "CCHANNEL" }, "work");
    expect(clients[0].publishHome).toHaveBeenCalledExactlyOnceWith("UOWNER", expect.objectContaining({ type: "home" }));
  });
  it("does not publish a view if scheduler ownership is lost while building it", async () => {
    const { runtime, clients, dependencies } = setup();
    vi.mocked(dependencies.buildHome!).mockImplementationOnce(async () => {
      vi.mocked(dependencies.primary).mockReturnValue(false);
      return { type: "home", blocks: [] };
    });
    await runtime.refresh();
    await clients[0].emit({ body: opened("UOWNER") });
    expect(clients[0].publishHome).not.toHaveBeenCalled();
  });
  it("shows anyone else only the private view and never builds the dashboard", async () => {
    const { runtime, clients, dependencies } = setup();
    await runtime.refresh();
    await clients[0].emit({ body: opened("UOTHER") });
    expect(dependencies.buildHome).not.toHaveBeenCalled();
    const [user, view] = vi.mocked(clients[0].publishHome).mock.calls[0];
    expect(user).toBe("UOTHER");
    expect(JSON.stringify(view)).toContain("This DevHub is private");
    expect(JSON.stringify(view)).not.toContain("live dashboard");
  });
  it("ignores the Messages tab, another workspace and non-primary processes", async () => {
    const { runtime, clients, dependencies } = setup();
    await runtime.refresh();
    await clients[0].emit({ body: opened("UOWNER", { tab: "messages" }) });
    await clients[0].emit({ body: { ...opened("UOWNER"), team_id: "TOTHER" } });
    vi.mocked(dependencies.primary).mockReturnValue(false);
    await clients[0].emit({ body: opened("UOWNER") });
    expect(clients[0].publishHome).not.toHaveBeenCalled();
  });
  it("Refresh republishes without a channel or message, once per click", async () => {
    const { runtime, clients, dependencies } = setup();
    await runtime.refresh();
    const click = homeClick("devhub_home_refresh");
    await clients[0].emit({ type: "interactive", body: click });
    await clients[0].emit({ type: "interactive", body: click, envelopeId: "envelope-1" });
    expect(dependencies.buildHome).toHaveBeenCalledTimes(1);
    expect(clients[0].publishHome).toHaveBeenCalledTimes(1);
    expect(clients[0].postMessage).not.toHaveBeenCalled();
  });
  it("opens capabilities in Home without posting into the configured channel", async () => {
    const { runtime, clients, dependencies, tools } = setup();
    const overview = { type: "header" as const, text: { type: "plain_text" as const, text: "What DevHub can do" } };
    dependencies.tools.interact = vi.fn(async () => ({ post: [{ channel: "CCHANNEL", text: "Capabilities", blocks: [overview] }] }));
    await runtime.refresh();
    await clients[0].emit({ type: "interactive", envelopeId: "e-capabilities", body: homeClick("devhub_tool_capabilities_home") });
    expect(dependencies.tools.interact).toHaveBeenCalledWith(expect.objectContaining({ surface: "home", profile: "work", action: "devhub_tool_capabilities_home" }));
    expect(clients[0].publishHome).toHaveBeenCalledWith("UOWNER", { type: "home", blocks: expect.arrayContaining([overview, expect.objectContaining({ type: "actions", elements: [expect.objectContaining({ action_id: "devhub_home_refresh" })] })]) });
    expect(clients[0].postMessage).not.toHaveBeenCalled();
    expect(tools.handle).not.toHaveBeenCalled();
  });
  it("hands Plan and Implement clicks from Home to the Needs-you handler and ignores any other Home action", async () => {
    const { runtime, clients, needsYou } = setup();
    await runtime.refresh();
    await clients[0].emit({ type: "interactive", envelopeId: "e-plan", body: homeClick("devhub_need_plan", "a".repeat(64)) });
    expect(needsYou.interact).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ surface: "home", action: "devhub_need_plan", value: "a".repeat(64), channelId: "CCHANNEL" }));
    await clients[0].emit({ type: "interactive", envelopeId: "e-confirm", body: homeClick("devhub_tool_confirm", "abc") });
    await clients[0].emit({ type: "interactive", envelopeId: "e-answer", body: homeClick("devhub_answer", "abc") });
    expect(needsYou.interact).toHaveBeenCalledTimes(1);
  });
  it("republishes once, debounced, when Needs-you changes, but only after Home has been opened", async () => {
    vi.useFakeTimers();
    const { runtime, clients, dependencies } = setup();
    await runtime.refresh();
    const transport = vi.mocked(dependencies.createNeedsYou).mock.calls[0][2] as SlackNeedsTransport;
    transport.changed?.();
    await vi.advanceTimersByTimeAsync(HOME_DEBOUNCE_MS + 10);
    expect(clients[0].publishHome).not.toHaveBeenCalled();
    await clients[0].emit({ body: opened("UOWNER") });
    expect(clients[0].publishHome).toHaveBeenCalledTimes(1);
    transport.changed?.(); transport.changed?.(); transport.changed?.();
    await vi.advanceTimersByTimeAsync(HOME_DEBOUNCE_MS - 100);
    expect(clients[0].publishHome).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(clients[0].publishHome).toHaveBeenCalledTimes(2);
  });
  it("a failed publish is logged, not shown as a connection error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { runtime, clients } = setup();
    await runtime.refresh();
    vi.mocked(clients[0].publishHome).mockRejectedValueOnce(new Error("private-token"));
    await clients[0].emit({ body: opened("UOWNER") });
    expect(runtime.status().connection.state).toBe("connected");
    expect(warn).toHaveBeenCalledWith("[slack] Couldn't publish the Home tab.");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("private-token");
    warn.mockRestore();
  });
});
