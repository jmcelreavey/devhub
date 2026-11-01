import { listJobs, createJob, getWakeState } from "../../../lib/scheduler";
import { getAllowedScripts, type AllowedScript } from "../../../lib/runs/runner";
import { listAgentProviders } from "../../../lib/agent-runs/providers";
import { listPaseoProviders } from "../../../lib/paseo/providers";
import { parseBody, requireDashboardAuth, withErrorHandler } from "../../../lib/api-utils";
import { httpAction } from "../../../lib/actions/http";
import { jobsCreate, jobsList } from "../../../../../../packages/shared/actions/jobs";
import { JobCreateSchema, jobApproved } from "./schema";


/** Agent jobs run in Paseo; the CLI list only stands in while its daemon is down. */
async function jobProviders(): Promise<{ id: string; label: string; installed: boolean }[]> {
  try {
    return (await listPaseoProviders()).map((p) => ({ id: p.id, label: p.label, installed: p.ready }));
  } catch {
    return listAgentProviders().providers.map(({ spec, binPath }) => ({ id: spec.id, label: spec.label, installed: binPath !== null }));
  }
}

export const GET = withErrorHandler(async (req: Request) => {
  // Agent jobs carry prompts and repo paths.
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const scope = new URL(req.url).searchParams.get("scope");
  return httpAction(jobsList, {
    input: () => ({}),
    context: () => ({ list: async () => {
      if (scope === "local") return { ok: true, value: { jobs: listJobs(), scripts: getAllowedScripts() } };
      if (scope === "external") return { ok: true, value: { providers: await jobProviders(), wake: await getWakeState() } };
      return { ok: true, value: { jobs: listJobs(), scripts: getAllowedScripts(), providers: await jobProviders(), wake: await getWakeState() } };
    } }),
    response: (result) => result.ok ? Response.json(result.value) : Response.json({ error: result.error }, { status: result.status }),
  })(req);
}, "jobs.get");

export const POST = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, JobCreateSchema);
  if (!parsed.ok) return parsed.response;
  const { source, confirmed, script, ...input } = parsed.data;
  return httpAction(jobsCreate, {
    input: () => ({ ...input, script }),
    context: () => ({ requireConfirmation: false, create: async (value) => {
      const result = createJob({ ...value, script: value.script as AllowedScript | undefined }, { approved: jobApproved(source, confirmed) });
      return "error" in result ? { ok: false, error: result.error, status: 400 } : { ok: true, value: result };
    } }),
    response: (result) => {
      if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
      if (result.value.kind !== "done") return Response.json({ error: "Confirmation required" }, { status: 403 });
      return Response.json(result.value.job, { status: 201 });
    },
  })(req);
}, "jobs.post");
