import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { discardSelection, nextSelection, pendingSelection, receiveSelection } from "@/lib/editor/pairing";
import { SelectionSchema } from "@/lib/editor/selection";
import { AgentDispatchError } from "@/lib/agent-runs/dispatch";
export const POST = withErrorHandler(async (req: NextRequest) => {
  // This external client gets only a workspace pairing token, never dashboard authority.
  if (req.headers.has("origin")) return NextResponse.json({ error: "Use the paired editor extension." }, { status: 403 });
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token || token.length > 100) return NextResponse.json({ error: "Pair this workspace first." }, { status: 401 });
  const parsed = await parseBody(req, SelectionSchema);
  if (!parsed.ok) return parsed.response;
  try { return NextResponse.json({ id: receiveSelection(token, parsed.data) }); }
  catch (error) {
    if (error instanceof AgentDispatchError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}, "editor.incoming");
export const GET = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const workspace = req.nextUrl.searchParams.get("workspace");
  if (workspace) return NextResponse.json({ pending: nextSelection(workspace) }, { headers: { "Cache-Control": "no-store" } });
  const selection = pendingSelection(req.nextUrl.searchParams.get("id") || "");
  return selection ? NextResponse.json({ selection }, { headers: { "Cache-Control": "no-store" } }) : NextResponse.json({ error: "This selection expired. Send it again from your editor." }, { status: 404 });
}, "editor.incoming.get");
export const DELETE = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, z.object({ id: z.string().uuid() }));
  if (!parsed.ok) return parsed.response;
  discardSelection(parsed.data.id);
  return NextResponse.json({ removed: true });
}, "editor.incoming.delete");
