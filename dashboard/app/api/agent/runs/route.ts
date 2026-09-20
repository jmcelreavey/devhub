import { AgentDispatchError,dispatchAgentRun } from "@/lib/agent-runs/dispatch";
import { listAgentRuns,toAgentRunSummary } from "@/lib/agent-runs/store";
import { aionCatalog } from "@/lib/aionui/catalog";
import { reconcileManagedRun } from "@/lib/aionui/lifecycle";
import { parseBody,requireDashboardAuth,withErrorHandler } from "@/lib/api-utils";
import { getTasks } from "@/lib/tasks/storage";
import { NextRequest,NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

/** Recent runs plus the providers a caller can dispatch to. */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const search = new URL(req.url).searchParams;
  const all = listAgentRuns(Number.MAX_SAFE_INTEGER);
  if (search.get("summary") === "1") return NextResponse.json({ needsAttention: all.filter(run => run.status.state === "needs-attention").length, activeCount: all.filter(run => ["queued", "starting", "running", "needs-attention"].includes(run.status.state)).length });
  const raw = Number(search.get("limit") ?? 20);
  const limit = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 2000) : 20;
  const scope = search.get("scope");
  const query = search.get("q")?.toLowerCase().slice(0, 200) || "";
  const matching = all.filter(run => {
    if (scope === "mine" && run.spec.activity?.source !== "interactive") return false;
    if (scope === "background" && (!run.spec.activity || run.spec.activity.source === "interactive" || run.spec.activity.source === "aionui")) return false;
    if (scope === "attention" && run.status.state !== "needs-attention") return false;
    return !query || [run.spec.title, run.spec.cwd, run.spec.activity?.repoName, run.spec.activity?.taskId, run.spec.activity?.jobId, run.spec.activity?.groupId].some(value => value?.toLowerCase().includes(query));
  });
  let providers: { id: string; label: string; installed: boolean; models: string[]; supportsResume: boolean; supportsMaxTurns: boolean; custom: boolean; format: string; binPath: null }[] = [];
  let configError: string | null = null;
  try {
    const catalog = await aionCatalog();
    providers = catalog.assistants.filter((a) => a.enabled).map((a) => ({ id: a.id, label: a.name, installed: a.agent_status === "online", models: a.models, supportsResume: true, supportsMaxTurns: false, custom: a.agent?.source === "custom", format: "text", binPath: null }));
  } catch (error) { configError = error instanceof Error ? error.message : "Connect AionUi in Agents."; }
  const runs = await Promise.all(matching.slice(0, limit).map(reconcileManagedRun));
  return NextResponse.json({
    runs: runs.map(toAgentRunSummary),
    total: matching.length,
    providers,
    providersConfigError: configError ?? null,
  });
}, "agent.runs.get");

const DispatchSchema = z.object({
  provider: z.string().trim().min(1).max(200),
  requestId: z.string().min(1).max(200).optional(),
  prompt: z.string().trim().min(1, "prompt is required").max(32_000, "prompt too long"),
  cwd: z.string().trim().min(1, "cwd is required").max(1_000),
  title: z.string().trim().max(80).optional(),
  model: z.string().trim().max(120).optional(),
  worktree: z.boolean().optional(),
  taskId: z.string().min(1).max(100).optional(),
  taskDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  action: z.enum(["plan", "implement", "resume", "agent", "review"]).optional(),
  repoName: z.string().max(200).optional(),
  notePath: z.string().max(1000).optional(),
  prUrl: z.string().url().refine(value => /^https?:\/\//.test(value)).optional(),
  headSha: z.string().regex(/^[a-f0-9]{7,64}$/).optional(),
  parentRunId: z.string().max(100).optional(),
  resumeSessionId: z.string().max(200).optional(),
  maxTurns: z.number().int().min(1).max(500).optional(),
  depth: z.number().int().min(0).max(20).default(0),
});

/** Dispatch directly into AionUi. Navigation belongs to the initiating window. */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, DispatchSchema);
  if (!parsed.ok) return parsed.response;
  try {
    const { taskId, taskDate, action, repoName, notePath, prUrl, headSha, ...input } = parsed.data;
    if (taskId && (!taskDate || !getTasks(taskDate).some((task) => task.id === taskId))) {
      return NextResponse.json({ error: "The linked task could not be found." }, { status: 404 });
    }
    const run = await dispatchAgentRun({ ...input, activity: { source: "interactive", action: action ?? "agent", taskId, taskDate, repoName, notePath, prUrl, headSha } });
    return NextResponse.json({ run: toAgentRunSummary(run) }, { status: 201 });
  } catch (err) {
    if (err instanceof AgentDispatchError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}, "agent.runs.post");
