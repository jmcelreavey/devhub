import { skillRefreshUpstream } from "../../../../../../../packages/shared/actions/workspace";
import { withErrorHandler } from "../../../../lib/api-utils";
import { isAiToolsSyncEnabled, refreshAiToolsForApi, resolveAiToolsRoot } from "../../../../lib/ai/tools-skills";

export const POST = withErrorHandler(async () => {
  return await skillRefreshUpstream.handler({}, { execute: async () => {
    if (!isAiToolsSyncEnabled()) {
      return Response.json({
        ok: false,
        disabled: true,
        message: "ai-tools sync is disabled (AI_TOOLS_SYNC=0)",
        lines: [] as string[],
      });
    }

    const result = await refreshAiToolsForApi();
    return Response.json({
      ok: result.ok,
      root: resolveAiToolsRoot(),
      commit: result.commit,
      pulled: result.pulled,
      warning: result.warning,
      lines: result.lines,
    });
  } }) as Response;
}, "refresh ai-tools");
