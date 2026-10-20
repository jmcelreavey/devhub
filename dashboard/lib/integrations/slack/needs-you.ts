import { createHash, randomUUID } from "node:crypto";
import { readAlerts } from "../alert-store";
import { isQuiet } from "../alert-types";
import { slackRouteContext } from "./answers";
import { capabilityRequest } from "./capabilities-route";
import { classifySlackFailure, type SlackMessage, type SlackMessageUpdate, type SlackReceipt, type SlackTransport } from "./client";
import { formatPlanRevisionModal, formatSlackAnswerConfirmation, formatSlackDigest, formatSlackNeed, formatSlackRetryConfirmation, slackTextMessage } from "./needs-you-format";
import { argsPreview } from "./tool-format";
import { answerSlackTask, decideSlackPlan, loadSlackNeedsSnapshot, retrySlackTask, slackTaskQuestions, SlackAnswerError, type SlackNeed, type SlackNeedsSnapshot, type SlackTaskAnswer, type SlackTaskQuestions } from "./needs-you-source";
import type { SlackIncomingMessage, SlackInteraction } from "./security";
import type { SlackNeedTarget } from "./tool-handler";
import type { SlackSettings } from "./shared";
import { isAcknowledgement, unescapeSlackText } from "./slack-text";
import { sameSlackAudience, SlackThreadStore, slackThreadItemId, type SlackAudience, type SlackThreadItem } from "./thread-store";
import { SlackProgress } from "./progress";
import { SlackTaskMessageStore } from "./task-messages";
import { defaultSlackTaskReplyDependencies, replyToTaskThread, type SlackTaskReplyDependencies } from "./thread-reply";

const REVIVE_WITHIN_MS = 24 * 60 * 60 * 1000;
/** How often the board is re-read. Each tick rebuilds tasks, workflows and PRs, so don't make it chatty. */
export const NEEDS_YOU_TICK_MS = 20_000;
/** A gap this long between ticks means the Mac slept or the process stalled: re-baseline instead of catching up. Same 25s of slack over the interval as before. */
const SLEEP_GAP_MS = NEEDS_YOU_TICK_MS + 25_000;

export interface SlackNeedsTransport {
  active: () => boolean;
  post: (message: SlackMessage, guard?: () => boolean) => Promise<SlackReceipt>;
  update: (message: SlackMessageUpdate) => Promise<void>;
  openModal?: SlackTransport["openModal"];
  /** The set of things that need John changed (an item appeared or went away): the Home tab refreshes. */
  changed?: () => void;
}
export interface SlackReplyResult { handled: boolean; profile?: string }
export interface SlackNeedsHandler {
  reset: () => void;
  tick: () => Promise<void>;
  reply: (message: SlackIncomingMessage) => Promise<SlackReplyResult>;
  interact: (interaction: SlackInteraction) => Promise<void>;
  stop: () => Promise<void>;
}
export interface SlackNeedsDependencies {
  store: SlackThreadStore;
  profile: () => string;
  primary: () => boolean;
  now: () => number;
  snapshot: (profile: string) => Promise<SlackNeedsSnapshot>;
  questions: (profile: string, taskId: string) => SlackTaskQuestions;
  answer: (profile: string, taskId: string, answer: string, requestId: string, questionId?: string) => Promise<SlackTaskAnswer>;
  retry: (profile: string, taskId: string, token: string) => Promise<void>;
  decidePlan?: typeof decideSlackPlan;
  quiet: (profile: string, now: Date) => boolean;
  /** Where agent milestones are remembered. Absent means no progress messages. */
  messages?: SlackTaskMessageStore;
  /** How a reply in a task thread with no open question reaches the task. Absent means the real plan-revise and task-note paths. */
  taskReply?: SlackTaskReplyDependencies;
}

function defaultDependencies(): SlackNeedsDependencies {
  return {
    store: new SlackThreadStore(), profile: () => slackRouteContext().activeProfile,
    primary: () => process.env.DEVHUB_SCHEDULER !== "0", now: Date.now,
    snapshot: loadSlackNeedsSnapshot, questions: slackTaskQuestions, answer: answerSlackTask, retry: retrySlackTask, decidePlan: decideSlackPlan, messages: new SlackTaskMessageStore(),
    quiet: (profile, now) => readAlerts().destinations.some((destination) => destination.enabled && destination.provider === "slack" && destination.workProfile === profile && isQuiet(destination, now)),
  };
}

export class SlackNeedsYou implements SlackNeedsHandler {
  private baseline = true;
  private lastProfile?: string;
  private lastTick = 0;
  private recovered = false;
  private stopped = false;
  private pending: Promise<unknown> = Promise.resolve();
  private readonly progress?: SlackProgress;
  /** This tick's board, handed from the Needs-you pass to the progress pass so it is read once. */
  private latest?: { profile: string; baseline: boolean; milestones: NonNullable<SlackNeedsSnapshot["milestones"]> };
  private signature?: string;

  constructor(
    private readonly settings: SlackSettings,
    private readonly audience: SlackAudience,
    private readonly transport: SlackNeedsTransport,
    private readonly dependencies = defaultDependencies(),
    /** Turns a Plan or Implement button into a Confirm card. Without it those buttons say nothing. */
    private readonly propose?: (action: "plan" | "implement", target: SlackNeedTarget) => Promise<SlackMessage[]>,
  ) {
    if (dependencies.messages) this.progress = new SlackProgress(audience, transport, dependencies.messages);
  }

  reset(): void { this.baseline = true; }
  async stop(): Promise<void> { this.stopped = true; await this.pending; }
  private active(): boolean {
    return !this.stopped && this.dependencies.primary() && this.transport.active()
      && (this.settings.mode !== "gateway" || this.audience.channel.startsWith("D") && this.audience.channel === this.settings.channelId && this.audience.userId === this.settings.allowedUserId);
  }
  private serial<Result>(work: () => Promise<Result>): Promise<Result> {
    const result = this.pending.then(work);
    this.pending = result.then(() => undefined, () => undefined);
    return result;
  }
  private items(profile?: string): Array<[string, SlackThreadItem]> {
    return Object.entries(this.dependencies.store.read().items).filter(([, item]) => sameSlackAudience(item, this.audience) && (!profile || item.profile === profile));
  }
  private rootFor(item: SlackNeed): string | undefined {
    return this.items(item.profile).find(([, entry]) => entry.entityId === item.entityId && entry.thread_ts)?.[1].thread_ts
      ?? (item.taskId ? this.dependencies.messages?.threadFor(this.audience, item.profile, item.taskId)?.ts : undefined);
  }

  private notification(message: SlackMessage): SlackMessage {
    if (/^[CG]/.test(message.channel)) {
      const mention = `<@${this.audience.userId}>`;
      return { ...message, text: `${mention} ${message.text}`, mrkdwn: true, blocks: [{ type: "section", text: { type: "mrkdwn", text: `${mention} · Waiting for you`, verbatim: true } }, ...(message.blocks ?? [])] };
    }
    return message.thread_ts && this.settings.mode !== "gateway" ? { ...message, reply_broadcast: true } : message;
  }

  tick(): Promise<void> {
    return this.serial(async () => {
      this.latest = undefined;
      await this.postNeedsYou();
      await this.postProgress();
    });
  }

  /** Agent milestones for the profile the Needs-you pass just read. Same gates: primary process, connected, not stopped. */
  private async postProgress(): Promise<void> {
    const latest = this.latest;
    if (!this.progress || !latest || !this.active() || this.dependencies.profile() !== latest.profile) return;
    await this.progress.run(latest.milestones, {
      enabled: this.settings.postProgress !== false,
      baseline: latest.baseline, needsEnabled: this.settings.postNeedsYou !== false,
      quiet: this.dependencies.quiet(latest.profile, new Date(this.dependencies.now())),
      items: () => this.items(latest.profile).map(([, item]) => item),
    });
  }

  private async postNeedsYou(): Promise<void> {
    if (!this.active()) return;
    const profile = this.dependencies.profile();
    const now = this.dependencies.now();
    // A thread file that had to be set aside has forgotten what was already posted: re-baseline rather than post it all again.
    this.dependencies.store.read();
    const stateLost = this.dependencies.store.wasReset();
    const baseline = this.baseline || stateLost || profile !== this.lastProfile || (this.lastTick > 0 && now - this.lastTick > SLEEP_GAP_MS);
    const snapshot = await this.dependencies.snapshot(profile);
    if (!this.active() || this.dependencies.profile() !== profile) { this.reset(); return; }
    if (snapshot.items.some((item) => item.profile !== profile)) throw new Error("Slack snapshot profile mismatch");
    const current = new Map(snapshot.items.map((item) => [slackThreadItemId(item, this.audience), item]));
    this.latest = { profile, baseline, milestones: snapshot.milestones ?? [] };
    this.noteChange(profile, [...current.keys()]);
    await this.dependencies.store.change((state) => {
      if (!this.recovered) {
        for (const item of Object.values(state.items)) if (item.delivery === "sending") item.delivery = "unknown";
      }
      for (const [id, item] of Object.entries(state.items)) {
        if (!sameSlackAudience(item, this.audience) || item.profile !== profile || item.resolved || current.has(id) || (!item.taskId && !snapshot.peersKnown)) continue;
        item.resolved = true;
        item.resolution = item.questionId ? "Answered in DevHub" : `Resolved · ${item.needed}`;
        item.revision = undefined;
        item.dirty = !!(item.ts || item.digestTs);
      }
      for (const [token, confirmation] of Object.entries(state.confirmations)) {
        if (confirmation.expiresAt < now - 86400000) delete state.confirmations[token];
      }
    });
    this.recovered = true;
    this.baseline = false;
    this.lastProfile = profile;
    this.lastTick = now;
    await this.flushEdits(profile);
    const existing = new Map(this.items(profile));
    // A need that blinks out of one snapshot and back (e.g. a PR list refresh) revives its own
    // card in place instead of posting a fresh digest every few minutes.
    const revived = [...current].filter(([id]) => {
      const entry = existing.get(id);
      return !!entry?.resolved && !entry.planDecision && (!entry.questionId || (entry.state === "question" || entry.state === "push-failed") && entry.resolution === "Answered in DevHub")
        && (entry.delivery === "skipped" || !!(entry.ts || entry.digestTs)) && now - Date.parse(entry.postedAt) < REVIVE_WITHIN_MS;
    }).map(([id]) => id);
    if (revived.length) {
      await this.dependencies.store.change((state) => {
        for (const id of revived) Object.assign(state.items[id], { resolved: false, resolution: undefined, dirty: true });
      });
      await this.flushEdits(profile);
    }
    const fresh = [...current].filter(([id]) => !revived.includes(id) && !existing.get(id)?.planDecision && (!existing.has(id) || existing.get(id)!.resolved));
    if (baseline || this.settings.postNeedsYou === false) {
      await this.remember(fresh, "skipped");
      return;
    }
    if (this.dependencies.quiet(profile, new Date(now)) || !fresh.length) return;
    const unthreaded = fresh.filter(([, item]) => !this.rootFor(item) && item.action !== "approve-plan");
    const digest = fresh.length > 5 ? unthreaded : [];
    if (digest.length) await this.postDigest(digest, existing, profile);
    // One item at a time: each is reserved just before its own request, so a failure can only
    // affect the item in flight. Everything not yet attempted is untouched and is tried next tick.
    for (const [id, item] of fresh) {
      if (digest.some(([digestId]) => digestId === id)) continue;
      await this.remember([[id, item]], "sending");
      await this.postItem(id, true, { previous: existing.get(id) });
    }
  }

  /** Tells the Home tab when what needs John changes. The first read of a profile is a baseline, not a change. */
  private noteChange(profile: string, ids: string[]): void {
    const signature = `${profile}:${ids.sort().join(",")}`;
    const previous = this.signature;
    this.signature = signature;
    if (previous !== undefined && previous !== signature) this.transport.changed?.();
  }

  private async postDigest(fresh: Array<[string, SlackNeed]>, existing: Map<string, SlackThreadItem>, profile: string): Promise<void> {
    await this.remember(fresh, "sending");
    try {
      const state = this.dependencies.store.read();
      const receipt = await this.transport.post(this.notification(formatSlackDigest(fresh.map(([id]) => state.items[id]), this.audience.channel)), () => this.dependencies.profile() === profile);
      await this.dependencies.store.change((state) => {
        for (const [id] of fresh) Object.assign(state.items[id], { digestTs: receipt.ts, delivery: "sent", dirty: !!state.items[id].thread_ts });
      });
      await this.flushEdits(profile);
    } catch (error) {
      // One request carried them all, so they share its fate.
      await this.settleFailedSend(fresh.map(([id]) => id), error, new Map(fresh.map(([id]) => [id, existing.get(id)])));
      throw error;
    }
  }

  /**
   * After a failed send: items whose request provably never reached Slack (rate limit, DNS, a stop on
   * our side) go back to how they were so the next tick retries them. Only an unknown outcome is
   * recorded as `unknown`, which is never re-posted.
   */
  private async settleFailedSend(ids: string[], error: unknown, previous: Map<string, SlackThreadItem | undefined>): Promise<void> {
    const state = this.dependencies.store.read();
    const inFlight = ids.filter((id) => state.items[id]?.delivery === "sending");
    if (classifySlackFailure(error).kind === "uncertain") { await this.unknown(inFlight); return; }
    await this.dependencies.store.change((current) => {
      for (const id of inFlight) {
        const before = previous.get(id);
        if (before) current.items[id] = before;
        else delete current.items[id];
      }
    });
  }

  private async remember(items: Array<[string, SlackNeed]>, delivery: SlackThreadItem["delivery"]): Promise<void> {
    const roots = new Map(items.map(([id, item]) => [id, this.rootFor(item)]));
    await this.dependencies.store.change((state) => {
      for (const [id, item] of items) state.items[id] = {
        ...item, ...this.audience, thread_ts: roots.get(id), postedAt: new Date(this.dependencies.now()).toISOString(),
        resolved: false, delivery, dirty: false,
      };
    });
  }

  private async unknown(ids: string[]): Promise<void> {
    await this.dependencies.store.change((state) => { for (const id of ids) state.items[id].delivery = "unknown"; });
  }

  private async postItem(id: string, activeOnly = false, reserved?: { previous?: SlackThreadItem }): Promise<void> {
    const item = this.dependencies.store.read().items[id];
    const threadTs = this.rootFor(item);
    try {
      const receipt = await this.transport.post(this.notification(formatSlackNeed(item, id, item.channel, threadTs, undefined, this.settings.mode === "gateway")), activeOnly ? () => this.dependencies.profile() === item.profile : undefined);
      await this.dependencies.store.change((state) => {
        Object.assign(state.items[id], { ts: receipt.ts, thread_ts: threadTs ?? receipt.ts, delivery: "sent", dirty: !!threadTs || !!item.digestTs });
        for (const entry of Object.values(state.items)) {
          if (sameSlackAudience(entry, item) && entry.profile === item.profile && entry.entityId === item.entityId) entry.thread_ts = threadTs ?? receipt.ts;
        }
      });
      if (threadTs && this.settings.mode === "gateway") {
        await this.transport.post(slackTextMessage(item.channel, `Waiting for you · ${item.title}\n${item.needed}\nOpen the task thread above to act.`), activeOnly ? () => this.dependencies.profile() === item.profile : undefined);
      }
      if (item.taskId) await this.dependencies.messages?.remember(this.audience, receipt.channel, receipt.ts, { profile: item.profile, taskId: item.taskId, title: item.title }, threadTs ?? receipt.ts);
      await this.flushEdits(item.profile);
    } catch (error) {
      if (reserved) await this.settleFailedSend([id], error, new Map([[id, reserved.previous]]));
      else if (!this.dependencies.store.read().items[id].ts) await this.unknown([id]);
      throw error;
    }
  }

  private async flushEdits(profile: string): Promise<void> {
    const entries = this.items(profile);
    const dirty = entries.filter(([, item]) => item.dirty);
    if (!dirty.length) return;
    const targets = new Map<string, SlackMessageUpdate>();
    for (const [id, item] of dirty) {
      if (item.ts && item.ts !== item.thread_ts) targets.set(item.ts, { ...formatSlackNeed(item, id, item.channel, undefined, item.resolved ? item.resolution : undefined, this.settings.mode === "gateway"), ts: item.ts });
      if (item.thread_ts && entries.some(([, entry]) => entry.ts === item.thread_ts)) {
        const related = entries.filter(([, entry]) => entry.entityId === item.entityId);
        const selected = related.find(([, entry]) => !entry.resolved) ?? [...related].reverse().find(([, entry]) => entry.resolved);
        if (selected) {
          const [selectedId, value] = selected;
          const acknowledgement = related.find(([, entry]) => entry.dirty && entry.resolved && entry.questionId)?.[1].resolution;
          const next = !value.resolved && acknowledgement ? { ...value, needed: `${acknowledgement} · Next: ${value.needed}` } : value;
          targets.set(item.thread_ts, { ...formatSlackNeed(next, selectedId, item.channel, undefined, value.resolved ? value.resolution : undefined, this.settings.mode === "gateway"), ts: item.thread_ts });
        }
      }
      if (item.digestTs) targets.set(item.digestTs, { ...formatSlackDigest(entries.filter(([, entry]) => entry.digestTs === item.digestTs).map(([, entry]) => entry), item.channel), ts: item.digestTs });
    }
    for (const update of targets.values()) await this.transport.update(update);
    await this.dependencies.store.change((state) => { for (const [id] of dirty) state.items[id].dirty = false; });
  }

  reply(message: SlackIncomingMessage): Promise<SlackReplyResult> { return this.serial(() => this.answerReply(message)); }

  private async answerReply(message: SlackIncomingMessage, selectedQuestion?: { itemId: string; questionId: string; questionText: string; confirmed?: boolean; option?: string }): Promise<SlackReplyResult> {
    const confirmed = selectedQuestion?.confirmed === true;
    if (!this.active() || !message.threadTs || message.teamId !== this.audience.teamId || message.userId !== this.audience.userId || message.channelId !== this.audience.channel) return { handled: false };
    const entries = this.items().filter(([, item]) => item.thread_ts === message.threadTs || item.digestTs === message.threadTs);
    if (!entries.length) return { handled: false };
    if (!selectedQuestion && capabilityRequest(message.text)) return { handled: false, profile: entries[0][1].profile };
    if (entries.every(([, item]) => !item.taskId)) return { handled: false, profile: entries[0][1].profile };
    // "thanks" is not an answer, and doesn't need a reply or a model.
    if (!selectedQuestion && isAcknowledgement(message.text)) return { handled: true };
    const revision = !selectedQuestion && entries.find(([, item]) => item.revision?.mode === "thread" && !item.planDecision);
    if (revision) {
      await this.decidePlan(revision[0], revision[1], "revise", unescapeSlackText(message.text), revision[1].revision?.token);
      return { handled: true, profile: revision[1].profile };
    }
    let selected = selectedQuestion ? entries.find(([id]) => id === selectedQuestion.itemId) : entries.find(([, item]) => item.thread_ts === message.threadTs && item.taskId && !item.resolved)
      ?? entries.find(([, item]) => item.thread_ts === message.threadTs && item.taskId);
    let answer = selectedQuestion ? message.text : unescapeSlackText(message.text);
    if (!selected) {
      const match = /^\s*([^:\s]+)\s*:\s*([\s\S]+)$/.exec(answer);
      const matching = match ? entries.filter(([, item]) => item.taskId && (item.taskId.toLowerCase() === match[1].toLowerCase() || item.jiraKey?.toLowerCase() === match[1].toLowerCase())) : [];
      const tasks = new Set(matching.map(([, item]) => `${item.profile}:${item.taskId}`));
      if (tasks.size !== 1) {
        await this.transport.post(slackTextMessage(message.channelId, "This digest covers several tasks. Reply with a Jira key or task ID followed by : and your answer, so I know which task.", message.threadTs));
        return { handled: true };
      }
      selected = matching.find(([, item]) => !item.resolved) ?? matching[0];
      answer = match![2];
    }
    const [id, item] = selected;
    if (!item.taskId) return { handled: false, profile: item.profile };
    try {
      const fresh = await this.dependencies.snapshot(item.profile);
      const current = this.dependencies.questions(item.profile, item.taskId);
      const waiting = fresh.items.some((entry) => entry.taskId === item.taskId && (entry.action === "answer" || entry.action === "repo"));
      // The question this reply is for: the one its card carries, else the first open one.
      const target = current.questions.find((question) => question.id === (selectedQuestion?.questionId ?? item.questionId)) ?? current.questions[0];
      if (selectedQuestion && (!waiting || current.closed || target?.id !== selectedQuestion.questionId || target?.text !== selectedQuestion.questionText || (selectedQuestion.option !== undefined && !target?.options?.includes(selectedQuestion.option)))) throw new SlackAnswerError("That question changed or was answered elsewhere. Open the current question before answering.");
      if (!waiting || !current.questions.length || current.closed) {
        await this.markQuestions(item.profile, item.taskId, undefined, "Answered in DevHub");
        return this.replyToTask(message, item.profile, item.taskId, item.jiraKey, answer, !!confirmed);
      }
      if (this.audience.deviceId && !confirmed) {
        const questionId = target.id;
        const questionText = target.text;
        const preview = argsPreview({ question: target.text, answer });
        if (!answer.trim() || answer.length > 12000 || !preview.fits) throw new SlackAnswerError("That answer can't be fully reviewed in a Slack card. Open the task in DevHub to answer it.");
        const token = randomUUID();
        await this.dependencies.store.change((state) => {
          state.confirmations[token] = { ...this.audience, kind: "answer", itemId: id, questionId, questionText, answer, thread_ts: message.threadTs!, expiresAt: this.dependencies.now() + 600000, state: "pending", nonce: token,
            argsHash: createHash("sha256").update(JSON.stringify([item.profile, item.taskId, questionId, questionText, answer])).digest("hex") };
        });
        const receipt = await this.transport.post(formatSlackAnswerConfirmation(message.channelId, message.threadTs, token, preview.chunks));
        await this.dependencies.store.change((state) => { state.confirmations[token].ts = receipt.ts; });
        return { handled: true };
      }
      const result = await this.dependencies.answer(item.profile, item.taskId, answer, message.eventId, target.id);
      if (!result.question) return this.replyToTask(message, item.profile, item.taskId, item.jiraKey, answer, !!confirmed);
      if (!this.rootFor(item)) await this.postItem(id);
      await this.markQuestions(item.profile, item.taskId, result.question.id, "Answered");
      const threadTs = this.rootFor(item) ?? message.threadTs;
      const remaining = result.remaining ? ` ${result.remaining} question${result.remaining === 1 ? " still needs" : "s still need"} an answer.` : "";
      await this.transport.post(slackTextMessage(message.channelId, `✅ Answered: ${result.question.text.slice(0, 500)}.${remaining}${result.detail ? ` ${result.detail}` : ""}`, threadTs));
      return { handled: true };
    } catch (error) {
      await this.transport.post(slackTextMessage(message.channelId, error instanceof SlackAnswerError ? error.message : "Couldn't confirm the answer's outcome. Check the task in DevHub before trying again.", message.threadTs));
      return { handled: true };
    }
  }

  /** No question is open: the owner's reply still belongs to this task, so route it by the task's current state (see thread-reply.ts). */
  private async replyToTask(message: SlackIncomingMessage, profile: string, taskId: string, jiraKey: string | undefined, text: string, confirmed: boolean): Promise<SlackReplyResult> {
    let line: string;
    if (confirmed) line = "That question was already answered or resolved in DevHub. Nothing was changed.";
    else {
      try {
        line = await replyToTaskThread(this.dependencies.taskReply ?? defaultSlackTaskReplyDependencies, { profile, taskId, label: jiraKey ?? taskId, text, eventId: message.eventId });
      } catch {
        line = "Couldn't check this task. Nothing changed; open DevHub to check it before trying again.";
      }
    }
    await this.transport.post(slackTextMessage(message.channelId, line, message.threadTs));
    return { handled: true };
  }

  private async markQuestions(profile: string, taskId: string, questionId: string | undefined, resolution: string): Promise<void> {
    await this.dependencies.store.change((state) => {
      for (const item of Object.values(state.items)) {
        if (!sameSlackAudience(item, this.audience) || item.profile !== profile || item.taskId !== taskId || !item.questionId || (questionId && item.questionId !== questionId)) continue;
        item.resolved = true; item.resolution = resolution; item.dirty = !!(item.ts || item.digestTs);
      }
    });
    await this.flushEdits(profile);
  }

  interact(interaction: SlackInteraction): Promise<void> { return this.serial(() => this.handleInteraction(interaction)); }

  private async handleInteraction(interaction: SlackInteraction): Promise<void> {
    if (!this.active() || interaction.teamId !== this.audience.teamId || interaction.userId !== this.audience.userId || interaction.channelId !== this.audience.channel || interaction.action === "devhub_open") return;
    if (interaction.action === "devhub_approve_plan" || interaction.action === "devhub_revise_plan" || interaction.action === "devhub_submit_plan_revision") { await this.planInteraction(interaction); return; }
    if (interaction.surface === "home") { await this.homeInteraction(interaction); return; }
    if (interaction.action === "devhub_confirm_answer" || interaction.action === "devhub_cancel_answer") { await this.confirmAnswer(interaction); return; }
    if (interaction.action === "devhub_confirm_retry" || interaction.action === "devhub_cancel_retry") {
      await this.confirmRetry(interaction);
      return;
    }
    const item = interaction.value ? this.dependencies.store.read().items[interaction.value] : undefined;
    if (!item || !item.taskId || !sameSlackAudience(item, this.audience) || (item.ts !== interaction.ts && item.thread_ts !== interaction.ts)) return;
    let fresh: SlackNeedsSnapshot;
    try { fresh = await this.dependencies.snapshot(item.profile); }
    catch {
      await this.transport.post(slackTextMessage(item.channel, "Couldn't check this task. Nothing changed; open DevHub to check it before trying again.", item.thread_ts));
      return;
    }
    if (item.resolved || !fresh.items.some((entry) => slackThreadItemId(entry, this.audience) === interaction.value)) {
      await this.transport.post(slackTextMessage(item.channel, "This item has already been answered or resolved in DevHub. Nothing changed.", item.thread_ts));
      return;
    }
    if (interaction.action.startsWith("devhub_answer_option_")) {
      const index = Number(interaction.action.slice("devhub_answer_option_".length));
      const option = item.options?.[index];
      const question = this.dependencies.questions(item.profile, item.taskId).questions.find((candidate) => candidate.id === item.questionId);
      if (item.action !== "answer" || !item.thread_ts || !item.questionId || !option) return;
      if (question?.id !== item.questionId || question.text !== item.needed || question.options?.[index] !== option) {
        await this.transport.post(slackTextMessage(item.channel, "That question or its options changed. Open the current question before answering.", item.thread_ts));
        return;
      }
      await this.answerReply({
        teamId: interaction.teamId, userId: interaction.userId, channelId: interaction.channelId,
        eventId: `slack-option-${interaction.actionTs}`, ts: interaction.actionTs, threadTs: item.thread_ts, text: option,
      }, { itemId: interaction.value!, questionId: item.questionId, questionText: item.needed, option });
      return;
    }
    if (interaction.action === "devhub_answer" && (item.action === "answer" || item.action === "repo")) {
      const open = this.dependencies.questions(item.profile, item.taskId).questions;
      const question = open.find((candidate) => candidate.id === item.questionId) ?? open[0];
      await this.transport.post(slackTextMessage(item.channel, question ? `${question.text.slice(0, 2000)}\nReply in this thread to answer${question.kind === "repo" ? " with a recognised repo name or absolute path" : ""}. If several questions are open, I'll answer the oldest unanswered one.` : "Nothing to answer on this task", item.thread_ts));
      return;
    }
    if (interaction.action === "devhub_need_plan" || interaction.action === "devhub_need_implement") {
      if (item.action !== "open" || !item.thread_ts || !this.propose) return;
      const cards = await this.propose(interaction.action === "devhub_need_plan" ? "plan" : "implement", { profile: item.profile, taskId: item.taskId, channel: item.channel, threadTs: item.thread_ts, teamId: this.audience.teamId, userId: this.audience.userId });
      for (const card of cards) await this.transport.post(card);
      return;
    }
    if (interaction.action !== "devhub_retry" || item.action !== "retry" || !item.thread_ts) return;
    await this.proposeRetry(item, interaction.value!);
  }

  private async planInteraction(interaction: SlackInteraction): Promise<void> {
    const id = interaction.value;
    const item = id ? this.dependencies.store.read().items[id] : undefined;
    if (!id || !item?.plan || item.action !== "approve-plan" || !sameSlackAudience(item, this.audience) || interaction.deviceId !== this.audience.deviceId) return;
    if (interaction.surface === "modal") {
      if (item.revision?.mode !== "modal" || !interaction.revisionToken || !interaction.revisionText) return;
      await this.decidePlan(id, item, "revise", interaction.revisionText, interaction.revisionToken);
      return;
    }
    if (item.ts !== interaction.ts && item.thread_ts !== interaction.ts) return;
    if (interaction.action === "devhub_approve_plan") { await this.decidePlan(id, item, "approve"); return; }
    if (item.resolved || item.planDecision) return;
    const token = randomUUID();
    const modal = !!(this.transport.openModal && interaction.triggerId);
    await this.dependencies.store.change((state) => { state.items[id].revision = { token, expiresAt: this.dependencies.now() + 600000, mode: modal ? "modal" : "thread" }; });
    if (modal) {
      try { await this.transport.openModal!(interaction.triggerId!, formatPlanRevisionModal(item, id, token)); return; }
      catch { await this.dependencies.store.change((state) => { state.items[id].revision!.mode = "thread"; }); }
    }
    await this.transport.post(slackTextMessage(item.channel, "Reply in this thread with what to change (up to 4,000 characters, within 10 minutes).", item.thread_ts));
  }

  private async decidePlan(id: string, item: SlackThreadItem, decision: "approve" | "revise", guidance?: string, revisionToken?: string): Promise<void> {
    const explain = (text: string) => this.transport.post(slackTextMessage(item.channel, text, item.thread_ts));
    try {
      if (!item.taskId || !item.plan || !this.dependencies.decidePlan) return;
      if (decision === "revise" && (!guidance?.trim() || guidance.length > 4000)) { await explain("Describe the revision in 1 to 4,000 characters. Nothing changed."); return; }
      const fresh = await this.dependencies.snapshot(item.profile);
      if (item.resolved || !fresh.items.some((entry) => slackThreadItemId(entry, this.audience) === id)) {
        await this.dependencies.store.change((state) => { state.items[id].revision = undefined; });
        await explain("The plan changed or was resolved in DevHub. Review the latest plan; nothing changed.");
        return;
      }
      const claimed = await this.dependencies.store.change((state) => {
        const current = state.items[id];
        if (current?.revision && current.revision.expiresAt <= this.dependencies.now()) current.revision = undefined;
        if (!current || current.resolved || current.planDecision || (decision === "revise" && (!revisionToken || current.revision?.token !== revisionToken || current.revision.expiresAt <= this.dependencies.now()))) return false;
        current.planDecision = "claimed"; current.revision = undefined;
        return true;
      });
      if (!claimed) { await explain("This plan action expired or was already used. Nothing else was started."); return; }
      await this.dependencies.decidePlan(item.profile, item.taskId, item.plan, decision, id, guidance);
      await this.dependencies.store.change((state) => {
        Object.assign(state.items[id], { planDecision: decision === "approve" ? "approved" : "revised", resolved: true, resolution: decision === "approve" ? "Plan approved" : "Revision requested", dirty: true });
      });
      await this.flushEdits(item.profile);
      this.transport.changed?.();
    } catch (error) {
      await explain(error instanceof SlackAnswerError ? error.message : "Couldn't confirm the plan action's outcome. Check DevHub before continuing; this action won't run again.");
    }
  }

  private async proposeRetry(item: SlackThreadItem, itemId: string): Promise<void> {
    const token = randomUUID();
    await this.dependencies.store.change((state) => {
      state.confirmations[token] = { ...this.audience, itemId, thread_ts: item.thread_ts, expiresAt: this.dependencies.now() + 300000, state: "pending",
        ...(this.audience.deviceId ? { nonce: token, argsHash: createHash("sha256").update(JSON.stringify([item.profile, item.taskId, itemId])).digest("hex") } : {}) };
    });
    const receipt = await this.transport.post(formatSlackRetryConfirmation(item, token));
    await this.dependencies.store.change((state) => {
      state.confirmations[token].ts = receipt.ts;
      state.confirmations[token].thread_ts ??= receipt.ts;
      state.items[itemId].thread_ts ??= receipt.ts;
    });
  }

  /**
   * Plan or Implement from the Home tab. A Home click has no message or thread, so the item is matched
   * against a fresh read of what needs John (by the id on the button, never by a task id taken from the
   * click), and the Confirm card is posted in the configured channel. Nothing starts until Confirm.
   */
  private async homeInteraction(interaction: SlackInteraction): Promise<void> {
    if (!["devhub_need_plan", "devhub_need_implement", "devhub_retry"].includes(interaction.action) || !interaction.value) return;
    const profile = this.dependencies.profile();
    const say = (text: string) => this.transport.post(slackTextMessage(this.audience.channel, text));
    let fresh: SlackNeedsSnapshot;
    try { fresh = await this.dependencies.snapshot(profile); }
    catch { await say("Couldn't check that task. Nothing was started; open DevHub to check it."); return; }
    if (!this.active() || this.dependencies.profile() !== profile) return;
    const need = fresh.items.find((entry) => slackThreadItemId(entry, this.audience) === interaction.value);
    if (need?.taskId && need.profile === profile && need.action === "retry" && interaction.action === "devhub_retry") {
      const existing = this.dependencies.store.read().items[interaction.value];
      if (!existing) await this.remember([[interaction.value, need]], "skipped");
      const item = this.dependencies.store.read().items[interaction.value];
      if (item) await this.proposeRetry(item, interaction.value);
      return;
    }
    if (!this.propose) return;
    if (!need?.taskId || need.action !== "open" || need.profile !== profile) { await say("That task isn't waiting to be picked up any more. Nothing was started."); return; }
    const cards = await this.propose(interaction.action === "devhub_need_plan" ? "plan" : "implement", { profile: need.profile, taskId: need.taskId, channel: this.audience.channel, threadTs: this.rootFor(need), teamId: this.audience.teamId, userId: this.audience.userId });
    for (const card of cards) await this.transport.post(card);
  }

  private async confirmRetry(interaction: SlackInteraction): Promise<void> {
    const token = interaction.value;
    const confirmation = token ? this.dependencies.store.read().confirmations[token] : undefined;
    if (!token || !confirmation || confirmation.kind === "answer" || !sameSlackAudience(confirmation, this.audience) || confirmation.ts !== interaction.ts) return;
    const item = this.dependencies.store.read().items[confirmation.itemId];
    if (!item?.taskId) return;
    if (confirmation.deviceId !== interaction.deviceId || (confirmation.deviceId && (confirmation.nonce !== token
      || confirmation.argsHash !== createHash("sha256").update(JSON.stringify([item.profile, item.taskId, confirmation.itemId])).digest("hex")))) return;
    const update = async (text: string) => this.transport.update({ ...slackTextMessage(item.channel, text), ts: interaction.ts });
    const claimed = await this.dependencies.store.change((state) => {
      const entry = state.confirmations[token];
      if (entry.state !== "pending" || entry.expiresAt <= this.dependencies.now()) return false;
      entry.state = interaction.action === "devhub_cancel_retry" ? "cancelled" : "consumed";
      return true;
    });
    if (!claimed) { await update("This retry confirmation expired or was already used. Nothing else was started."); return; }
    if (interaction.action === "devhub_cancel_retry") { await update("Retry cancelled. Nothing started."); return; }
    try {
      const fresh = await this.dependencies.snapshot(item.profile);
      if (item.resolved || !fresh.items.some((entry) => entry.action === "retry" && slackThreadItemId(entry, this.audience) === confirmation.itemId)) {
        await update("This task no longer needs that retry. Nothing started.");
        return;
      }
      await this.dependencies.retry(item.profile, item.taskId, token);
      await this.dependencies.store.change((state) => {
        Object.assign(state.items[confirmation.itemId], { resolved: true, resolution: "Retry requested", dirty: true });
      });
      await this.flushEdits(item.profile);
      await update("✅ Retry requested. Auto mode will carry on in DevHub.");
    } catch {
      await update("Couldn't confirm the retry outcome. Check DevHub before requesting another retry; this confirmation won't run again.");
    }
  }

  private async confirmAnswer(interaction: SlackInteraction): Promise<void> {
    const token = interaction.value;
    if (!token || !this.audience.deviceId || interaction.deviceId !== this.audience.deviceId) return;
    const confirmation = this.dependencies.store.read().confirmations[token];
    if (!confirmation || confirmation.kind !== "answer" || !sameSlackAudience(confirmation, this.audience) || confirmation.deviceId !== interaction.deviceId
      || confirmation.nonce !== token || confirmation.ts !== interaction.ts || !confirmation.questionId || confirmation.questionText === undefined || !confirmation.answer) return;
    const item = this.dependencies.store.read().items[confirmation.itemId];
    if (!item?.taskId || confirmation.argsHash !== createHash("sha256").update(JSON.stringify([item.profile, item.taskId, confirmation.questionId, confirmation.questionText, confirmation.answer])).digest("hex")) return;
    const claimed = await this.dependencies.store.change((state) => {
      const entry = state.confirmations[token];
      if (entry.state !== "pending" || entry.expiresAt <= this.dependencies.now()) return false;
      entry.state = interaction.action === "devhub_cancel_answer" ? "cancelled" : "consumed";
      return true;
    });
    const text = !claimed ? "That answer confirmation expired or was already used. Nothing was changed." : interaction.action === "devhub_cancel_answer" ? "Answer cancelled. Nothing was changed." : "Answer confirmed.";
    await this.transport.update({ ...slackTextMessage(interaction.channelId, text), ts: interaction.ts });
    if (!claimed || interaction.action === "devhub_cancel_answer") return;
    await this.answerReply({ teamId: this.audience.teamId, userId: this.audience.userId, channelId: this.audience.channel, eventId: token, ts: interaction.ts, threadTs: confirmation.thread_ts, text: confirmation.answer }, { itemId: confirmation.itemId, questionId: confirmation.questionId, questionText: confirmation.questionText, confirmed: true });
  }
}
