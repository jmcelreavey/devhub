import { NextResponse } from "next/server";
import { loadOncallStatus } from "@/lib/datadog-oncall-server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await loadOncallStatus());
}
