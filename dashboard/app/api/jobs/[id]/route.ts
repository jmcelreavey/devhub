import { NextRequest, NextResponse } from "next/server";
import { getJob, updateJob, deleteJob, triggerNow, approveJob } from "@/lib/scheduler";
import { type AllowedScript } from "@/lib/scripts-runner";
import { parseBody, requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { JobUpdateSchema, jobApproved } from "../schema";

export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

export const GET = withErrorHandler(async (req: NextRequest, { params }: Params) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const job = getJob(id);
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(job);
}, "jobs.id.get");

export const PATCH = withErrorHandler(async (req: NextRequest, { params }: Params) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const parsed = await parseBody(req, JobUpdateSchema);
  if (!parsed.ok) return parsed.response;
  const { approve, source, confirmed, script, ...patch } = parsed.data;
  const approved = jobApproved(source, confirmed);

  if (approve) {
    if (!approved) {
      return NextResponse.json(
        { error: "Agent jobs are approved by the user on DevHub → Actions → Scheduled Jobs" },
        { status: 403 },
      );
    }
    const result = approveJob(id);
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.error === "Job not found" ? 404 : 400 });
    }
    return NextResponse.json(result);
  }

  const result = updateJob(id, { ...patch, script: script as AllowedScript | undefined }, { approved });
  if ("error" in result) {
    const status = result.error === "Job not found" ? 404 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json(result);
}, "jobs.id.patch");

export const DELETE = withErrorHandler(async (req: NextRequest, { params }: Params) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const ok = deleteJob(id);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}, "jobs.id.delete");

export const POST = withErrorHandler(async (req: NextRequest, { params }: Params) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const result = await triggerNow(id);
  if ("error" in result) {
    const status = result.error === "Job not found" ? 404 : 409;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json(result, { status: 202 });
}, "jobs.id.run");
