import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, requireDashboardAuth } from "@/lib/api-utils";
import { AionClient } from "@/lib/aionui/client";
import { AIONUI_RELEASE } from "@/lib/aionui/connection";
import { aionBrowserCookies, connectAion, currentAionSession, publicAionConnection, readAionSession, setDefaultAionAssistant } from "@/lib/aionui/session";
import { ensureAionOpenAiBootstrap } from "@/lib/aionui/openai-bootstrap";
import { ensureAionMcpBootstrap } from "@/lib/aionui/mcp-bootstrap";
import { applyGraphiteNeonTheme } from "@/lib/aionui/theme";
import { getRepoRoot } from "@/lib/content/dirs";

export const dynamic = "force-dynamic";

function localBrowser(req: NextRequest): boolean {
  return ["localhost", "127.0.0.1", "[::1]"].includes(req.nextUrl.hostname);
}

export async function GET(req: NextRequest) {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  try {
    if (!readAionSession()) return NextResponse.json({ connected: false, release: AIONUI_RELEASE });
    const session = await currentAionSession();
    const client = new AionClient(session);
    const assistants = await client.listAssistants();
    return NextResponse.json({ connected: true, ...publicAionConnection(session), assistants, defaultCwd: getRepoRoot(), release: AIONUI_RELEASE });
  } catch (error) {
    return NextResponse.json({ connected: false, error: error instanceof Error ? error.message : "Could not connect to AionUi." }, { status: 503 });
  }
}

const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("connect"), origin: z.string().max(200), username: z.string().min(1).max(200), password: z.string().min(1).max(4096), assistantId: z.string().max(200).optional() }),
  z.object({ action: z.literal("browser-session") }),
  z.object({ action: z.literal("default-assistant"), assistantId: z.string().min(1).max(200) }),
]);

export async function POST(req: NextRequest) {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  // Session cookies belong only in the local dashboard, never a remote embedding.
  if (!localBrowser(req)) return NextResponse.json({ error: "Open the local DevHub dashboard to connect Agents." }, { status: 403 });
  const parsed = await parseBody(req, inputSchema);
  if (!parsed.ok) return parsed.response;
  try {
    const session = parsed.data.action === "connect" ? await connectAion(parsed.data) : parsed.data.action === "default-assistant" ? await setDefaultAionAssistant(parsed.data.assistantId) : await currentAionSession();
    await new AionClient(session).verifyConnection();
    if (parsed.data.action === "connect" || parsed.data.action === "browser-session") {
      try { await applyGraphiteNeonTheme(session); } catch { /* Theme sync is best-effort. */ }
      try { await ensureAionOpenAiBootstrap(session); } catch { /* Provider bootstrap is best-effort. */ }
      try { await ensureAionMcpBootstrap(session); } catch { /* MCP enable is best-effort. */ }
    }
    const response = NextResponse.json({ connected: true, ...publicAionConnection(session) });
    for (const cookie of aionBrowserCookies(session)) response.headers.append("Set-Cookie", cookie);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not connect to AionUi." }, { status: 400 });
  }
}
