import { collectionDelete } from "../../../../../../../packages/shared/actions/workspace";
import { collectionPatch } from "../../../../../../../packages/shared/actions/workspace";
import { collectionRead } from "../../../../../../../packages/shared/actions/workspace";
import {
  addMasterItem,
  deleteMasterItem,
  deleteMasterList,
  getMasterList,
  promoteItemToMaster,
  reorderMasterItems,
  updateMasterItem,
  updateMasterList,
} from "../../../../lib/checklists/storage";
import { CollectionRoutePatchSchema, formatZodError } from "../../../../lib/schemas";
import { withErrorHandler } from "../../../../lib/api-utils";

type Params = { params: Promise<{ id: string }> };


export const GET = withErrorHandler(async (_req: Request, { params }: Params) => {
  const { id } = await params;

  return await collectionRead.handler({ id }, { execute: async () => {
    const master = getMasterList(id);
    if (!master) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json(master);
  } }) as Response;
}, "collections.id.get");

export const PATCH = withErrorHandler(async (req: Request, { params }: Params) => {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = CollectionRoutePatchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }


  return await collectionPatch.handler({ id, body: parsed.data }, { execute: async () => {
    const action = parsed.data;
    if (action.action === "updateCollection") {
      try {
        const master = await updateMasterList(id, action.collection);
        if (!master) return Response.json({ error: "Not found" }, { status: 404 });
        return Response.json(master);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Update failed";
        return Response.json({ error: message }, { status: 409 });
      }
    }
    if (action.action === "addItem") {
      const item = await addMasterItem(id, action.item);
      if (!item) return Response.json({ error: "Not found" }, { status: 404 });
      return Response.json(item, { status: 201 });
    }
    if (action.action === "updateItem") {
      const item = await updateMasterItem(id, action.itemId, action.item);
      if (!item) return Response.json({ error: "Not found" }, { status: 404 });
      return Response.json(item);
    }
    if (action.action === "deleteItem") {
      const ok = await deleteMasterItem(id, action.itemId);
      return ok ? Response.json({ ok: true }) : Response.json({ error: "Not found" }, { status: 404 });
    }
    if (action.action === "promoteItem") {
      const item = await promoteItemToMaster(id, {
        name: action.name,
        checked: action.checked,
      });
      if (!item) return Response.json({ error: "Not found" }, { status: 404 });
      return Response.json(item);
    }

    const master = await reorderMasterItems(id, action.itemIds);
    if (!master) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json(master);
  } }) as Response;
}, "collections.id.patch");

export const DELETE = withErrorHandler(async (_req: Request, { params }: Params) => {
  const { id } = await params;

  return await collectionDelete.handler({ id }, { execute: async () => {
    const ok = await deleteMasterList(id);
    return ok ? Response.json({ ok: true }) : Response.json({ error: "Not found" }, { status: 404 });
  } }) as Response;
}, "collections.id.delete");
