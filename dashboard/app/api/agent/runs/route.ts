import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { AgentDispatchError, dispatchAgentRun } from "@/lib/agent-runs/dispatch";
import { listAgentProviders } from "@/lib/agent-runs/providers";
import { listAgentRuns, toAgentRunSummary } from "@/lib/agent-runs/store";

export const dynamic = "force-dynamic";

/** Recent runs plus the providers a caller can dispatch to. */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const raw = Number(new URL(req.url).searchParams.get("limit") ?? 20);
  const limit = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 100) : 20;
  const { providers, configError } = listAgentProviders();
  return NextResponse.json({
    runs: listAgentRuns(limit).map(toAgentRunSummary),
    providers: providers.map(({ spec, binPath }) => ({
      id: spec.id,
      label: spec.label,
      installed: binPath !== null,
      binPath,
      format: spec.format,
      supportsResume: spec.supportsResume,
      supportsMaxTurns: spec.supportsMaxTurns,
      custom: spec.custom,
    })),
    providersConfigError: configError ?? null,
  });
}, "agent.runs.get");

const DispatchSchema = z.object({
  provider: z.string().trim().min(1).max(32),
  prompt: z.string().trim().min(1, "prompt is required").max(32_000, "prompt too long"),
  cwd: z.string().trim().min(1, "cwd is required").max(1_000),
  title: z.string().trim().max(80).optional(),
  model: z.string().trim().max(120).optional(),
  worktree: z.boolean().optional(),
  maxTurns: z.number().int().min(1).max(500).optional(),
  depth: z.number().int().min(0).max(20).default(0),
});

/** Dispatch a run. It starts when the terminal dock opens its tab. */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, DispatchSchema);
  if (!parsed.ok) return parsed.response;
  try {
    const run = await dispatchAgentRun(parsed.data);
    return NextResponse.json({ run: toAgentRunSummary(run) }, { status: 201 });
  } catch (err) {
    if (err instanceof AgentDispatchError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}, "agent.runs.post");
