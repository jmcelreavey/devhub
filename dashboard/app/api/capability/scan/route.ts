import { NextRequest, NextResponse } from "next/server";
import { runScan, type ScanOptions } from "@/lib/capability/scan";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  let body: Partial<ScanOptions> = {};
  try {
    body = (await req.json()) as Partial<ScanOptions>;
  } catch {
    // empty body → local-only scan
  }

  try {
    const result = await runScan({
      includeGithub: body.includeGithub === true,
      githubLimit: typeof body.githubLimit === "number" ? body.githubLimit : undefined,
      githubFilter: typeof body.githubFilter === "string" ? body.githubFilter : undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[api:capability:scan]", err);
    return NextResponse.json({ error: "Scan failed", detail: String(err).slice(0, 240) }, { status: 500 });
  }
}
