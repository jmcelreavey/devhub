import { NextResponse } from "next/server";
import { withErrorHandler } from "@/lib/api-utils";
import { isAiToolsSyncEnabled, refreshAiToolsForApi, resolveAiToolsRoot } from "@/lib/ai-tools-skills";

export const POST = withErrorHandler(async () => {
  if (!isAiToolsSyncEnabled()) {
    return NextResponse.json({
      ok: false,
      disabled: true,
      message: "ai-tools sync is disabled (AI_TOOLS_SYNC=0)",
      lines: [] as string[],
    });
  }

  const result = await refreshAiToolsForApi();
  return NextResponse.json({
    ok: result.ok,
    root: resolveAiToolsRoot(),
    commit: result.commit,
    pulled: result.pulled,
    warning: result.warning,
    lines: result.lines,
  });
}, "refresh ai-tools");
