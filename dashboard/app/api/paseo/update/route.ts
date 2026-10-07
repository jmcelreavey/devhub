import { NextRequest, NextResponse } from "next/server";
import { requireDashboardAuth } from "@/lib/api-utils";
import { checkPaseoUpdate } from "@/lib/paseo/update";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  return NextResponse.json(await checkPaseoUpdate(), { headers: { "Cache-Control": "no-store" } });
}
