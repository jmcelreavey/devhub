import { afterEach, describe, expect, it, vi } from "vitest";
import { record, HANDOFF_PICKUP_ACTION, type GatewayEnvelope } from "@shared/slack-gateway/protocol";
import { isTaskReadyForAgent } from "@shared/tasks/types.ts";
import { formatSlackNeed } from "@/lib/integrations/slack/needs-you-format";
import { SlackNotSentError } from "@/lib/integrations/slack/client";
import { receiverCard, safeTeamText } from "./cards";
import { TeamStore, TEAM_TTL_MS, type TeamBundle } from "./store";
import { teamFixture } from "./fixtures.test-helper";
import { TeamCollaboration } from "./collaboration";

const fixtures: ReturnType<typeof teamFixture>[] = [];
function fixture(user = "U1") { const value = teamFixture(user); fixtures.push(value); return value; }
afterEach(() => fixtures.splice(0).forEach((value) => value.cleanup()));
function tokenOf(value: unknown): string {
  const blocks = record(value).blocks as Array<{ type: string; elements?: Array<{ action_id: string; value: string }> }>;
  return blocks.find((block) => block.type === "actions")!.elements![0].value;
}
async function suggestion(current: ReturnType<typeof fixture>) {
  const ask = await current.service.ask(current.task.id, "helper");
  const event: GatewayEnvelope = { id: "helper-reply", kind: "helper_reply", teamId: "T1", userId: "U1", channelId: ask.channel, threadTs: ask.ts, deadline: Date.now() + 120000, helper: { userId: "U2", name: "helper" }, ask: { askId: ask.askId, channel: ask.channel, threadTs: ask.ts }, payload: { team_id: "T1", event_id: "reply-one", event: { type: "message", user: "U2", channel: ask.channel, ts: "3.000", text: "Keep the cached result" } } };
  await current.service.event(event);
  return { ask, event, token: tokenOf(current.env.post.mock.calls.at(-1)![0]) };
}
const bundle: TeamBundle = { version: 1, handoffId: "00000000-1111-4222-8333-444444444444", title: "APP-1 Fix the task", repo: "github.com/org/app", branch: "feature/task", jiraKey: "APP-1", reassignJira: true };
function pickupEvent(): GatewayEnvelope {
  const card = receiverCard(bundle, "owner", "Summary: Fix it\nState: Waiting\nNext steps: Resume\nQuestion: Keep the result?");
  const actions = card.blocks.find((block) => block.type === "actions");
  const value = actions && actions.type === "actions" ? actions.elements.find((element) => element.type === "button" && element.action_id === HANDOFF_PICKUP_ACTION) : undefined;
  return { id: "pickup", kind: "block_actions", teamId: "T1", userId: "U2", channelId: "D2", deadline: Date.now() + 120000, handoff: { handoffId: bundle.handoffId, fromUserId: "U1", fromName: "owner" }, payload: { actions: [value], message: { blocks: card.blocks } } };
}

describe("team asks", () => {
  it("does not mistake a G-prefixed private channel for a group DM", async () => {
    const current = fixture();
    const ask = await current.service.ask(current.task.id, "helper", "GPRIVATE");
    expect(current.service.asks.ignores(ask.channel)).toBe(false);
    expect(current.service.asks.ignores(ask.channel, ask.ts)).toBe(true);
  });
  it("hashes question identity and text rather than incidental source metadata", async () => {
    const current = fixture();
    Object.assign(current.context.question, { kind: "note" });
    const { token } = await suggestion(current);
    await current.service.asks.send(token);
    expect(current.env.deps.answer).toHaveBeenCalledOnce();
  });
  it("posts the exact question and context without acting on a helper reply", async () => {
    const current = fixture();
    const { token } = await suggestion(current);
    expect(current.env.client.askTeammate).toHaveBeenCalledWith(expect.objectContaining({ helperUserId: "U2", text: expect.stringContaining("Keep the last result?") }));
    expect(current.env.deps.answer).not.toHaveBeenCalled();
    expect(current.env.post).toHaveBeenCalledWith(expect.objectContaining({ text: "Suggested answer from @helper" }));
    expect(await current.service.asks.preview(token)).toEqual({ question: "Keep the last result?", answer: "Keep the cached result", taskId: "task-one" });
    await current.service.asks.send(token);
    expect(current.env.deps.answer).toHaveBeenCalledExactlyOnceWith("work", "task-one", "Keep the cached result", "team-answer-" + token);
    await expect(current.service.asks.send(token)).rejects.toThrow("already handled");
  });
  it.each(["wrong-user", "wrong-device"])("refuses %s without consuming the owner's suggestion", async (kind) => {
    const current = fixture(); const { token } = await suggestion(current);
    const who = { ...current.env.audience(), ...(kind === "wrong-user" ? { userId: "U2" } : { deviceId: "other-device" }) };
    await expect(current.service.asks.send(token, undefined, false, who)).rejects.toThrow();
    expect(current.env.deps.answer).not.toHaveBeenCalled();
    await current.service.asks.send(token);
    expect(current.env.deps.answer).toHaveBeenCalledTimes(1);
  });
  it("refuses stale questions and never forwards a reply without a click", async () => {
    const current = fixture(); const { event } = await suggestion(current);
    current.questions.questions[0].text = "A different question";
    await current.service.event({ ...event, id: "helper-again" });
    expect(JSON.stringify(current.env.post.mock.calls.at(-1))).toContain("already answered");
    expect(current.env.deps.answer).not.toHaveBeenCalled();
  });
  it("rechecks the question at approval and accepts owner edits only", async () => {
    const current = fixture(); const { token } = await suggestion(current);
    current.questions.questions[0].text = "Changed";
    await expect(current.service.asks.send(token)).rejects.toThrow("changed");
    expect(current.env.deps.answer).not.toHaveBeenCalled();
    current.questions.questions[0].text = "Keep the last result?";
    const next = await suggestion(current);
    await current.service.asks.send(next.token, "Keep it for five minutes");
    expect(current.env.deps.answer).toHaveBeenCalledWith("work", "task-one", "Keep it for five minutes", expect.any(String));
  });
  it("dismisses and expires suggestions without answering", async () => {
    const current = fixture(); const first = await suggestion(current);
    await current.service.asks.send(first.token, undefined, true);
    const second = await suggestion(current); current.advance(11 * 60000);
    await expect(current.service.asks.send(second.token)).rejects.toThrow();
    expect(current.env.deps.answer).not.toHaveBeenCalled();
  });
  it("recognises owner ask threads, including top-level group DM messages, without routing", async () => {
    const current = fixture(); const { ask } = await suggestion(current);
    expect(current.service.asks.ignores(ask.channel, ask.ts)).toBe(true);
    expect(current.service.asks.ignores(ask.channel)).toBe(true);
    expect(current.service.asks.ignores("COTHER", ask.ts)).toBe(false);
    expect(new TeamStore(current.root).read().asks[ask.askId].question).toBe(ask.question);
  });
  it("rejects unknown teammates and empty question sets", async () => {
    const current = fixture();
    await expect(current.service.ask(current.task.id, "stranger")).rejects.toThrow("linked teammate");
    current.context.question = { id: "", text: "" };
    await expect(current.service.ask(current.task.id, "helper")).rejects.toThrow("no open question");
  });
});
describe("team handoff", () => {
  it("retires a failed import only after the gateway confirms non-acceptance", async () => {
    const receiver = fixture("U2");
    receiver.env.deps.writeNote.mockImplementationOnce(() => { throw new Error("import failed"); });
    await expect(receiver.service.event(pickupEvent())).rejects.toThrow("import failed");
    expect(receiver.env.client.handoffResolve).toHaveBeenCalledExactlyOnceWith(bundle.handoffId, "failed");
    expect(receiver.tasks.get(bundle.handoffId)?.abandonedAt).toBeTruthy();
    expect(receiver.tasks.get(bundle.handoffId)?.teamPickup?.cwd).toBe("/fake/worktree");
    expect(receiver.env.deps.assignJira).not.toHaveBeenCalled();
  });
  it("keeps a failed import blocked when its failed-resolution acknowledgement is also lost", async () => {
    const receiver = fixture("U2");
    receiver.env.deps.writeNote.mockImplementationOnce(() => { throw new Error("import failed"); });
    vi.mocked(receiver.env.client.handoffResolve).mockRejectedValueOnce(new Error("reply lost"));
    await expect(receiver.service.event(pickupEvent())).rejects.toThrow("import failed");
    expect(receiver.tasks.get(bundle.handoffId)?.abandonedAt).toBeUndefined();
    expect(receiver.tasks.get(bundle.handoffId)?.teamPickup?.status).toBe("pending");
  });
  it("releases definite non-delivery immediately", async () => {
    const current = fixture();
    vi.mocked(current.env.client.handoff).mockRejectedValueOnce(new SlackNotSentError("not sent"));
    const preview = await current.service.handoff(current.task.id, "helper");
    await expect(current.service.handoffs.confirm(preview.token)).rejects.toThrow("not sent");
    expect(current.task.handoff).toBeUndefined();
  });
  it("releases an unknown receipt only after the two-minute creation grace", async () => {
    const current = fixture();
    const preview = await current.service.handoff(current.task.id, "helper");
    await current.service.handoffs.confirm(preview.token);
    const handoffId = current.task.handoff!.handoffId;
    vi.mocked(current.env.client.handoffStatus).mockResolvedValue([{ handoffId, status: "unknown" }]);
    await current.service.handoffs.reconcile();
    expect(current.task.handoff?.status).toBe("pending");
    current.advance(120_000);
    await current.service.handoffs.reconcile();
    expect(current.task.handoff).toBeUndefined();
  });
  it("rechecks an unknown receipt under the owner lock after a slow push finishes", async () => {
    const current = fixture();
    let finishPush: () => void = () => {};
    current.env.deps.push.mockImplementationOnce(() => new Promise<undefined>((resolve) => { finishPush = () => resolve(undefined); }));
    vi.mocked(current.env.client.handoffStatus).mockResolvedValue([{ handoffId: "unused", status: "unknown" }]);
    const preview = await current.service.handoff(current.task.id, "helper");
    const sending = current.service.handoffs.confirm(preview.token);
    await vi.waitFor(() => expect(current.env.deps.push).toHaveBeenCalled());
    const handoffId = current.task.handoff!.handoffId;
    vi.mocked(current.env.client.handoffStatus).mockResolvedValue([{ handoffId, status: "unknown" }]);
    current.advance(120_000);
    const reconciling = current.service.handoffs.reconcile();
    await vi.waitFor(() => expect(current.env.client.handoffStatus).toHaveBeenCalled());
    vi.mocked(current.env.client.handoff).mockImplementationOnce(async () => {
      vi.mocked(current.env.client.handoffStatus).mockResolvedValue([{ handoffId, status: "pending" }]);
      return { channel: "D2", ts: "2.000" };
    });
    finishPush();
    await Promise.all([sending, reconciling]);
    expect(current.task.handoff?.status).toBe("pending");
    expect(current.env.store.read().handoffs[handoffId].status).toBe("pending");
  });
  it("keeps a lost acceptance acknowledgement blocked until authoritative reconciliation", async () => {
    const receiver = fixture("U2");
    vi.mocked(receiver.env.client.handoffResolve).mockRejectedValueOnce(new Error("reply lost"));
    await expect(receiver.service.event(pickupEvent())).rejects.toThrow("reply lost");
    const task = receiver.tasks.get(bundle.handoffId)!;
    expect(task.teamPickup).toMatchObject({ status: "pending", cwd: "/fake/worktree", branch: bundle.branch });
    expect(isTaskReadyForAgent({ ...task, stage: undefined })).toBe(false);
    vi.mocked(receiver.env.client.handoffStatus).mockResolvedValueOnce([{ handoffId: bundle.handoffId, status: "unknown" }]);
    await receiver.service.handoffs.reconcile();
    expect(receiver.env.deps.finishPickup).not.toHaveBeenCalled();
    vi.mocked(receiver.env.client.handoffStatus).mockResolvedValue([{ handoffId: bundle.handoffId, status: "accepted", byUserId: "U2" }]);
    const restarted = new TeamCollaboration({ ...receiver.env, store: new TeamStore(receiver.root, receiver.env.store.now) });
    await restarted.handoffs.reconcile();
    await restarted.handoffs.reconcile();
    expect(receiver.env.deps.finishPickup).toHaveBeenCalledTimes(1);
    expect(receiver.env.deps.fetchWorktree).toHaveBeenCalledTimes(1);
    expect(receiver.env.store.read().pickups[bundle.handoffId].resolved).toBe(true);
    expect(isTaskReadyForAgent(task)).toBe(true);
  });
  it.each(["declined", "expired"] as const)("retires a %s pickup without deleting its checkout", async (status) => {
    const receiver = fixture("U2");
    vi.mocked(receiver.env.client.handoffResolve).mockRejectedValueOnce(new Error("not accepted"));
    await expect(receiver.service.event(pickupEvent())).rejects.toThrow();
    vi.mocked(receiver.env.client.handoffStatus).mockResolvedValueOnce([{ handoffId: bundle.handoffId, status, byUserId: "U2" }]);
    await receiver.service.handoffs.reconcile();
    const task = receiver.tasks.get(bundle.handoffId)!;
    expect(task.abandonedAt).toBeTruthy();
    expect(task.abandonReason).toBe("Handoff was declined/expired");
    expect(task.teamPickup?.cwd).toBe("/fake/worktree");
    expect(receiver.env.deps.finishPickup).not.toHaveBeenCalled();
    expect(receiver.env.post).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining("worktree was kept") }));
  });
  it("refuses a dirty confirmation when WIP commits were explicitly ruled out", async () => {
    const current = fixture();
    current.env.deps.inspect.mockResolvedValueOnce({ cwd: "/fake/repo", branch: "feature/task", repo: "github.com/org/app", files: ["app.ts"], fingerprint: "dirty" });
    await expect(current.service.handoff(current.task.id, "helper", true, false)).rejects.toThrow("Commit them yourself");
    expect(current.env.deps.cancelRuns).not.toHaveBeenCalled();
    expect(current.env.deps.push).not.toHaveBeenCalled();
  });
  it("checks overdue handoffs without inventing expiry while the gateway still says pending", async () => {
    const current = fixture();
    const preview = await current.service.handoff(current.task.id, "helper");
    await current.service.handoffs.confirm(preview.token);
    current.advance(TEAM_TTL_MS + 1);
    vi.mocked(current.env.client.handoffStatus).mockResolvedValueOnce([{ handoffId: current.task.handoff!.handoffId, status: "pending" }]);
    await current.service.handoffs.reconcile();
    expect(current.env.client.handoffStatus).toHaveBeenCalled();
    expect(current.task.handoff?.status).toBe("pending");
  });
  it("does not activate a receiver task when resolution fails or is uncertain", async () => {
    const receiver = fixture("U2");
    vi.mocked(receiver.env.client.handoffResolve).mockRejectedValueOnce(new Error("unknown outcome"));
    await expect(receiver.service.event(pickupEvent())).rejects.toThrow("unknown outcome");
    expect(receiver.env.deps.finishPickup).not.toHaveBeenCalled();
    expect(receiver.tasks.get(bundle.handoffId)?.stage).toBe("draft");
  });
  it("does nothing until confirmation, then stops, pushes and makes the task read-only", async () => {
    const current = fixture(); const preview = await current.service.handoff(current.task.id, "helper");
    expect(current.env.deps.push).not.toHaveBeenCalled();
    expect(current.env.deps.cancelRuns).not.toHaveBeenCalled();
    await current.service.handoffs.confirm(preview.token);
    expect(current.env.deps.cancelRuns).toHaveBeenCalledTimes(1);
    expect(current.env.deps.push).toHaveBeenCalledTimes(1);
    expect(current.task.handoff?.status).toBe("pending");
    expect(isTaskReadyForAgent(current.task)).toBe(false);
    expect(current.env.deps.writeNote).toHaveBeenCalledWith(current.task, "work", expect.stringContaining("Handed to: @helper"));
    await expect(current.service.handoffs.confirm(preview.token)).rejects.toThrow("already handled");
  });
  it("refuses expired, wrong-device and changed-context confirmations before git", async () => {
    const current = fixture(); const preview = await current.service.handoff(current.task.id, "helper");
    await expect(current.service.handoffs.confirm(preview.token, undefined, false, { ...current.env.audience(), deviceId: "wrong" })).rejects.toThrow();
    current.context.sections.push("Changed plan");
    await expect(current.service.handoffs.confirm(preview.token)).rejects.toThrow("changed");
    const next = await current.service.handoff(current.task.id, "helper"); current.advance(11 * 60000);
    await expect(current.service.handoffs.confirm(next.token)).rejects.toThrow();
    expect(current.env.deps.push).not.toHaveBeenCalled();
  });
  it("stops on push or hook failure and returns control without sending a card", async () => {
    const current = fixture(); current.env.deps.push.mockRejectedValueOnce(new Error("hook failed"));
    const preview = await current.service.handoff(current.task.id, "helper");
    await expect(current.service.handoffs.confirm(preview.token)).rejects.toThrow("hook failed");
    expect(current.task.handoff).toBeUndefined(); expect(current.env.client.handoff).not.toHaveBeenCalled();
  });
  it.each(["accepted", "declined", "expired"] as const)("reconciles %s and keeps or returns control", async (status) => {
    const current = fixture(); const preview = await current.service.handoff(current.task.id, "helper"); await current.service.handoffs.confirm(preview.token);
    const handoffId = current.task.handoff!.handoffId;
    vi.mocked(current.env.client.handoffStatus).mockResolvedValueOnce([{ handoffId, status, byUserId: "U2" }]);
    await current.service.handoffs.reconcile();
    expect(current.task.handoff?.status).toBe(status === "accepted" ? "accepted" : undefined);
    expect(current.env.store.read().handoffs[handoffId].status).toBe(status);
    if (status === "accepted") expect(isTaskReadyForAgent(current.task)).toBe(false);
  });
  it("keeps an uncertain remote send read-only rather than silently retrying", async () => {
    const current = fixture(); vi.mocked(current.env.client.handoff).mockRejectedValueOnce(new Error("outcome unknown"));
    const preview = await current.service.handoff(current.task.id, "helper"); await expect(current.service.handoffs.confirm(preview.token)).rejects.toThrow();
    expect(current.task.handoff?.status).toBe("pending");
  });
  it("leaves a missing clone pending and a Pick up click usable", async () => {
    const receiver = fixture("U2"); receiver.env.deps.repos.mockResolvedValueOnce([]);
    await receiver.service.event(pickupEvent());
    expect(receiver.env.client.handoffResolve).not.toHaveBeenCalled(); expect(receiver.env.deps.createPickup).not.toHaveBeenCalled();
    expect(receiver.env.post).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining("Clone github.com/org/app first") }));
    await receiver.service.event(pickupEvent()); expect(receiver.env.client.handoffResolve).toHaveBeenCalledWith(bundle.handoffId, "accepted");
  });
  it("picks up once, imports the note, becomes owner and uses receiver Jira credentials", async () => {
    const receiver = fixture("U2");
    await receiver.service.event(pickupEvent()); await receiver.service.event(pickupEvent());
    expect(receiver.env.deps.createPickup).toHaveBeenCalledTimes(1);
    expect(receiver.env.deps.fetchWorktree).toHaveBeenCalledExactlyOnceWith("/fake/repo", "feature/task", bundle.handoffId);
    expect(receiver.env.deps.assignJira).toHaveBeenCalledExactlyOnceWith("APP-1", bundle.handoffId);
    expect(receiver.tasks.get(bundle.handoffId)?.handoff).toBeUndefined();
    expect(receiver.tasks.get(bundle.handoffId)?.teamPickup?.cwd).toBe("/fake/worktree");
    expect(receiver.env.deps.writeNote).toHaveBeenCalledWith(expect.any(Object), "work", expect.stringContaining("Next steps: Resume"));
  });
  it("keeps Jira failure non-fatal and reports it", async () => {
    const receiver = fixture("U2"); receiver.env.deps.assignJira.mockRejectedValueOnce(new Error("credentials"));
    await receiver.service.event(pickupEvent());
    expect(receiver.env.client.handoffResolve).toHaveBeenCalledWith(bundle.handoffId, "accepted");
    expect(receiver.env.post).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining("Jira could not be reassigned") }));
  });
  it("rejects a mismatched pickup bundle before fetching", async () => {
    const receiver = fixture("U2"); const event = pickupEvent(); event.handoff!.handoffId = "wrong";
    await expect(receiver.service.event(event)).rejects.toThrow("does not match"); expect(receiver.env.deps.fetchWorktree).not.toHaveBeenCalled();
  });
});
describe("team cards", () => {
  it("keeps direct card output unchanged and appends team controls only on request", () => {
    const need = { profile: "work", entityId: "task:one", taskId: "one", itemKey: "question", title: "Task", needed: "Choose a repo", action: "answer" as const, href: "/work" };
    expect(formatSlackNeed(need, "id", "D1")).toEqual(formatSlackNeed(need, "id", "D1", undefined, undefined, false));
    expect(JSON.stringify(formatSlackNeed(need, "id", "D1"))).not.toContain("devhub_team_");
    expect(JSON.stringify(formatSlackNeed(need, "id", "D1", undefined, undefined, true))).toContain("Ask a teammate…");
  });
  it("escapes Slack markup and removes mass and user mentions", () => {
    expect(safeTeamText("<!here> <@U1> <script> &")).toBe("  &lt;script&gt; &amp;");
  });
  it("asks expire locally after 24 hours", async () => {
    const current = fixture(); const { ask, event } = await suggestion(current); current.advance(TEAM_TTL_MS + 1);
    const posted = current.env.post.mock.calls.length; await current.service.event(event);
    expect(current.env.post).toHaveBeenCalledTimes(posted); expect(current.service.asks.ignores(ask.channel, ask.ts)).toBe(true);
  });
});
