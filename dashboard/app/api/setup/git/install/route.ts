import { NextResponse } from "next/server";
import { startMacGitInstall } from "@/lib/setup/git-install";

export const dynamic = "force-dynamic";

/** GET must not launch the installer. */
export function GET() {
  return NextResponse.json({ ok: false, error: "Use POST to start the installer." }, { status: 405 });
}

/** Darwin only. Fixed argv, no shell. */
export async function POST() {
  const result = await startMacGitInstall({ platform: process.platform, method: "POST" });
  return NextResponse.json(result.body, { status: result.status });
}
