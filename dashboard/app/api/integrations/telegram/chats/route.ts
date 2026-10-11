import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isSameOriginStrict, parseBody, requireDashboardAuth } from "@/lib/api-utils";
import { discoverTelegramChats } from "@/lib/integrations/telegram";
import { integrationFailure } from "@/lib/integrations/write-api";

export const dynamic = "force-dynamic";
const Input = z.object({ credentialRef: z.string().regex(/^[A-Z][A-Z0-9_]{1,127}$/) }).strict();
export async function POST(req: NextRequest) {
  const auth = requireDashboardAuth(req); if (!auth.ok) return auth.response;
  if (!isSameOriginStrict(req)) return NextResponse.json({ error: "Find Telegram chats in DevHub." }, { status: 403 });
  const parsed = await parseBody(req, Input); if (!parsed.ok) return parsed.response;
  try { return NextResponse.json({ chats: await discoverTelegramChats(parsed.data.credentialRef) }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return integrationFailure(error); }
}
