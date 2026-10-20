import { answerSlackMessage, slackRouteContext, type SlackAnswer } from "./answers";
import { SlackNotSentError, slackConfigurationRejected, slackErrorMessage, type SlackClient, type SlackEnvelope, type SlackHomeView, type SlackIdentity, type SlackMessage, type SlackMessageUpdate, type SlackReceipt } from "./client";
import { createSlackTransport } from "./transport";
import { gatewayPairingStatus, gatewayStateRoot, readGatewayDevice } from "./gateway-state";
import { formatSlackAnswer } from "./format";
import { allowedGatewayEnvelope, allowedSlackInteraction, allowedSlackMessage, allowedSlackReaction, slackHomeOpened, slackIdentityAllowed, type SlackInteraction, type SlackReaction } from "./security";
import { maskSlackSettings, readSlackSettings, slackConfigured, slackSettingsRevision } from "./settings";
import { claimSlackEnvelope, knownSlackBotThread, rememberSlackBotThread, reserveSlackSend } from "./store";
import { normalizeSlackCommand } from "./slack-text";
import type { SlackRouteContext } from "./router";
import type { SlackConnectionState, SlackConnectionStatus, SlackSettings, SlackStatus } from "./shared";
import { NEEDS_YOU_TICK_MS, SlackNeedsYou, type SlackNeedsHandler, type SlackNeedsTransport } from "./needs-you";
import { acquireSlackLock, LOCK_HEARTBEAT_MS, type SlackLock, type SlackLockResult } from "./process-lock";
import type { SlackAudience } from "./thread-store";
import { createSlackToolHandler, type SlackToolHandler } from "./tool-handler";
import { createTaskDirectory, type SlackTaskDirectory } from "./reactions";
import { buildSlackHome } from "./home-source";
import { buildPrivateHomeView } from "./home-view";
import { TeamCollaboration, registerTeamCollaboration } from "@/lib/team/collaboration";
import { TeamStore } from "@/lib/team/store";
import { teamDependencies } from "@/lib/team/dependencies";
import { teamTaskActions } from "@/lib/team/cards";
import { ToolConfirmStore } from "./tool-confirm-store";
import type { GatewayClient } from "./gateway-client";
import { isTaskOwnershipBlocked } from "@shared/tasks/types.ts";

export interface SlackDependencies {
  team?: TeamCollaboration;
  createClient: (settings: SlackSettings) => SlackClient;
  readSettings: () => SlackSettings;
  primary: () => boolean;
  context: () => SlackRouteContext;
  answer: (text: string, context: SlackRouteContext) => SlackAnswer | Promise<SlackAnswer>;
  claim: (keys: readonly string[]) => Promise<boolean>;
  reserveSend: () => Promise<number>;
  wait: (milliseconds: number) => Promise<void>;
  createNeedsYou: (settings: SlackSettings, audience: SlackAudience, transport: SlackNeedsTransport) => SlackNeedsHandler;
  tools: SlackToolHandler;
  /** Waits, but wakes early when the signal aborts (shutdown or a settings change). */
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  /** Cross-process Socket Mode lock. Absent means no lock (tests). */
  acquireLock?: () => SlackLockResult;
  /** Which task a bot message is about, for ✅ reactions. Absent means reactions do nothing (tests). */
  taskDirectory?: () => SlackTaskDirectory;
  /** The Home tab for the configured user, built from the live board. Absent means the Home tab isn't published (tests). */
  buildHome?: (audience: SlackAudience, profile: string) => Promise<SlackHomeView>;
  knownBotThread?: (key: string) => boolean;
  rememberBotThread?: (key: string) => Promise<void>;
}

/** First retry after a failed start, doubling up to the cap. */
export const START_RETRY_MIN_MS = 5_000;
export const START_RETRY_MAX_MS = 5 * 60_000;
/** A burst of Needs-you changes republishes the Home tab once, this long after the first. */
export const HOME_DEBOUNCE_MS = 5_000;
/** How often a process that lost the lock checks whether the holder has gone. */
const LOCK_RETRY_MS = 30_000;

export function startRetryDelay(attempt: number): number {
  return Math.min(START_RETRY_MIN_MS * 2 ** attempt, START_RETRY_MAX_MS);
}

function cancellableSleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(); return; }
    const timer = setTimeout(done, milliseconds);
    timer.unref();
    signal.addEventListener("abort", done, { once: true });
    function done() { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); }
  });
}

function describeDelay(milliseconds: number): string {
  const seconds = Math.round(milliseconds / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.round(seconds / 60)} min`;
}

// Built on first use so importing the runtime never touches the state dir or spawns anything.
let sharedTools: SlackToolHandler | undefined;
let sharedDirectory: SlackTaskDirectory | undefined;
const lazyTools = (): SlackToolHandler => sharedTools ??= createSlackToolHandler();
const defaultTools: SlackToolHandler = {
  handle: (text, context) => lazyTools().handle(text, context),
  interact: (interaction) => lazyTools().interact(interaction),
  recordRule: (profile) => lazyTools().recordRule(profile),
  propose: (action, target) => lazyTools().propose?.(action, target) ?? Promise.resolve([]),
  checkOff: (target) => lazyTools().checkOff?.(target) ?? Promise.resolve([]),
  close: async () => { const active = sharedTools; sharedTools = undefined; await active?.close(); },
};

const defaults: SlackDependencies = {
  createClient: createSlackTransport,
  readSettings: readSlackSettings,
  primary: () => process.env.DEVHUB_SCHEDULER !== "0",
  context: slackRouteContext,
  answer: answerSlackMessage,
  claim: claimSlackEnvelope,
  reserveSend: reserveSlackSend,
  wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  createNeedsYou: (settings, audience, transport) => new SlackNeedsYou(settings, audience, transport, undefined, (action, target) => lazyTools().propose?.(action, target) ?? Promise.resolve([])),
  tools: defaultTools,
  sleep: cancellableSleep,
  acquireLock: () => acquireSlackLock(readSlackSettings().mode === "gateway" ? gatewayStateRoot() : undefined),
  taskDirectory: () => (sharedDirectory ??= createTaskDirectory()),
  buildHome: (audience, profile) => buildSlackHome(audience, profile),
  knownBotThread: knownSlackBotThread,
  rememberBotThread: rememberSlackBotThread,
};

class SlackConnection {
  private identity?: SlackIdentity;
  private inactive = false;
  private queue = Promise.resolve();
  private deliveries: Promise<unknown> = Promise.resolve();
  private readonly backgroundAnswers = new Set<Promise<void>>();
  private needsYou?: SlackNeedsHandler;
  private needsTimer?: ReturnType<typeof setTimeout>;
  private needsRunning?: Promise<void>;
  private connected = false;
  private stopping?: Promise<void>;
  private home: Promise<void> = Promise.resolve();
  private homeTimer?: ReturnType<typeof setTimeout>;
  /** The Home tab has been opened this session, so Needs-you changes keep it fresh. */
  private homeActive = false;
  private readonly botThreads = new Set<string>();
  private team?: TeamCollaboration;
  private unregisterTeam?: () => void;
  private teamTimer?: ReturnType<typeof setInterval>;
  private readonly cancel = new AbortController();
  readonly client: SlackClient;
  status: SlackConnectionStatus = { state: "connecting", message: "Connecting to Slack…" };

  constructor(readonly settings: SlackSettings, private readonly dependencies: SlackDependencies) {
    this.client = dependencies.createClient(settings);
    this.client.onState((state, error) => {
      if (this.inactive) return;
      if (state === "error") { this.setStatus(state, error); return; }
      this.connected = state === "connected";
      this.needsYou?.reset();
      this.setStatus(state, error);
      if (this.connected && !this.needsTimer && !this.needsRunning) this.scheduleNeedsYou(0);
      if (this.connected && this.team) void this.team.handoffs.reconcile().catch((error: unknown) => this.setStatus("error", error));
    });
    this.client.onEnvelope((envelope) => this.receive(envelope));
  }

  private setStatus(state: SlackConnectionState, error?: unknown): void {
    const identity = this.identity;
    const messages: Record<SlackConnectionState, string> = {
      "not-configured": this.settings.mode === "gateway" ? "Not linked. Connect to team Slack in Setup." : "Not connected. Add the tokens, channel ID and your member ID in Setup.",
      disabled: "Not connected on this dashboard. The primary DevHub process owns Slack.",
      connecting: "Connecting to Slack…",
      connected: this.settings.mode === "gateway" ? "Connected to Team Slack." : `Connected as @${identity?.name ?? "DevHub"} in ${this.settings.channelId}`,
      reconnecting: "Reconnecting to Slack…",
      disconnected: "Not connected. Check your connection, then save Slack settings to reconnect.",
      error: this.settings.mode === "gateway" ? "Could not connect to Team Slack. Check the gateway URL and your link in Setup." : slackErrorMessage(error),
    };
    this.status = { state, message: messages[state], ...(identity ? { botUserId: identity.userId, botName: identity.name, teamId: identity.teamId } : {}) };
  }

  /**
   * Authenticates and opens the socket. A failure that could clear up by itself (network down, Slack
   * briefly unavailable) is retried with a doubling wait, 5s up to 5 min, until it works or the
   * connection is deactivated. A rejected token is not retried: Setup has to change first.
   */
  async start(): Promise<void> {
    const sleep = this.dependencies.sleep ?? cancellableSleep;
    for (let attempt = 0; !this.inactive; attempt++) {
      try {
        await this.connect();
        return;
      } catch (error) {
        if (this.inactive) return;
        if (slackConfigurationRejected(error)) { this.setStatus("error", error); return; }
        const delay = startRetryDelay(attempt);
        this.status = { state: "reconnecting", message: `Couldn't reach Slack. Retrying in ${describeDelay(delay)}.` };
        await sleep(delay, this.cancel.signal);
      }
    }
  }

  private async connect(): Promise<void> {
    this.identity = await this.client.authenticate();
    if (this.inactive) return;
    if (!slackIdentityAllowed(this.settings, this.identity)) {
      this.status = { state: "error", message: "Check the workspace ID and use your own member ID, not the bot's ID." };
      return;
    }
    this.needsYou ??= this.dependencies.createNeedsYou(this.settings, { teamId: this.identity.teamId, userId: this.settings.allowedUserId, channel: this.settings.channelId, ...(this.settings.mode === "gateway" ? { deviceId: this.settings.deviceId } : {}) }, {
      active: () => this.canSend(),
      post: (message, guard) => this.post(message, guard),
      update: (message) => this.update(message),
      ...(this.client.openModal ? { openModal: this.client.openModal.bind(this.client) } : {}),
      changed: () => this.scheduleHome(),
    });
    if (this.settings.mode === "gateway" && (this.dependencies.team || "listMembers" in this.client)) {
      this.team ??= this.dependencies.team ?? new TeamCollaboration({ client: this.client as GatewayClient, channel: this.settings.channelId, ownerName: readGatewayDevice()?.binding?.userName ?? this.settings.allowedUserId,
        audience: () => ({ teamId: this.identity!.teamId, userId: this.settings.allowedUserId, deviceId: this.settings.deviceId!, profile: this.dependencies.context().activeProfile }),
        store: new TeamStore(), confirms: new ToolConfirmStore(undefined, Date.now, () => this.settings.deviceId), deps: teamDependencies,
        post: (message) => this.post(message), update: (message) => this.update(message), active: () => this.canSend(),
      });
      this.unregisterTeam = registerTeamCollaboration(this.team);
      this.teamTimer ??= setInterval(() => {
        if (this.canSend()) void this.team?.handoffs.reconcile().catch((error: unknown) => this.setStatus("error", error));
      }, 60_000);
      this.teamTimer.unref();
    }
    await this.client.start();
    if (this.inactive) await this.client.stop();
  }

  deactivate(): void { this.inactive = true; clearTimeout(this.needsTimer); clearTimeout(this.homeTimer); this.cancel.abort(); if (this.settings.mode === "gateway") void this.client.stop(); }
  stop(): Promise<void> {
    return this.stopping ??= this.shutdown();
  }

  private async shutdown(): Promise<void> {
    this.deactivate();
    clearInterval(this.teamTimer);
    this.unregisterTeam?.();
    try {
      await this.needsRunning;
      await this.queue;
      await this.home;
      await Promise.allSettled(this.backgroundAnswers);
      await this.needsYou?.stop();
      await this.deliveries;
    } finally {
      try { await this.dependencies.tools.close(); }
      finally { await this.client.stop(); }
    }
  }

  private canSend(): boolean { return !this.inactive && this.connected && this.dependencies.primary(); }

  /** Something changed in DevHub (an answer, say): look at the Needs-you cards soon instead of waiting out the tick. */
  pokeNeedsYou(): void {
    if (this.inactive || !this.needsYou || this.needsRunning) return;
    if (this.needsTimer) clearTimeout(this.needsTimer);
    this.scheduleNeedsYou(1_500);
  }

  private scheduleNeedsYou(delay = NEEDS_YOU_TICK_MS): void {
    if (this.inactive || !this.needsYou) return;
    this.needsTimer = setTimeout(() => {
      this.needsTimer = undefined;
      this.needsRunning = this.needsYou!.tick().then(() => { if (this.canSend()) this.setStatus("connected"); }).catch((error: unknown) => { if (!this.inactive) this.setStatus("error", error); }).finally(() => {
        this.needsRunning = undefined;
        this.scheduleNeedsYou();
      });
    }, delay);
    this.needsTimer.unref();
  }

  private deliver<Result>(send: () => Promise<Result>, guard?: () => boolean): Promise<Result> {
    // Everything before send() happens before any request leaves, so a failure here is "not sent".
    const operation = this.deliveries.then(async () => {
      if (!this.canSend() || guard?.() === false) throw new SlackNotSentError("Slack delivery stopped");
      try {
        const delay = await this.dependencies.reserveSend();
        if (delay > 0) await this.dependencies.wait(delay);
      } catch { throw new SlackNotSentError("Slack delivery could not be paced"); }
      if (!this.canSend() || guard?.() === false) throw new SlackNotSentError("Slack delivery stopped");
      return send();
    });
    this.deliveries = operation.then(() => undefined, () => undefined);
    return operation;
  }
  private async post(message: SlackMessage, guard?: () => boolean): Promise<SlackReceipt> {
    if (this.team && message.taskRef) {
      if (isTaskOwnershipBlocked(this.team.env.deps.getTask(message.taskRef.taskId, message.taskRef.profile))) throw new SlackNotSentError("This task's ownership is pending or handed off.");
      if (!message.blocks?.some((block) => block.type === "actions" && block.block_id?.startsWith("team_task_"))) message = { ...message, blocks: [...(message.blocks ?? []), ...teamTaskActions(message.taskRef.taskId)] };
    }
    const taskRef = message.taskRef;
    const receipt = await this.deliver(() => this.client.postMessage(message), taskRef && this.team ? () => !isTaskOwnershipBlocked(this.team!.env.deps.getTask(taskRef.taskId, taskRef.profile)) && guard?.() !== false : guard);
    if (this.settings.mode === "gateway") {
      const key = this.threadKey(receipt.channel, message.thread_ts ?? receipt.ts);
      this.botThreads.add(key);
      if (this.botThreads.size > 4000) this.botThreads.delete(this.botThreads.values().next().value!);
      await this.dependencies.rememberBotThread?.(key);
    }
    // A message about a task is remembered by its timestamp, so a ✅ on it can check the task off.
    if (message.taskRef && this.identity) {
      await this.dependencies.taskDirectory?.().remember({ teamId: this.identity.teamId, userId: this.settings.allowedUserId, channel: this.settings.mode === "gateway" ? message.channel : this.settings.channelId, ...(this.settings.mode === "gateway" ? { deviceId: this.settings.deviceId } : {}) }, receipt, message);
    }
    return receipt;
  }

  private threadKey(channel: string, ts: string): string {
    return JSON.stringify([this.settings.deviceId, this.identity?.teamId, this.settings.allowedUserId, channel, ts]);
  }

  sendTest(message: SlackMessage): Promise<SlackReceipt> { return this.post(message); }

  private audience(): SlackAudience | undefined {
    return this.identity ? { teamId: this.identity.teamId, userId: this.settings.allowedUserId, channel: this.settings.channelId } : undefined;
  }

  /** Publishes the Home tab: the live dashboard for the configured user, a "private" view for anyone else. */
  private publishHome(userId: string, allowed: boolean): Promise<void> {
    const work = async () => {
      const audience = this.audience();
      if (this.inactive || !this.connected || !audience || !this.dependencies.primary()) return;
      try {
        const view = allowed
          ? await this.dependencies.buildHome?.(audience, this.dependencies.context().activeProfile)
          : buildPrivateHomeView();
        if (!view || !this.canSend()) return;
        await this.client.publishHome(userId, view);
      } catch { console.warn("[slack] Couldn't publish the Home tab."); }
    };
    this.home = this.home.then(work, work);
    return this.home;
  }

  private scheduleHome(): void {
    if (!this.homeActive || this.inactive || this.homeTimer) return;
    this.homeTimer = setTimeout(() => {
      this.homeTimer = undefined;
      void this.publishHome(this.settings.allowedUserId, true);
    }, HOME_DEBOUNCE_MS);
    this.homeTimer.unref();
  }

  private async reactionAdded(reaction: SlackReaction): Promise<void> {
    const audience = this.audience();
    if (audience && this.settings.mode === "gateway") audience.channel = reaction.channelId;
    const target = audience && this.dependencies.taskDirectory?.().resolve(audience, reaction.channelId, reaction.ts);
    if (!audience || !target || !this.dependencies.tools.checkOff) return;
    this.queue = this.queue.then(async () => {
      if (this.inactive) return;
      const replies = await this.dependencies.tools.checkOff!({ ...target, channel: audience.channel, teamId: audience.teamId, userId: audience.userId });
      for (const reply of replies) { if (this.inactive) return; await this.post(reply); }
    }).catch((error: unknown) => { if (!this.inactive) this.setStatus("error", error); });
    await this.queue;
  }
  private update(message: SlackMessageUpdate): Promise<void> {
    return this.deliver(() => this.client.updateMessage(message));
  }

  private async toolInteraction(interaction: SlackInteraction): Promise<void> {
    const reply = await this.dependencies.tools.interact(interaction);
    if (interaction.surface === "home" && interaction.action.startsWith("devhub_tool_capabilities_")) {
      const blocks = reply.post[0]?.blocks;
      if (blocks) await this.deliver(() => this.client.publishHome(interaction.userId, { type: "home", blocks: [...blocks, { type: "actions", elements: [{ type: "button", action_id: "devhub_home_refresh", text: { type: "plain_text", text: "Back to Home" } }] }] }));
      return;
    }
    if (reply.update) await this.update({ ...reply.update, ts: interaction.ts });
    for (const message of reply.post) { if (this.inactive) return; await this.post(message); }
  }

  private async backgroundAnswer(ack: SlackMessage, work: (signal: AbortSignal) => Promise<SlackMessage[]>): Promise<void> {
    if (this.backgroundAnswers.size >= 4) throw new Error("Too many background answers");
    await this.post(ack);
    const pending = Promise.resolve().then(async () => {
      const replies = await work(this.cancel.signal);
      for (const reply of replies) { if (!this.canSend()) return; await this.post(reply); }
    }).catch((error: unknown) => {
      if (!this.inactive) this.setStatus("error", error);
    }).finally(() => this.backgroundAnswers.delete(pending));
    this.backgroundAnswers.add(pending);
  }

  private async receive(envelope: SlackEnvelope): Promise<void> {
    try {
      await envelope.acknowledge();
      if (!this.canSend() || !this.identity || !envelope.envelopeId) return;
      if (!allowedGatewayEnvelope(envelope, this.settings)) return;
      if (this.team && envelope.gateway && ["helper_reply", "handoff_result"].includes(envelope.gateway.envelope.kind)) {
        if (await this.dependencies.claim(["envelope:" + envelope.envelopeId])) await this.team.event(envelope.gateway.envelope);
        return;
      }
      if (this.team && envelope.gateway?.envelope.handoff) {
        if (await this.dependencies.claim(["envelope:" + envelope.envelopeId])) await this.team.event(envelope.gateway.envelope);
        return;
      }
      const settings = envelope.gateway?.envelope.channelId ? { ...this.settings, channelId: envelope.gateway.envelope.channelId } : this.settings;
      if (envelope.type === "interactive") {
        const interaction: SlackInteraction | null = allowedSlackInteraction(envelope.body, settings, this.identity);
        if (!interaction || interaction.action === "devhub_open") return;
        if (envelope.gateway) interaction.deviceId = envelope.gateway.deviceId;
        const keys = [`envelope:${envelope.envelopeId}`, `interaction:${interaction.teamId}:${interaction.channelId}:${interaction.ts}:${interaction.userId}:${interaction.action}:${interaction.actionTs}`];
        if (!await this.dependencies.claim(keys) || this.inactive) return;
        if (interaction.surface === "home") {
          interaction.profile = this.dependencies.context().activeProfile;
          if (interaction.action === "devhub_home_refresh") { this.homeActive = true; await this.publishHome(interaction.userId, true); return; }
          if (!interaction.action.startsWith("devhub_tool_capabilities_") && interaction.action !== "devhub_need_plan" && interaction.action !== "devhub_need_implement" && interaction.action !== "devhub_retry") return;
        }
        this.queue = this.queue.then(async () => {
          if (this.inactive) return;
          if (this.team && await this.team.interact(interaction)) return;
          if (interaction.action.startsWith("devhub_tool_")) await this.toolInteraction(interaction);
          else await this.needsYou?.interact(interaction);
        }).catch((error: unknown) => { if (!this.inactive) this.setStatus("error", error); });
        await this.queue;
        return;
      }
      if (envelope.type !== "events_api") return;
      const reaction = allowedSlackReaction(envelope.body, settings, this.identity);
      if (reaction) {
        if (!await this.dependencies.claim([`envelope:${envelope.envelopeId}`, `event:${reaction.teamId}:${reaction.eventId}`]) || this.inactive) return;
        await this.reactionAdded(reaction);
        return;
      }
      const opened = slackHomeOpened(envelope.body, settings, this.identity);
      if (opened) {
        if (!await this.dependencies.claim([`envelope:${envelope.envelopeId}`, `event:${opened.teamId}:${opened.eventId}`]) || this.inactive) return;
        if (opened.allowed) this.homeActive = true;
        await this.publishHome(opened.userId, opened.allowed);
        return;
      }
      const message = allowedSlackMessage(envelope.body, settings, this.identity);
      if (!message) return;
      if (this.team?.asks.ignores(message.channelId, message.threadTs)) return;
      if (this.settings.mode === "gateway" && !message.channelId.startsWith("D") && !message.text.includes(`<@${this.identity.userId}>`)) {
        const key = message.threadTs && this.threadKey(message.channelId, message.threadTs);
        if (!key || (!this.botThreads.has(key) && !this.dependencies.knownBotThread?.(key))) return;
      }
      message.text = normalizeSlackCommand(message.text, this.identity.userId);
      const keys = [`envelope:${envelope.envelopeId}`, `event:${message.teamId}:${message.eventId}`, `message:${message.teamId}:${message.channelId}:${message.ts}`];
      if (!await this.dependencies.claim(keys) || this.inactive) return;
      const context = this.dependencies.context();
      const reply = async () => {
        if (this.inactive) return;
        const result = await this.needsYou?.reply(message);
        if (result?.handled || this.inactive) return;
        const scoped = result?.profile ? { ...context, activeProfile: result.profile } : context;
        const answer = await this.dependencies.answer(message.text, scoped);
        if (this.inactive) return;
        const threadTs = message.threadTs ?? message.ts;
        if (answer.fallthrough || answer.kind === "help") {
          const replies = await this.dependencies.tools.handle(message.text, { profile: answer.profile, channel: message.channelId, threadTs, teamId: message.teamId, userId: message.userId, background: (ack, work) => this.backgroundAnswer(ack, work) });
          for (const reply of replies) { if (this.inactive) return; await this.post(reply); }
        } else {
          await this.post({ ...formatSlackAnswer(answer, message.channelId), thread_ts: threadTs });
          this.dependencies.tools.recordRule(answer.profile);
        }
        this.setStatus("connected");
      };
      this.queue = this.queue.then(reply).catch((error: unknown) => { if (!this.inactive) this.setStatus("error", error); });
      await this.queue;
    } catch (error) { if (!this.inactive) this.setStatus("error", error); }
  }
}

export class SlackRuntime {
  private connection?: SlackConnection;
  private revision = "";
  private pending = Promise.resolve();
  private generation = 0;
  private failure?: string;
  private started = false;
  private lock?: SlackLock;
  private holderPid?: number;
  private lockTimer?: ReturnType<typeof setTimeout>;
  private heartbeatTimer?: ReturnType<typeof setInterval>;

  constructor(private readonly dependencies: SlackDependencies = defaults) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    void this.refresh();
  }

  refresh(): Promise<void> {
    const generation = ++this.generation;
    this.connection?.deactivate();
    this.pending = this.pending.then(async () => {
      if (generation !== this.generation) return;
      const previous = this.connection;
      this.connection = undefined;
      await previous?.stop();
      if (generation !== this.generation) return;
      this.failure = undefined;
      clearTimeout(this.lockTimer);
      const settings = this.dependencies.readSettings();
      this.revision = slackSettingsRevision(settings);
      if (!this.dependencies.primary() || !slackConfigured(settings)) { this.releaseLock(); return; }
      if (!this.takeLock()) return;
      this.connection = new SlackConnection(settings, this.dependencies);
      await this.connection.start();
    }).catch((error: unknown) => { this.failure = slackErrorMessage(error); });
    return this.pending;
  }

  status(): SlackStatus {
    const settings = this.dependencies.readSettings();
    const configured = slackConfigured(settings);
    const revision = slackSettingsRevision(settings);
    const connection: SlackConnectionStatus = !this.dependencies.primary()
      ? { state: "disabled", message: "Not connected on this dashboard. The primary DevHub process owns Slack." }
      : !configured ? { state: "not-configured", message: settings.mode === "gateway" ? "Not linked. Connect to team Slack in Setup." : "Not connected. Add the tokens, channel ID and your member ID in Setup." }
      : this.holderPid !== undefined ? { state: "disabled", message: `Connected in another DevHub process${this.holderPid ? ` (pid ${this.holderPid})` : ""}. This one stays quiet so Slack events and cards aren't doubled.` }
      : this.failure ? { state: "error", message: this.failure }
      : this.connection && revision === this.revision ? { ...this.connection.status }
      : { state: "connecting", message: "Connecting to Slack…" };
    return { configured, settings: maskSlackSettings(settings), revision, connection, profile: this.dependencies.context().activeProfile,
      ...(settings.mode === "gateway" ? { gateway: gatewayPairingStatus() } : {}) };
  }

  /** Only the process holding the lock opens Socket Mode. Anyone else checks back until the holder is gone. */
  private takeLock(): boolean {
    const acquire = this.dependencies.acquireLock;
    if (!acquire) return true;
    if (this.lock?.held()) { this.holderPid = undefined; return true; }
    this.lock = undefined;
    const result = acquire();
    if (result.ok) {
      this.lock = result.lock;
      this.holderPid = undefined;
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = setInterval(() => {
        try { if (!this.lock?.heartbeat()) void this.refresh(); }
        catch (error) {
          this.failure = slackErrorMessage(error);
          void this.stop().catch(() => { console.warn("[slack] Could not release the failed process lock."); });
        }
      }, LOCK_HEARTBEAT_MS);
      this.heartbeatTimer.unref();
      return true;
    }
    this.holderPid = result.holderPid;
    clearInterval(this.heartbeatTimer);
    this.lockTimer = setTimeout(() => { void this.refresh(); }, LOCK_RETRY_MS);
    this.lockTimer.unref();
    return false;
  }

  private releaseLock(): void {
    clearTimeout(this.lockTimer);
    clearInterval(this.heartbeatTimer);
    this.holderPid = undefined;
    this.lock?.release();
    this.lock = undefined;
  }

  async stop(): Promise<void> {
    this.started = false;
    ++this.generation;
    this.connection?.deactivate();
    await this.pending;
    await this.connection?.stop();
    this.connection = undefined;
    this.releaseLock();
  }

  async unlinkGateway(): Promise<void> {
    if (!this.connection?.client.unlink) throw new Error("Team Slack is offline. Unlink with /devhub unlink in Slack.");
    await this.connection.client.unlink();
  }

  pokeNeedsYou(): void { this.connection?.pokeNeedsYou(); }

  async gatewayTest(message: SlackMessage): Promise<SlackReceipt> {
    if (!this.connection || this.connection.settings.mode !== "gateway") throw new SlackNotSentError("Team Slack is offline");
    return this.connection.sendTest(message);
  }
}

const runtime = globalThis as typeof globalThis & { __devhubSlackRuntime?: SlackRuntime };
function current(): SlackRuntime { return runtime.__devhubSlackRuntime ??= new SlackRuntime(); }
export function startSlackBot(): void { current().start(); }
export function restartSlackBot(): void { void current().refresh(); }
export async function stopSlackBot(): Promise<void> { await runtime.__devhubSlackRuntime?.stop(); }
/** No-op unless the bot is running; safe to call from any route. */
export function pokeSlackNeedsYou(): void { runtime.__devhubSlackRuntime?.pokeNeedsYou(); }
export function slackStatus(): SlackStatus { return current().status(); }
export function unlinkSlackGateway(): Promise<void> { return current().unlinkGateway(); }
export function sendGatewaySlackTest(message: SlackMessage): Promise<SlackReceipt> { return current().gatewayTest(message); }
