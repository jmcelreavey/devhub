import { NextRequest, NextResponse } from "next/server";
import { requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { listPreviews, PREVIEW_CONFIG_NAME, readPreviewConfig } from "@/lib/storyboard/preview";

export const dynamic = "force-dynamic";

/** Whether auto mode may start a repo's preview for Jev, and the previews DevHub is running. */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const repo = req.nextUrl.searchParams.get("repo")?.trim() || undefined;
  const found = repo ? readPreviewConfig(repo) : null;
  return NextResponse.json({
    ...(repo ? { repo, configFile: `upstarts/${repo}/${PREVIEW_CONFIG_NAME}` } : {}),
    ...(found && "config" in found ? { autoStart: true, config: found.config } : {}),
    ...(found && "reason" in found ? { autoStart: false, reason: found.reason } : {}),
    running: listPreviews(),
  });
}, "storyboard.preview.get");
