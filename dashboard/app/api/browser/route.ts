import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireDashboardAuth, isSameOriginStrict, parseBody, withErrorHandler } from "@/lib/api-utils";
import { browserStatus, startBrowser, stopBrowser, resetBrowserProfile, currentBrowser } from "@/lib/browser/runtime";
import { approveBrowserAction, takeBrowserControl, resumeBrowser, browserScreenshot, watchBrowser } from "@/lib/browser/commands";
import { getActiveTasksDir } from "@/lib/notes/dir";
import { readItems } from "@shared/tasks/store";
import { listTaskAgentRuns } from "@/lib/tasks/task-agent-runs";
import { StartBrowserSchema } from "@/lib/browser/policy";
const headers = { "Cache-Control": "no-store" };
function humanRequest(req: NextRequest) {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  if ((req.method !== "GET" && !isSameOriginStrict(req)) || req.headers.get("x-devhub-client") === "mcp") return NextResponse.json({ error: "Use the browser controls in DevHub." }, { status: 403 });
}
export const GET = withErrorHandler(async (req: NextRequest) => {
  const denied = humanRequest(req); if (denied) return denied;
  const tasks = readItems(getActiveTasksDir()).filter((task) => !task.done && !task.abandonedAt && !task.endDate).map((task) => ({
    id: task.id, text: task.text, runs: listTaskAgentRuns(task.id).filter((run) => !["failed", "abandoned"].includes(run.status)).map((run) => ({ id: run.runId, role: run.role, status: run.status })),
  })).filter((task) => task.runs.length);
  return NextResponse.json({ ...browserStatus(), tasks }, { headers });
}, "browser.get");
const ControlSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), config: StartBrowserSchema }).strict(),
  z.object({ action: z.literal("stop") }).strict(),
  z.object({ action: z.literal("reset"), confirm: z.literal("CLEAR SAVED SIGN-INS") }).strict(),
  z.object({ action: z.enum(["takeover", "resume", "watch", "capture", "reject"]), sessionId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("approve"), sessionId: z.string().uuid(), proposalId: z.string().uuid() }).strict(),
]);
export const POST = withErrorHandler(async (req: NextRequest) => {
  const denied = humanRequest(req); if (denied) return denied;
  const parsed = await parseBody(req, ControlSchema); if (!parsed.ok) return parsed.response;
  const input = parsed.data;
  try {
    if (input.action === "start") await startBrowser(input.config);
    else if (input.action === "stop") await stopBrowser();
    else if (input.action === "reset") await resetBrowserProfile();
    else if (input.action === "takeover") await takeBrowserControl(input.sessionId);
    else if (input.action === "resume") await resumeBrowser(input.sessionId);
    else if (input.action === "watch") await watchBrowser(input.sessionId);
    else if (input.action === "reject") currentBrowser(input.sessionId).view.pending = undefined;
    else if (input.action === "approve") await approveBrowserAction(input.sessionId, input.proposalId);
    else if (input.action === "capture") return new NextResponse(new Uint8Array(await browserScreenshot(input.sessionId)), { headers: { ...headers, "Content-Type": "image/jpeg" } });
    return NextResponse.json(browserStatus(), { headers });
  } catch (error) {
    // Playwright errors may contain authenticated URLs or page text.
    const message = error instanceof Error && !error.message.includes("\n") && error.message.length < 220 ? error.message : "Browser operation failed. Check Chrome, then retry from DevHub.";
    return NextResponse.json({ error: message }, { status: 409, headers });
  }
}, "browser.control");
