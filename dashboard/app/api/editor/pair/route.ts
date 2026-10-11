import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isSameOriginStrict, parseBody, requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { pairEditor, revokeEditor } from "@/lib/editor/pairing";
import { AgentDispatchError } from "@/lib/agent-runs/dispatch";
export const POST = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  if (!isSameOriginStrict(req)) return NextResponse.json({ error: "Pair from this DevHub window." }, { status: 403 });
  const parsed = await parseBody(req, z.object({ workspaceId: z.string().min(1).max(200), revoke: z.boolean().optional() }));
  if (!parsed.ok) return parsed.response;
  try {
    if (parsed.data.revoke) { revokeEditor(parsed.data.workspaceId); return NextResponse.json({ revoked: true }); }
    return NextResponse.json(pairEditor(parsed.data.workspaceId, req.nextUrl.origin), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AgentDispatchError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}, "editor.pair");
