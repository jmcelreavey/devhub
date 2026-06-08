import { NextRequest, NextResponse } from "next/server";
import { withErrorHandler } from "@/lib/api-utils";
import { buildContextPack, formatContextPackMarkdown } from "@/lib/context-pack";
import { buildStandupQuery } from "@/lib/standup-params";

export const dynamic = "force-dynamic";

async function fetchStandupMarkdown(origin: string): Promise<string | null> {
  const qs = buildStandupQuery();
  const r = await fetch(`${origin}/api/standup/markdown?${qs}`, { cache: "no-store" });
  if (!r.ok) return null;
  const data = (await r.json()) as { markdown?: string };
  return data.markdown ?? null;
}

export const GET = withErrorHandler(async (req: NextRequest) => {
  const format = req.nextUrl.searchParams.get("format");
  const origin = req.nextUrl.origin;
  const pack = await buildContextPack(() => fetchStandupMarkdown(origin));

  if (format === "markdown") {
    return NextResponse.json({ markdown: formatContextPackMarkdown(pack), pack });
  }
  return NextResponse.json(pack);
}, "context pack");
