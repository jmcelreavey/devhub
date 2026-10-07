import { NextRequest, NextResponse } from "next/server";
import { readAgentRun } from "@/lib/agent-runs/store";
import { requireDashboardAuth } from "@/lib/api-utils";
import { paseoAgentWebUrl, paseoUrl } from "@/lib/paseo/client";

export const dynamic = "force-dynamic";

const LOOPBACK = ["localhost", "127.0.0.1", "[::1]"];

/** Redirects the Chats frame to a run's (or agent's) Paseo conversation. */
export async function GET(req: NextRequest) {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const search = req.nextUrl.searchParams;
  const json = search.get("format") === "json";
  const unavailable = (message: string, status: number) => {
    if (json) return NextResponse.json({ error: message }, { status });
    // Bookmarks and older clients can still navigate here directly.
    const escaped = message.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
    return new NextResponse(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Open chat — DevHub</title><body style="font:16px system-ui;padding:32px"><h1>Chat unavailable</h1><p>${escaped}</p><a href="/agents" target="_top">Back to chats</a></body></html>`, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  };
  const runId = search.get("run");
  const run = runId ? readAgentRun(runId) : null;
  if (runId && (!run || run.spec.runtime !== "paseo")) return unavailable("This chat was created before the move to Paseo. Its saved run has been kept, but the old chat cannot be opened here.", 404);
  const agentId = runId ? run?.status.conversationId : search.get("agent");
  if (!agentId || agentId.length > 200) return unavailable("This run does not have a chat yet.", 404);
  try {
    if (run && run.status.connectionId !== paseoUrl()) return unavailable("This chat belongs to a different Paseo connection.", 409);
    const target = await paseoAgentWebUrl(agentId);
    if (!target) return unavailable("This chat is no longer available in Paseo.", 404);
    // The web UI keeps its login per origin: stay on the dashboard's loopback name so it's asked for once.
    const url = new URL(target);
    const host = req.headers.get("host");
    const hostname = host ? new URL(`http://${host}`).hostname : req.nextUrl.hostname;
    if (LOOPBACK.includes(hostname)) url.hostname = hostname;
    return json ? NextResponse.json({ url: url.href }) : NextResponse.redirect(url, 302);
  } catch {
    return unavailable("Paseo could not open this chat. Check the connection, then try again.", 503);
  }
}
