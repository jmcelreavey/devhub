import fs from "node:fs";
import { pluginLocalRuntime } from "../../../../../../../packages/shared/actions/plugins";
import path from "node:path";
import { z } from "zod";
import { isSameOriginStrict } from "../../../../lib/api-utils";
import { PluginApiError } from "../../../../lib/plugins/context";
import { assertPluginManagement, pluginError, pluginJson, readJson, serverPluginContext } from "../../../../lib/plugins/http";
import { reviewLocalRuntime } from "../../../../lib/plugins/local-runtime";
import { expandHome } from "../../../../lib/plugins/registry";

const inputSchema = z.object({
  path: z.string().min(1).max(4096).refine((value) => !value.includes("\0") && (path.isAbsolute(value) || value === "~" || value.startsWith("~/"))),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();

export async function POST(req: Request) {
  const auth = assertPluginManagement(req);
  if (!auth.ok) return auth.response;
  try {
    // Trust is a browser review action; MCP and API-secret callers cannot approve it.
    if (req.headers.has("x-devhub-secret") || req.headers.get("x-devhub-client") === "mcp" || req.headers.get("sec-fetch-site") !== "same-origin" || !isSameOriginStrict(req)) {
      throw new PluginApiError(403, "FORBIDDEN", "Review and trust local plugins in the dashboard.");
    }
    const parsed = inputSchema.safeParse(await readJson(req));
    if (!parsed.success) throw new PluginApiError(400, "INVALID_BODY", "Enter an absolute local folder path and a valid fingerprint.");
    return await pluginLocalRuntime.handler({ body: parsed.data }, {
      execute: ({ body }) => review(body as typeof parsed.data),
    }) as Response;
  } catch (err) {
    return pluginError(err);
  }
}

async function review(input: ReturnType<typeof inputSchema.parse>) {
  const ctx = serverPluginContext();
  const localPath = expandHome(input.path, ctx.home);
  let folder: fs.Stats;
  try { folder = fs.statSync(localPath); }
  catch { throw new PluginApiError(400, "INVALID_PATH", "That plugin folder couldn’t be found."); }
  if (!folder.isDirectory()) throw new PluginApiError(400, "INVALID_PATH", "Enter a local folder path.");
  return pluginJson(await reviewLocalRuntime(ctx, localPath, input.fingerprint));
}
