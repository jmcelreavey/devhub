import { NextResponse } from "next/server";
import { getRunLogPayload } from "@/lib/scripts-runner";

type Params = { params: Promise<{ runId: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { runId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(runId)) {
    return NextResponse.json({ error: "Invalid run id" }, { status: 400 });
  }
  const payload = getRunLogPayload(runId);
  if (!payload) {
    return NextResponse.json(
      {
        error:
          "Run log not found. Logs are kept for completed runs after this update; older history entries have no saved output.",
      },
      { status: 404 },
    );
  }
  return NextResponse.json(payload);
}
