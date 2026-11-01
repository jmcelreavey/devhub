import { AgentDispatchError,dispatchAgentRun } from "../../../../lib/agent-runs/dispatch";
import { isCapacityRun,listAgentRuns,readAgentWaitingSummary,toAgentRunSummary } from "../../../../lib/agent-runs/store";
import { reconcileManagedRun } from "../../../../lib/paseo/lifecycle";
import { ensureConventionsFresh } from "../../../../lib/conventions/fresh";
import { parseGithubPrUrl } from "../../../../../../../packages/shared/ui-lib/entity-links/parse-pr";
import { parseBody,requireDashboardAuth,withErrorHandler } from "../../../../lib/api-utils";
import { httpAction } from "../../../../lib/actions/http";
import { agentDispatch, agentDispatchBodyInput, agentRuns } from "../../../../../../../packages/shared/actions/agents";
import { getTasks, ensureTasksMigrated } from "../../../../domains/tasks/storage";
import { requestedTaskProfile } from "../../../../domains/tasks/profile-request";
import { listPaseoProviders } from "../../../../lib/paseo/providers";


/** Recent runs plus the providers a caller can dispatch to. */
export const GET = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const search = new URL(req.url).searchParams;
  const scope = search.get("scope");
  if (scope === "attention" && requestedTaskProfile(req) !== null) {
    return Response.json({ error: "Profile-scoped agent attention is unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  if (search.get("summary") === "waiting") {
    return Response.json(readAgentWaitingSummary(), { headers: { "Cache-Control": "no-store" } });
  }
  const all = listAgentRuns(Number.MAX_SAFE_INTEGER);
  if (search.get("summary") === "1") return Response.json({ needsAttention: all.filter(run => run.status.state === "needs-attention").length, activeCount: all.filter(isCapacityRun).length });
  return httpAction(agentRuns, {
    input: () => ({}),
    context: () => ({ read: async () => {
      const raw = Number(search.get("limit") ?? 20);
      const limit = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 2000) : 20;
      const query = search.get("q")?.toLowerCase().slice(0, 200) || "";
      const matching = all.filter(run => {
        if (scope === "mine" && run.spec.activity?.source !== "interactive") return false;
        if (scope === "background" && (!run.spec.activity || run.spec.activity.source === "interactive" || run.spec.activity.source === "aionui" /* legacy records */)) return false;
        if (scope === "attention" && run.status.state !== "needs-attention") return false;
        return !query || [run.spec.title, run.spec.cwd, run.spec.activity?.repoName, run.spec.activity?.taskId, run.spec.activity?.jobId, run.spec.activity?.groupId].some(value => value?.toLowerCase().includes(query));
      });
      let providers: { id: string; label: string; installed: boolean; models: string[]; supportsResume: boolean; supportsMaxTurns: boolean; custom: boolean; format: string; binPath: null }[] = [];
      let configError: string | null = null;
      try {
        providers = (await listPaseoProviders()).map((p) => ({ id: p.id, label: p.label, installed: p.ready, models: p.models, supportsResume: true, supportsMaxTurns: false, custom: false, format: "text", binPath: null }));
      } catch (error) { configError = error instanceof Error ? error.message : "Start Paseo from Agents → Connection."; }
      const runs = await Promise.all(matching.slice(0, limit).map(reconcileManagedRun));
      return { runs: runs.map(toAgentRunSummary), total: matching.length, providers, providersConfigError: configError ?? null };
    } }),
    response: (body) => Response.json(body),
  })(req);
}, "agent.runs.get");

/** Dispatch directly into Paseo. Navigation belongs to the initiating window. */
export const POST = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, agentDispatchBodyInput);
  if (!parsed.ok) return parsed.response;
  return httpAction(agentDispatch, {
    input: () => parsed.data,
    context: () => ({ dispatch: async () => dispatch(req, parsed.data) }),
    response: ({ status, body }) => Response.json(body, { status }),
  })(req);
}, "agent.runs.post");

async function dispatch(req: Request, data: import("zod").output<typeof agentDispatchBodyInput>) {
  try {
    const { taskId, taskDate, action, repoName, notePath, prUrl, headSha, defer, ...input } = data;
    await ensureTasksMigrated();
    const task = taskId && taskDate ? getTasks(taskDate).find((item) => item.id === taskId) : undefined;
    if (taskId && !task) {
      return { status: 404, body: { error: "The linked task could not be found." } };
    }
    const verifiedFreshTask = task && requestedTaskProfile(req) !== null && (!action || action === "agent" || action === "plan" || action === "implement")
      ? { id: task.id, createdAt: task.createdAt }
      : undefined;
    // Review and create-PR agents read this repo's conventions through the MCP
    // tool; make sure there are some by the time they ask. Not awaited — a
    // person is waiting on the dispatch, and the tool answers with what exists.
    if (action === "review" || action === "create-pr") {
      const repoRef = (prUrl && parseGithubPrUrl(prUrl)?.repo) || repoName;
      if (repoRef) void ensureConventionsFresh(repoRef, { trigger: action }).catch(() => undefined);
    }
    const run = await dispatchAgentRun({ ...input, ...(verifiedFreshTask ? { verifiedFreshTask } : {}), activity: { source: "interactive", action: action ?? "agent", taskId, taskDate, repoName, notePath, prUrl, headSha } }, { defer: defer === true });
    return { status: 201, body: { run: toAgentRunSummary(run) } };
  } catch (err) {
    if (err instanceof AgentDispatchError) {
      return { status: err.status, body: { error: err.message, code: err.code } };
    }
    throw err;
  }
}
