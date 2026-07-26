import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { runScan } from "@/lib/capability/scan";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ScanSchema = z.object({
  includeGithub: z.boolean().optional(),
  githubLimit: z.number().int().positive().optional(),
  githubFilter: z.string().optional(),
});

export async function POST(req: NextRequest) {
  // An absent or empty body is meaningful here: it means a local-only scan.
  // `.catch(() => ({}))` preserves that while still rejecting malformed shapes.
  const raw = await req.json().catch(() => ({}));
  const parsed = ScanSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  }
  const body = parsed.data;

  try {
    const result = await runScan({
      includeGithub: body.includeGithub === true,
      githubLimit: body.githubLimit,
      githubFilter: body.githubFilter,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[api:capability:scan]", err);
    return NextResponse.json({ error: "Scan failed", detail: String(err).slice(0, 240) }, { status: 500 });
  }
}
