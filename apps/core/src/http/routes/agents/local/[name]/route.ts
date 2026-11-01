import { withErrorHandler } from "../../../../../lib/api-utils";
import { httpAction } from "../../../../../lib/actions/http";
import { localAgentDelete, localAgentRead } from "../../../../../../../../packages/shared/actions/agents";
import { readLocalAgentContent } from "../../../../../lib/local/catalog-content";
import { deleteLocalAgentInstallations } from "../../../../../lib/local/catalog-delete";
import { getResourceRoot } from "../../../../../lib/desktop/runtime-paths";


export const GET = withErrorHandler(async (_req: Request, ctx: { params: Promise<{ name: string }> }) => {
  const { name } = await ctx.params;
  return httpAction(localAgentRead, {
    input: () => ({ name }),
    context: () => ({ execute: ({ name }) => {
      const content = readLocalAgentContent(getResourceRoot(), name);
      if (content === null) {
        return Response.json({ error: "Local agent not found" }, { status: 404 });
      }
      return Response.json({ content });
    } }),
    response: (response) => response as Response,
  })(_req);
}, "agents.local.name");

export const DELETE = withErrorHandler(async (_req: Request, ctx: { params: Promise<{ name: string }> }) => {
  const { name } = await ctx.params;
  return httpAction(localAgentDelete, {
    input: () => ({ name }),
    context: () => ({ execute: ({ name }) => {
      const result = deleteLocalAgentInstallations(getResourceRoot(), name);
      if (!result) {
        return Response.json({ error: "Local agent not found" }, { status: 404 });
      }
      return Response.json({ ok: true, ...result });
    } }),
    response: (response) => response as Response,
  })(_req);
}, "agents.local.name.delete");
