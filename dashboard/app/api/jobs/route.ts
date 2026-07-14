import { NextRequest, NextResponse } from "next/server";
import { listJobs, createJob } from "@/lib/scheduler";
import { getAllowedScripts, type AllowedScript } from "@/lib/scripts-runner";
import { requireDashboardAuth } from "@/lib/api-utils";

export async function GET() {
  return NextResponse.json({
    jobs: listJobs(),
    scripts: getAllowedScripts(),
  });
}

export async function POST(req: NextRequest) {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const body = (await req.json()) as {
    name?: string;
    script?: string;
    cron?: string;
    enabled?: boolean;
  };
  if (!body.name || !body.script || !body.cron) {
    return NextResponse.json(
      { error: "name, script, and cron are required" },
      { status: 400 },
    );
  }
  const result = createJob({
    name: body.name,
    script: body.script as AllowedScript,
    cron: body.cron,
    enabled: body.enabled,
  });
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json(result, { status: 201 });
}
