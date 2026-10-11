import { NextRequest, NextResponse } from "next/server";
import { requireDashboardAuth } from "@/lib/api-utils";
import { alertProfile } from "@/lib/integrations/alert-worker";
import { chatStatus } from "@/lib/integrations/chat";

export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const auth = requireDashboardAuth(req); if (!auth.ok) return auth.response;
  const profile = alertProfile();
  const chat = chatStatus(profile).map((status) => {
    const prefix = "DEVHUB_" + status.provider.toUpperCase();
    return { ...status, webhookPath: "/api/integrations/chat/" + status.provider, commandsVariable: prefix + "_COMMANDS", secretVariable: prefix + (status.provider === "slack" ? "_SIGNING_SECRET" : "_WEBHOOK_SECRET"), allowlistVariable: prefix + "_ALLOWLIST" };
  });
  return NextResponse.json({ profile, chat, confirmation: "Chat can only request proposals. Provider writes require human review and confirmation in DevHub." }, { headers: { "Cache-Control": "no-store" } });
}
