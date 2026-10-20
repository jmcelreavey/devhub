import { randomUUID } from "node:crypto";
import { record, type GatewayEnvelope } from "@shared/slack-gateway/protocol";
import { slackDashboardBaseUrl, slackTextMessage } from "@/lib/integrations/slack/format";
import { teamHash } from "./context";
import { askCard, suggestionCard } from "./cards";
import { sameTeamAudience, TEAM_TTL_MS, type TeamAsk } from "./store";
import { assertTeamActive, type TeamEnvironment } from "./environment";

export class TeamAsks {
  constructor(private readonly env: TeamEnvironment) {}
  async ask(taskId: string, helperUserId: string, channel?: string): Promise<TeamAsk> {
    const env = this.env;
    assertTeamActive(env);
    if (channel && !/^[CG][A-Z0-9]+$/.test(channel)) throw new Error("Use a Slack channel ID beginning C or G.");
    const audience = env.audience();
    const context = await env.deps.context(taskId, audience.profile);
    if (!context.question.id || !context.question.text) throw new Error("This task has no open question to ask about.");
    const askId = randomUUID();
    const content = askCard(context.sections, channel);
    const receipt = await env.client.askTeammate({ askId, helperUserId, channel, ...content });
    const createdAt = env.store.now();
    const ask: TeamAsk = { ...audience, askId, taskId, question: context.question.text, questionId: context.question.id, questionHash: teamHash({ id: context.question.id, text: context.question.text }), helperUserId, channel: receipt.channel, groupDm: !channel, ts: receipt.ts, createdAt, expiresAt: createdAt + TEAM_TTL_MS, status: "active" };
    await env.store.change((state) => { state.asks[askId] = ask; });
    return ask;
  }
  ignores(channel: string, threadTs?: string): boolean {
    const audience = this.env.audience();
    return Object.values(this.env.store.read().asks).some((ask) => sameTeamAudience(ask, { ...audience, profile: ask.profile }) && ask.channel === channel && (ask.ts === threadTs || (!threadTs && ask.groupDm)));
  }
  private current(ask: TeamAsk): boolean {
    const current = this.env.deps.questions(ask.profile, ask.taskId);
    const question = current.questions[0];
    return !current.closed && !!question && question.id === ask.questionId && question.text === ask.question && teamHash({ id: question.id, text: question.text }) === ask.questionHash;
  }
  async helperReply(event: GatewayEnvelope): Promise<void> {
    const env = this.env;
    const ask = event.ask && env.store.read().asks[event.ask.askId];
    if (!ask || !sameTeamAudience(ask, { ...env.audience(), profile: ask.profile }) || event.helper?.userId !== ask.helperUserId || event.userId !== ask.userId || event.teamId !== ask.teamId || event.ask?.channel !== ask.channel || event.ask.threadTs !== ask.ts || ask.expiresAt <= env.store.now() || ask.status !== "active") return;
    const reply = record(record(event.payload).event).text;
    if (typeof reply !== "string" || !reply.trim() || reply.length > 12000) return;
    const token = this.current(ask) ? await env.confirms.create({ kind: "run", tool: "team_send_answer", args: { askId: ask.askId, questionHash: ask.questionHash, reply, replyHash: teamHash(reply) }, ...env.audience(), profile: ask.profile, channel: env.channel }) : undefined;
    const message = suggestionCard(env.channel, event.helper!.name, ask.question, reply, token);
    if (token) for (const block of message.blocks ?? []) {
      if (block.type === "actions") for (const element of block.elements) if (element.type === "button" && element.action_id === "devhub_team_edit") element.url = slackDashboardBaseUrl() + "/team/answer?token=" + encodeURIComponent(token);
    }
    await env.post(message);
  }
  async preview(token: string): Promise<{ question: string; answer: string; taskId: string }> {
    const env = this.env;
    const entry = env.confirms.peek(token);
    const audience = env.audience();
    if (!entry || entry.tool !== "team_send_answer" || entry.state !== "pending" || entry.expiresAt <= env.store.now() || entry.userId !== audience.userId || entry.teamId !== audience.teamId || entry.deviceId !== audience.deviceId) throw new Error("That suggested answer has expired or belongs to another session.");
    const ask = env.store.read().asks[String(entry.args.askId)];
    if (!ask || !sameTeamAudience(ask, { ...audience, profile: entry.profile }) || !this.current(ask) || typeof entry.args.reply !== "string") throw new Error("That question changed or was already answered.");
    return { question: ask.question, answer: entry.args.reply, taskId: ask.taskId };
  }
  async send(token: string, edited?: string, dismiss = false, who = this.env.audience(), channel = this.env.channel): Promise<void> {
    const env = this.env;
    assertTeamActive(env);
    const claim = await env.confirms.claim(token, { ...who, channel }, dismiss ? "cancelled" : "consumed", "run");
    if (!claim.ok || claim.entry.tool !== "team_send_answer") throw new Error("That suggested answer has expired or was already handled.");
    const entry = claim.entry;
    const ask = env.store.read().asks[String(entry.args.askId)];
    if (dismiss) return;
    if (!ask || !sameTeamAudience(ask, { ...env.audience(), profile: entry.profile }) || entry.profile !== ask.profile || !this.current(ask) || entry.args.questionHash !== ask.questionHash || teamHash(entry.args.reply) !== entry.args.replyHash) throw new Error("That question changed or was already answered. Nothing was sent to the agent.");
    const answer = edited ?? String(entry.args.reply);
    if (!answer.trim() || answer.length > 12000) throw new Error("Use an answer between 1 and 12,000 characters.");
    await env.store.lock("answer-" + ask.taskId, async () => {
      if (!this.current(ask)) throw new Error("That question changed or was already answered.");
      await env.deps.answer(ask.profile, ask.taskId, answer, "team-answer-" + token);
      await env.store.change((state) => { state.asks[ask.askId].status = "answered"; });
    });
    await env.post(slackTextMessage(env.channel, "Answer sent."));
  }
}

