import { readAgentRun } from "../../../../lib/agent-runs/store";
import { requireDashboardAuth } from "../../../../lib/api-utils";
import { httpAction } from "../../../../lib/actions/http";
import { paseoOpen } from "../../../../../../../packages/shared/actions/paseo";
import { paseoAgentWebUrl, paseoUrl } from "../../../../lib/paseo/client";


const LOOPBACK = ["localhost", "127.0.0.1", "[::1]"];

/** Redirects the Chats frame to a run's (or agent's) Paseo conversation. */
export async function GET(req: Request) {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  return httpAction(paseoOpen, {
    input: () => ({ run: new URL(req.url).searchParams.get("run"), agent: new URL(req.url).searchParams.get("agent"), format: new URL(req.url).searchParams.get("format") }),
    context: () => ({ execute: () => openChat(req) }),
    response: (response) => response as Response,
  })(req);
}

async function openChat(req: Request) {
  const search = new URL(req.url).searchParams;
  const json = search.get("format") === "json";
  const unavailable = (message: string, status: number) => {
    if (json) return Response.json({ error: message }, { status });
    // Bookmarks and older clients can still navigate here directly.
    const escaped = message.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
    return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Open chat — DevHub</title><body style="font:16px system-ui;padding:32px"><h1>Chat unavailable</h1><p>${escaped}</p><a href="/agents" target="_top">Back to chats</a></body></html>`, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  };
  const runId = search.get("run");
  const run = runId ? readAgentRun(runId) : null;
  if (runId && (!run || run.spec.runtime !== "paseo")) return unavailable("This chat was created before the move to Paseo. Its saved run has been kept, but the old chat cannot be opened here.", 404);
  const agentId = runId ? run?.status.conversationId : search.get("agent");
  if (!agentId || agentId.length > 200) {
    if (run?.status.state === "starting") {
      const phase = run.status.startupPhase ?? "preparing";
      const message = phase === "worktree" ? "Creating an isolated worktree…" : phase === "agent" ? "Starting the agent…" : "Saving the run…";
      if (json) return Response.json({ error: message, starting: true, phase }, { status: 404 });
      return unavailable(message, 404);
    }
    if (run && (run.status.state === "failed" || run.status.state === "needs-attention") && run.status.error) {
      return unavailable(run.status.error, 409);
    }
    return unavailable("This run does not have a chat yet.", 404);
  }
  try {
    if (run && run.status.connectionId !== paseoUrl()) return unavailable("This chat belongs to a different Paseo connection.", 409);
    const target = await paseoAgentWebUrl(agentId);
    if (!target) return unavailable("This chat is no longer available in Paseo.", 404);
    // The web UI keeps its login per origin: stay on the dashboard's loopback name so it's asked for once.
    const url = new URL(target);
    const host = req.headers.get("host");
    const hostname = host ? new URL(`http://${host}`).hostname : new URL(req.url).hostname;
    if (LOOPBACK.includes(hostname)) url.hostname = hostname;
    return json ? Response.json({ url: url.href }) : Response.redirect(url, 302);
  } catch {
    return unavailable("Paseo could not open this chat. Check the connection, then try again.", 503);
  }
}
