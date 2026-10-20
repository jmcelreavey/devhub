import { randomUUID } from "node:crypto";
import { record, type GatewayEnvelope, type GatewayHandoffStatus } from "@shared/slack-gateway/protocol";
import { classifySlackFailure } from "@/lib/integrations/slack/client";
import { slackTextMessage } from "@/lib/integrations/slack/format";
import { teamHash } from "./context";
import { handoffConfirmCard, handedToCard, receiverCard } from "./cards";
import { TeamBundleSchema, sameTeamAudience, TEAM_TTL_MS, type TeamBundle, type TeamHandoff, type TeamAudience, type TeamPickup } from "./store";
import { assertTeamActive, type TeamEnvironment } from "./environment";
import type { HandoffGitState } from "./git";

export interface TeamHandoffPreview { token: string; name: string; files: string[]; jira: boolean; reassignJira: boolean; commitWip: boolean }
export class TeamHandoffs {
  constructor(private readonly env: TeamEnvironment) {}
  async prepare(taskId: string, toUserId: string, toName: string, reassignJira?: boolean, commitWip?: boolean): Promise<TeamHandoffPreview> {
    const env = this.env;
    assertTeamActive(env);
    const audience = env.audience();
    const context = await env.deps.context(taskId, audience.profile);
    if (!context.cwd || !context.branch) throw new Error("This task needs its own checkout and branch before it can be handed off.");
    const gitState = await env.deps.inspect(context.cwd, context.branch);
    if (gitState.files.length && commitWip === false) throw new Error("This checkout has uncommitted changes. Commit them yourself or request a Commit WIP and push confirmation.");
    const jira = !!context.task.jiraKey && env.deps.jiraConnected();
    const reassign = jira && (reassignJira ?? true);
    const token = await env.confirms.create({ kind: "run", tool: "team_handoff", ...audience, channel: env.channel, args: { taskId, toUserId, toName, reassignJira: reassign, commitWip: gitState.files.length > 0 && commitWip !== false, contextHash: teamHash(context.sections), gitState } });
    return { token, name: toName, files: gitState.files, jira, reassignJira: reassign, commitWip: gitState.files.length > 0 };
  }
  async postPreview(preview: TeamHandoffPreview): Promise<void> {
    await this.env.post(handoffConfirmCard(this.env.channel, preview.name, preview.files, preview.token, preview.jira, preview.reassignJira));
  }
  async confirm(token: string, reassignJira?: boolean, cancel = false, who = this.env.audience(), channel = this.env.channel): Promise<void> {
    const env = this.env;
    assertTeamActive(env);
    const claim = await env.confirms.claim(token, { ...who, channel }, cancel ? "cancelled" : "consumed", "run");
    if (!claim.ok || claim.entry.tool !== "team_handoff") throw new Error("That handoff confirmation has expired or was already handled.");
    if (cancel) return;
    const entry = claim.entry;
    if (entry.profile !== env.audience().profile) throw new Error("Switch back to the task's profile before handing it off.");
    const args = entry.args;
    const taskId = String(args.taskId);
    await env.store.lock("handoff-" + taskId, async () => {
      const context = await env.deps.context(taskId, entry.profile);
      if (teamHash(context.sections) !== args.contextHash) throw new Error("The task changed. Review a new handoff confirmation.");
      const gitState = args.gitState as HandoffGitState;
      if (!context.cwd || context.cwd !== gitState.cwd || context.branch !== gitState.branch) throw new Error("The task's checkout changed. Review a new handoff confirmation.");
      const handoffId = randomUUID();
      const toUserId = String(args.toUserId);
      const toName = String(args.toName);
      const bundle = TeamBundleSchema.parse({ version: 1, handoffId, title: context.task.text, repo: gitState.repo, branch: gitState.branch, jiraKey: context.task.jiraKey, prUrl: context.prUrl, reassignJira: !!args.reassignJira && reassignJira !== false });
      const note = context.note + "\n\nBranch: " + bundle.branch + "\nHanded to: @" + toName + "\nTime: " + new Date(env.store.now()).toISOString();
      const card = receiverCard(bundle, env.ownerName, note);
      const handoff: TeamHandoff = { ...env.audience(), taskId, handoffId, toUserId, toName, createdAt: env.store.now(), expiresAt: env.store.now() + TEAM_TTL_MS, status: "pending", bundle };
      await env.store.change((state) => { state.handoffs[handoffId] = handoff; });
      env.deps.setHandoff(taskId, entry.profile, { handoffId, toUserId, toName, expiresAt: handoff.expiresAt, status: "pending" });
      let sending = false;
      try {
        await env.deps.cancelRuns(context);
        await env.deps.push(gitState, toName, args.commitWip === true);
        env.deps.writeNote(context.task, entry.profile, note);
        assertTeamActive(env);
        sending = true;
        await env.client.handoff({ handoffId, toUserId, ...card });
      } catch (error) {
        if (!sending || classifySlackFailure(error).kind === "not-sent") {
          env.deps.setHandoff(taskId, entry.profile, undefined);
          await env.store.change((state) => { state.handoffs[handoffId].status = "declined"; });
        }
        throw error;
      }
      await env.post(handedToCard(env.channel, toName, false));
    });
  }
  async result(result: GatewayHandoffStatus, audience: TeamAudience = this.env.audience()): Promise<void> {
    const env = this.env;
    const handoff = env.store.read().handoffs[result.handoffId];
    if (!handoff || !sameTeamAudience(handoff, { ...audience, profile: handoff.profile }) || (result.byUserId && result.byUserId !== handoff.toUserId) || result.status === "pending" || handoff.status !== "pending") return;
    if (result.status === "unknown" && env.store.now() - (handoff.createdAt ?? handoff.expiresAt - TEAM_TTL_MS) < 120_000) return;
    const applied = await env.store.lock("handoff-" + handoff.taskId, async () => {
      if (env.store.read().handoffs[handoff.handoffId]?.status !== "pending") return null;
      const confirmed = result.status === "unknown" ? (await env.client.handoffStatus([handoff.handoffId])).find((entry) => entry.handoffId === handoff.handoffId) : result;
      if (!confirmed || confirmed.status === "pending" || (confirmed.byUserId && confirmed.byUserId !== handoff.toUserId)) return null;
      const status = confirmed.status === "unknown" ? "expired" : confirmed.status;
      const task = env.deps.getTask(handoff.taskId, handoff.profile);
      if (task?.handoff?.handoffId === handoff.handoffId) env.deps.setHandoff(task.id, handoff.profile, status === "accepted" ? { ...task.handoff, status: "accepted" } : undefined);
      await env.store.change((state) => { state.handoffs[handoff.handoffId].status = status; });
      return confirmed.status;
    });
    if (!applied) return;
    await env.post(applied === "accepted" ? handedToCard(env.channel, handoff.toName, true) : slackTextMessage(env.channel, "Your handoff to @" + handoff.toName + (applied === "unknown" ? " wasn't received. It's yours again." : applied === "declined" ? " was declined. It's yours again." : " expired. It's yours again.")));
  }
  async reconcile(): Promise<void> {
    const env = this.env;
    assertTeamActive(env);
    const pending = Object.values(env.store.read().handoffs).filter((entry) => entry.status === "pending" && sameTeamAudience(entry, { ...env.audience(), profile: entry.profile }));
    const pickups = Object.values(env.store.read().pickups).filter((entry) => !entry.resolved && sameTeamAudience(entry, { ...env.audience(), profile: entry.profile }));
    for (const pickup of pickups) await env.store.lock("pickup-" + pickup.handoffId, async () => {
      if (!env.store.read().pickups[pickup.handoffId]?.resolved && pickup.cwd && pickup.branch) env.deps.holdPickup(pickup.taskId, pickup.profile, pickup.handoffId, { cwd: pickup.cwd, branch: pickup.branch });
    });
    const ids = [...new Set([...pending, ...pickups].map((entry) => entry.handoffId))];
    for (let offset = 0; offset < ids.length; offset += 50) {
      const statuses = await env.client.handoffStatus(ids.slice(offset, offset + 50));
      for (const status of statuses) {
        await this.result(status);
        await env.store.lock("pickup-" + status.handoffId, () => this.pickupResult(status));
      }
    }
  }
  private async pickupResult(result: GatewayHandoffStatus): Promise<void> {
    const env = this.env;
    const progress = env.store.read().pickups[result.handoffId];
    if (!progress || progress.resolved || !sameTeamAudience(progress, { ...env.audience(), profile: progress.profile }) || (result.byUserId && result.byUserId !== progress.userId)) return;
    if (result.status === "accepted" && progress.imported) await this.finishPickup(progress);
    else if (result.status === "declined" || result.status === "expired") {
      env.deps.retirePickup(progress.taskId, progress.profile);
      await env.store.change((state) => { state.pickups[progress.handoffId].resolved = true; });
      await env.post(slackTextMessage(env.channel, "Handoff was declined/expired. The imported draft was closed; your worktree was kept."));
    }
  }
  private async finishPickup(progress: TeamPickup): Promise<void> {
    const env = this.env;
    if (!progress.cwd || !progress.branch) throw new Error("The pickup checkout is missing.");
    const bundle = progress.bundle;
    if (bundle?.reassignJira && bundle.jiraKey && !progress.jiraAttempted) {
      await env.store.change((state) => { state.pickups[progress.handoffId].jiraAttempted = true; });
      try {
        if (!env.deps.jiraConnected()) throw new Error("Jira is not connected");
        await env.deps.assignJira(bundle.jiraKey, bundle.handoffId);
      } catch {
        await env.store.change((state) => { state.pickups[progress.handoffId].warning = "Picked up, but Jira could not be reassigned. Update the assignee in Jira."; });
      }
    }
    env.deps.finishPickup(progress.taskId, progress.profile, bundle ?? { handoffId: progress.handoffId, jiraKey: env.deps.getTask(progress.taskId, progress.profile)?.jiraKey }, { cwd: progress.cwd, branch: progress.branch });
    await env.store.change((state) => { state.pickups[progress.handoffId].resolved = true; });
    await env.post(slackTextMessage(env.channel, env.store.read().pickups[progress.handoffId].warning ?? "Picked up"));
  }
  async pickup(event: GatewayEnvelope): Promise<void> {
    const env = this.env;
    assertTeamActive(env);
    if (!event.handoff || event.userId !== env.audience().userId || event.teamId !== env.audience().teamId) return;
    const body = record(event.payload);
    const actions = Array.isArray(body.actions) ? body.actions.map(record) : [];
    let bundle: TeamBundle;
    try { bundle = TeamBundleSchema.parse(JSON.parse(String(actions[0]?.value))); }
    catch { throw new Error("That handoff card is incomplete. Ask the owner to send it again."); }
    if (bundle.handoffId !== event.handoff.handoffId) throw new Error("The handoff does not match this card.");
    await env.store.lock("pickup-" + bundle.handoffId, async () => {
      let progress = env.store.read().pickups[bundle.handoffId];
      if (progress && !sameTeamAudience(progress, env.audience())) throw new Error("This handoff belongs to another local session.");
      if (progress?.resolved) return;
      if (!progress?.cwd) {
        const repo = (await env.deps.repos()).find((entry) => entry.origin === bundle.repo);
        if (!repo) { await env.post(slackTextMessage(env.channel, "Clone " + bundle.repo + " first, then click Pick up again")); return; }
        const checkout = await env.deps.fetchWorktree(repo.path, bundle.branch, bundle.handoffId);
        const task = env.deps.createPickup(bundle, env.audience().profile, checkout);
        progress = { ...env.audience(), handoffId: bundle.handoffId, taskId: task.id, createdAt: env.store.now(), ...checkout, bundle, imported: false, resolved: false, jiraAttempted: false };
        await env.store.change((state) => { state.pickups[bundle.handoffId] = progress!; });
      }
      if (!progress.branch) throw new Error("The pickup branch is missing.");
      env.deps.holdPickup(progress.taskId, progress.profile, progress.handoffId, { cwd: progress.cwd!, branch: progress.branch });
      if (!progress.imported) {
        try {
          const blocks = record(body.message).blocks;
          const note = (Array.isArray(blocks) ? blocks.map(record) : []).filter((block) => typeof block.block_id === "string" && /^team_handoff_note_\d+$/.test(block.block_id)).map((block) => record(block.text).text).filter((text): text is string => typeof text === "string").join("");
          if (!note || note.length > 28800) throw new Error("The handoff note is missing. Ask the owner to send a new card.");
          const task = env.deps.getTask(progress.taskId, progress.profile);
          if (!task) throw new Error("The pickup task is missing.");
          env.deps.writeNote(task, progress.profile, note);
          await env.store.change((state) => { state.pickups[bundle.handoffId].imported = true; });
        } catch (error) {
          let failed = false;
          try { await env.client.handoffResolve(bundle.handoffId, "failed"); failed = true; }
          catch {
            const statuses = await env.client.handoffStatus([bundle.handoffId]).catch(() => []);
            const status = statuses.find((entry) => entry.handoffId === bundle.handoffId);
            if (status) await this.pickupResult(status);
          }
          if (failed) await this.pickupResult({ handoffId: bundle.handoffId, status: "expired", byUserId: progress.userId });
          throw error;
        }
      }
      try {
        await env.client.handoffResolve(bundle.handoffId, "accepted");
      } catch (error) {
        const statuses = await env.client.handoffStatus([bundle.handoffId]).catch(() => []);
        const status = statuses.find((entry) => entry.handoffId === bundle.handoffId);
        if (status && status.status !== "pending" && status.status !== "unknown") { await this.pickupResult(status); return; }
        await env.post(slackTextMessage(env.channel, "Pickup could not be confirmed. The imported task is read-only until the gateway confirms ownership."));
        throw error;
      }
      await this.finishPickup(env.store.read().pickups[bundle.handoffId]);
    });
  }
}
