import { personaLocalRead } from "../../../../../../../packages/shared/actions/workspace";
import { getRepoRoot } from "../../../../lib/notes/dir";
import { withErrorHandler } from "../../../../lib/api-utils";
import { listPersonaSources, listPersonaTools, readPersonaBlock } from "../../../../lib/collect/persona";


/**
 * Returns the marker-block contents from each tool's config for the requested
 * source(s) so the dashboard can show a diff before pulling them back.
 *
 * Without query params: returns the list of tools + sources.
 * With ?tool=cursor&source=identity: returns the block + repo source content.
 */
export const GET = withErrorHandler(async (req: Request) => {
  const tool = new URL(req.url).searchParams.get("tool");
  const source = new URL(req.url).searchParams.get("source");

  return await personaLocalRead.handler({ tool, source }, { execute: async () => {
    if (!tool && !source) {
      return Response.json({
        tools: listPersonaTools(),
        sources: listPersonaSources(),
      });
    }
    if (!tool || !source) {
      return Response.json(
        { error: "Both `tool` and `source` query params are required." },
        { status: 400 },
      );
    }
    const result = readPersonaBlock(getRepoRoot(), tool, source);
    if ("error" in result) return Response.json(result, { status: 400 });
    return Response.json(result);
  } }) as Response;
}, "persona.local");
