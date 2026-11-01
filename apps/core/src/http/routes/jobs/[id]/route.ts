import { getJob, updateJob, deleteJob, triggerNow, approveJob } from "../../../../lib/scheduler";
import { type AllowedScript } from "../../../../lib/runs/runner";
import { parseBody, requireDashboardAuth, withErrorHandler } from "../../../../lib/api-utils";
import { httpAction } from "../../../../lib/actions/http";
import { jobsApprove, jobsDelete, jobsGet, jobsRun, jobsUpdate } from "../../../../../../../packages/shared/actions/jobs";
import { JobUpdateSchema, jobApproved } from "../schema";


interface Params {
  params: Promise<{ id: string }>;
}

export const GET = withErrorHandler(async (req: Request, { params }: Params) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  return httpAction(jobsGet, {
    input: () => ({ id }),
    context: () => ({ get: async (jobId) => {
      const job = getJob(jobId);
      return job ? { ok: true, value: job } : { ok: false, error: "Not found", status: 404 };
    } }),
    response: (result) => result.ok ? Response.json(result.value) : Response.json({ error: result.error }, { status: result.status }),
  })(req);
}, "jobs.id.get");

export const PATCH = withErrorHandler(async (req: Request, { params }: Params) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const parsed = await parseBody(req, JobUpdateSchema);
  if (!parsed.ok) return parsed.response;
  const { approve, source, confirmed, script, ...patch } = parsed.data;
  const approved = jobApproved(source, confirmed);

  if (approve) {
    if (!approved) {
      return Response.json(
        { error: "Agent jobs are approved by the user on DevHub → Actions → Scheduled Jobs" },
        { status: 403 },
      );
    }
    return httpAction(jobsApprove, {
      input: () => ({ id }),
      context: () => ({ approve: async (jobId) => {
        const result = approveJob(jobId);
        return "error" in result ? { ok: false, error: result.error, status: result.error === "Job not found" ? 404 : 400 } : { ok: true, value: result };
      } }),
      response: (result) => result.ok ? Response.json(result.value) : Response.json({ error: result.error }, { status: result.status }),
    })(req);
  }

  return httpAction(jobsUpdate, {
    input: () => ({ id, ...patch, script }),
    context: () => ({ requireConfirmation: false, update: async (jobId, value) => {
      const result = updateJob(jobId, { ...value, script: value.script as AllowedScript | undefined }, { approved });
      return "error" in result ? { ok: false, error: result.error, status: result.error === "Job not found" ? 404 : 400 } : { ok: true, value: result };
    } }),
    response: (result) => {
      if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
      if (result.value.kind !== "done") return Response.json({ error: "Confirmation required" }, { status: 403 });
      return Response.json(result.value.job);
    },
  })(req);
}, "jobs.id.patch");

export const DELETE = withErrorHandler(async (req: Request, { params }: Params) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  return httpAction(jobsDelete, {
    input: () => ({ id }),
    context: () => ({ requireConfirmation: false, remove: async (jobId) => deleteJob(jobId)
      ? { ok: true, value: { ok: true } }
      : { ok: false, error: "Not found", status: 404 } }),
    response: (result) => {
      if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
      if (result.value.kind !== "done") return Response.json({ error: "Confirmation required" }, { status: 403 });
      return Response.json({ ok: true });
    },
  })(req);
}, "jobs.id.delete");

export const POST = withErrorHandler(async (req: Request, { params }: Params) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  return httpAction(jobsRun, {
    input: () => ({ id }),
    context: () => ({ requireConfirmation: false, run: async (jobId) => {
      const result = await triggerNow(jobId);
      return "error" in result ? { ok: false, error: result.error, status: result.error === "Job not found" ? 404 : 409 } : { ok: true, value: result };
    } }),
    response: (result) => {
      if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
      if (result.value.kind !== "done") return Response.json({ error: "Confirmation required" }, { status: 403 });
      return Response.json({ runId: result.value.runId }, { status: 202 });
    },
  })(req);
}, "jobs.id.run");
