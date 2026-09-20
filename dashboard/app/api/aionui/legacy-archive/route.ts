import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { archiveLegacyChats, listLegacyArchives, readLegacyArchive } from "@/lib/aionui/legacy-archive";

export const dynamic = "force-dynamic";
export const GET = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ archives: listLegacyArchives() });
  const archive = readLegacyArchive(id);
  if (!archive) return NextResponse.json({ error: "Archive not found." }, { status: 404 });
  return NextResponse.json(archive, { headers: {
    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
    ...(req.nextUrl.searchParams.has("download") ? { "Content-Disposition": `attachment; filename="devhub-chat-archive-${id.slice(0, 12)}.json"` } : {}),
  } });
}, "agents.legacy-archive");

export const POST = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, z.object({ raw: z.string().min(1).max(12_000_000) }));
  if (!parsed.ok) return parsed.response;
  return NextResponse.json(archiveLegacyChats(parsed.data.raw));
}, "agents.legacy-archive");
