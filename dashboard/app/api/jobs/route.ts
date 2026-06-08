import { NextRequest, NextResponse } from "next/server";
import { listJobs, createJob } from "@/lib/scheduler";
import { getAllowedScripts, type AllowedScript } from "@/lib/scripts-runner";

function isSameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  const host = req.headers.get("host") ?? "localhost:1337";
  return origin === `http://${host}` || origin === `https://${host}`;
}

export async function GET() {
  return NextResponse.json({
    jobs: listJobs(),
    scripts: getAllowedScripts(),
  });
}

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
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
