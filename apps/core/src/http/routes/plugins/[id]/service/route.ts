import { pluginServiceChange, pluginServiceReview } from "../../../../../../../../packages/shared/actions/plugins";
import { runtimeInventory } from "../../../../../../../../packages/shared/ui-lib/plugins/runtime-contract";
import { isSameOriginStrict } from "../../../../../lib/api-utils";
import { PluginApiError } from "../../../../../lib/plugins/context";
import { assertPluginManagement, pluginError, pluginJson, readJson, serverPluginContext } from "../../../../../lib/plugins/http";
import { approveRuntimeService, reviewRuntimeService, revokeRuntimeService } from "../../../../../lib/plugins/runtime-supervisor";

type Context = { params: Promise<{ id: string }> };

const serviceInventory = new Set([
  "Background service", "Environment and secrets", "Public environment settings (may appear in output)",
  "Network access (declared, not enforced)", "Read-only home paths", "Writable home paths",
  "Notes vault access", "Retained state access", "Commands",
]);

export async function GET(req: Request, { params }: Context) {
  const auth = assertPluginManagement(req);
  if (!auth.ok) return auth.response;
  try {
    const input = pluginServiceReview.input.parse(await params);
    return pluginServiceReview.handler(input, { execute: ({ id }) => {
      const review = reviewRuntimeService(serverPluginContext(), id);
      return pluginJson({
        label: review.service.label,
        maxRunSeconds: review.service.maxRunSeconds,
        enabled: review.enabled,
        digest: review.digest,
        inventory: runtimeInventory(review.plugin.runtime).filter((group) => serviceInventory.has(group.kind)).map((group) => group.kind === "Background service"
          ? { ...group, entries: group.entries.map((entry) => entry.replace(" · off until separately approved in Plugins", "")) }
          : group),
      });
    } }) as Response;
  } catch (err) { return pluginError(err); }
}

export async function POST(req: Request, { params }: Context) {
  const auth = assertPluginManagement(req);
  if (!auth.ok) return auth.response;
  try {
    // Approval belongs to a browser review, not an API-secret or MCP caller.
    if (req.headers.has("x-devhub-secret") || req.headers.get("x-devhub-client") === "mcp" || req.headers.get("sec-fetch-site") !== "same-origin" || !isSameOriginStrict(req)) {
      throw new PluginApiError(403, "FORBIDDEN", "Review and manage background services in the dashboard.");
    }
    const parsed = pluginServiceChange.input.safeParse({ ...await params, body: await readJson(req) });
    if (!parsed.success) throw new PluginApiError(400, "INVALID_BODY", "Review the service before approving it.");
    return await pluginServiceChange.handler(parsed.data, { execute: async ({ id, body }) => {
      const ctx = serverPluginContext();
      if (body.action === "approve") await approveRuntimeService(ctx, id, body.digest);
      else await revokeRuntimeService(ctx, id);
      return pluginJson({ ok: true });
    } }) as Response;
  } catch (err) { return pluginError(err); }
}
