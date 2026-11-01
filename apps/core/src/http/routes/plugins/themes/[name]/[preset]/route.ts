import { pluginThemeAsset } from "../../../../../../../../../packages/shared/actions/plugins";
import { assertPluginManagement, pluginError, pluginJson, serverPluginContext } from "../../../../../../lib/plugins/http";
import { runtimeThemeAsset } from "../../../../../../lib/plugins/runtime-themes";
import { runtimeThemeResponse } from "../../../../../../lib/plugins/runtime-theme-response";

export async function GET(req: Request, context: { params: Promise<{ name: string; preset: string }> }) {
  const auth = assertPluginManagement(req);
  if (!auth.ok) return auth.response;
  try {
    const { name, preset } = await context.params;
    const ctx = serverPluginContext();
    const input = pluginThemeAsset.input.parse({ name, preset, revision: new URL(req.url).searchParams.get("revision") ?? "", asset: new URL(req.url).searchParams.get("asset") ?? "" });
    return await pluginThemeAsset.handler(input, { execute: (selection) => {
      const result = runtimeThemeAsset(ctx, selection.name, selection.preset, selection.revision, selection.asset);
    // Never serve plugin HTML as a document on the core's origin.
      if (result.kind === "html") return pluginJson({ html: new TextDecoder("utf-8", { fatal: true }).decode(result.bytes) });
      return runtimeThemeResponse(result.bytes, result.mime, req.headers.get("range"));
    } }) as Response;
  } catch (error) { return pluginError(error); }
}
