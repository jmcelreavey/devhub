import { requireDashboardAuth, withErrorHandler } from "../../../../lib/api-utils";
import { httpAction } from "../../../../lib/actions/http";
import { storyboardPreview } from "../../../../../../../packages/shared/actions/storyboard";
import { listPreviews, PREVIEW_CONFIG_NAME, readPreviewConfig } from "../../../../lib/storyboard/preview";


/** Whether auto mode may start a repo's preview for Jev, and the previews DevHub is running. */
export const GET = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const repo = new URL(req.url).searchParams.get("repo")?.trim() || undefined;
  return httpAction(storyboardPreview, {
    input: () => ({ repo }),
    context: () => ({ read: (name) => {
      const found = name ? readPreviewConfig(name) : null;
      return {
        ...(name ? { repo: name, configFile: `upstarts/${name}/${PREVIEW_CONFIG_NAME}` } : {}),
        ...(found && "config" in found ? { autoStart: true, config: found.config } : {}),
        ...(found && "reason" in found ? { autoStart: false, reason: found.reason } : {}),
        running: listPreviews(),
      };
    } }),
    response: (result) => Response.json(result),
  })(req);
}, "storyboard.preview.get");
