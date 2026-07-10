import { type NextRequest, NextResponse } from "next/server";
import { getOpenCodeRecap, OpenCodeRecapError } from "@/lib/opencode-recap";
import { requireDashboardAuth } from "@/lib/api-utils";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = requireDashboardAuth(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  try {
    return NextResponse.json(
      await getOpenCodeRecap({
        sessionId: url.searchParams.get("sessionId")?.trim() || undefined,
        includeChildren: url.searchParams.get("children") === "true",
        directory: url.searchParams.get("directory")?.trim() || undefined,
      }),
    );
  } catch (error) {
    if (error instanceof OpenCodeRecapError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "OpenCode is unavailable." }, { status: 503 });
  }
}
