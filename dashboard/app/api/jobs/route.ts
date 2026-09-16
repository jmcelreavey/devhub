import { NextRequest, NextResponse } from "next/server";
import { listJobs, createJob, getWakeState } from "@/lib/scheduler";
import { getAllowedScripts, type AllowedScript } from "@/lib/scripts-runner";
import { listAgentProviders } from "@/lib/agent-runs/providers";
import { parseBody, requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { JobCreateSchema, jobApproved } from "./schema";

export const dynamic = "force-dynamic";

export const GET = withErrorHandler(async (req: NextRequest) => {
  // Agent jobs carry prompts and repo paths.
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  return NextResponse.json({
    jobs: listJobs(),
    scripts: getAllowedScripts(),
    providers: listAgentProviders().providers.map(({ spec, binPath }) => ({
      id: spec.id,
      label: spec.label,
      installed: binPath !== null,
    })),
    wake: await getWakeState(),
  });
}, "jobs.get");

export const POST = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, JobCreateSchema);
  if (!parsed.ok) return parsed.response;
  const { source, confirmed, script, ...input } = parsed.data;
  const result = createJob(
    { ...input, script: script as AllowedScript | undefined },
    { approved: jobApproved(source, confirmed) },
  );
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json(result, { status: 201 });
}, "jobs.post");
