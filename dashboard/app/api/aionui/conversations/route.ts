import { NextRequest, NextResponse } from "next/server";
import { requireDashboardAuth } from "@/lib/api-utils";
import { directConversations, indexAionConversations } from "@/lib/aionui/conversation-index";
import { readAionSession } from "@/lib/aionui/session";
import { aionConnectionId } from "@/lib/aionui/connection";

export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  try {
    await indexAionConversations();
    const session = readAionSession();
    return NextResponse.json({ conversations: directConversations(session ? aionConnectionId(session) : undefined) });
  } catch {
    return NextResponse.json({ conversations: directConversations(), offline: true });
  }
}
