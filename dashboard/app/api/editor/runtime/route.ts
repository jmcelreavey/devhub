import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isSameOriginStrict, parseBody, requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { editorStatus, installEditor, startEditor, stopEditor, uninstallEditor, rollbackEditor } from "@/lib/editor/runtime";
export const GET = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  return auth.ok ? NextResponse.json(editorStatus(), { headers: { "Cache-Control": "no-store" } }) : auth.response;
}, "editor.runtime.get");
export const POST = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  if (!isSameOriginStrict(req)) return NextResponse.json({ error: "Open the editor from this DevHub window." }, { status: 403 });
  const parsed = await parseBody(req, z.object({ action: z.enum(["install", "start", "stop", "uninstall", "rollback"]), workspaceId: z.string().min(1).max(200).optional(), savedBuffers: z.literal(true).optional() }));
  if (!parsed.ok) return parsed.response;
  try {
    const { action, workspaceId, savedBuffers } = parsed.data;
    if (action === "start") {
      if (!workspaceId) throw new Error("Choose a workspace.");
      return NextResponse.json(await startEditor(workspaceId), { headers: { "Cache-Control": "no-store" } });
    }
    if (action === "install") return NextResponse.json(await installEditor());
    if (!savedBuffers) throw new Error("Save your files before stopping the editor.");
    if (action === "stop") { await stopEditor(); return NextResponse.json(editorStatus()); }
    return NextResponse.json(action === "rollback" ? await rollbackEditor() : await uninstallEditor());
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Editor operation failed." }, { status: 400 }); }
}, "editor.runtime.post");
