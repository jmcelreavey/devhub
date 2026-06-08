import { NextRequest, NextResponse } from "next/server";
import { getJob, updateJob, deleteJob, triggerNow } from "@/lib/scheduler";
import { type AllowedScript } from "@/lib/scripts-runner";

function isSameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  const host = req.headers.get("host") ?? "localhost:1337";
  return origin === `http://${host}` || origin === `https://${host}`;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const job = getJob(id);
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(job);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const body = (await req.json()) as {
    name?: string;
    cron?: string;
    enabled?: boolean;
    script?: string;
  };
  const result = updateJob(id, {
    name: body.name,
    cron: body.cron,
    enabled: body.enabled,
    script: body.script as AllowedScript | undefined,
  });
  if ("error" in result) {
    const status = result.error === "Job not found" ? 404 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json(result);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const ok = deleteJob(id);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const result = triggerNow(id);
  if ("error" in result) {
    const status = result.error === "Job not found" ? 404 : 409;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json(result, { status: 202 });
}
