import { collectionCreate } from "../../../../../../packages/shared/actions/workspace";
import { collectionsList } from "../../../../../../packages/shared/actions/workspace";
import {
  createMasterList,
  getMasterForNotePath,
  listMasterLists,
} from "../../../lib/checklists/storage";
import { normalizeScopePath } from "../../../../../../packages/shared/ui-lib/checklists/paths";
import { MasterListCreateSchema, formatZodError } from "../../../lib/schemas";
import { withErrorHandler } from "../../../lib/api-utils";


export const GET = withErrorHandler(async (req: Request) => {
  return await collectionsList.handler({ notePath: new URL(req.url).searchParams.get("notePath") ?? undefined }, { execute: async () => {
    const notePath = new URL(req.url).searchParams.get("notePath")?.trim();
    const masters = listMasterLists();
    if (!notePath) return Response.json(masters);

    const master = getMasterForNotePath(notePath, masters);
    return Response.json(master ? [master] : []);
  } }) as Response;
}, "collections.get");

export const POST = withErrorHandler(async (req: Request) => {
  const body = await req.json().catch(() => ({}));
  const parsed = MasterListCreateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }

  return await collectionCreate.handler(parsed.data, { execute: async () => {
    try {
      const master = await createMasterList({
        name: parsed.data.name,
        scopePath: normalizeScopePath(parsed.data.scopePath),
        icon: parsed.data.icon,
      });
      return Response.json(master, { status: 201 });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not create master list";
      return Response.json({ error: message }, { status: 409 });
    }
  } }) as Response;
}, "collections.post");
