import { NextResponse, type NextRequest } from "next/server";
import { requireDashboardAuth } from "@/lib/api-utils";
import { ensureDevHubOpenCode } from "@/lib/opencode/listen";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = requireDashboardAuth(request);
  if (!auth.ok) return auth.response;

  try {
    const port = await ensureDevHubOpenCode();
    return NextResponse.json({ port });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
