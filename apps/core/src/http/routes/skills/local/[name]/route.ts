import { skillLocalDelete } from "../../../../../../../../packages/shared/actions/workspace";
import { skillLocalRead } from "../../../../../../../../packages/shared/actions/workspace";
import { withErrorHandler } from "../../../../../lib/api-utils";
import { readLocalSkillContent } from "../../../../../lib/local/catalog-content";
import { deleteLocalSkillInstallations } from "../../../../../lib/local/catalog-delete";
import { getResourceRoot } from "../../../../../lib/desktop/runtime-paths";


export const GET = withErrorHandler(async (_req, ctx: { params: Promise<{ name: string }> }) => {
  const { name } = await ctx.params;

  return await skillLocalRead.handler({ name }, { execute: async () => {
    const content = readLocalSkillContent(getResourceRoot(), name);
    if (content === null) {
      return Response.json({ error: "Local skill not found" }, { status: 404 });
    }
    return Response.json({ content });
  } }) as Response;
}, "skills.local.name");

export const DELETE = withErrorHandler(async (_req, ctx: { params: Promise<{ name: string }> }) => {
  const { name } = await ctx.params;

  return await skillLocalDelete.handler({ name }, { execute: async () => {
    const result = deleteLocalSkillInstallations(getResourceRoot(), name);
    if (!result) {
      return Response.json({ error: "Local skill not found" }, { status: 404 });
    }
    return Response.json({ ok: true, ...result });
  } }) as Response;
}, "skills.local.name.delete");
