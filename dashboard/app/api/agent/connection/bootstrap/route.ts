import { NextRequest, NextResponse } from "next/server";
import { requireDashboardAuth } from "@/lib/api-utils";
import { paseoPassword, paseoWebOrigin } from "@/lib/paseo/client";

export const dynamic = "force-dynamic";

function localRequest(req: NextRequest): boolean {
  const host = req.headers.get("host");
  if (!host) return false;
  try { return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(`http://${host}`).hostname); } catch { return false; }
}

/** Only DevHub's local Chats frame needs the plaintext secret already used by its Paseo client. */
export async function POST(req: NextRequest) {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  if (!localRequest(req)) {
    return NextResponse.json({ error: "Open DevHub on this Mac to connect Paseo." }, { status: 403 });
  }
  const password = paseoPassword();
  if (!password) return new NextResponse(null, { status: 204 });
  try {
    const origin = paseoWebOrigin();
    const response = await fetch(`${origin}/api/status`, {
      headers: { Authorization: `Bearer ${password}` },
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`Paseo returned HTTP ${response.status}.`);
    const { serverId } = (await response.json()) as { serverId?: unknown };
    if (typeof serverId !== "string" || !/^srv_[A-Za-z0-9_-]+$/.test(serverId)) throw new Error("Paseo returned an invalid server id.");
    return NextResponse.json({ serverId, password }, { headers: { "Cache-Control": "no-store", "Pragma": "no-cache" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not connect to Paseo." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
