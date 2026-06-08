import { NextResponse } from "next/server";
import {
  addMasterItem,
  deleteMasterItem,
  deleteMasterList,
  getMasterList,
  promoteItemToMaster,
  reorderMasterItems,
  updateMasterItem,
  updateMasterList,
} from "@/lib/checklists/storage";
import { CollectionRoutePatchSchema, formatZodError } from "@/lib/schemas";
import { withErrorHandler } from "@/lib/api-utils";

type Params = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

export const GET = withErrorHandler(async (_req: Request, { params }: Params) => {
  const { id } = await params;
  const master = getMasterList(id);
  if (!master) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(master);
}, "collections.id.get");

export const PATCH = withErrorHandler(async (req: Request, { params }: Params) => {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = CollectionRoutePatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }

  const action = parsed.data;
  if (action.action === "updateCollection") {
    try {
      const master = await updateMasterList(id, action.collection);
      if (!master) return NextResponse.json({ error: "Not found" }, { status: 404 });
      return NextResponse.json(master);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Update failed";
      return NextResponse.json({ error: message }, { status: 409 });
    }
  }
  if (action.action === "addItem") {
    const item = await addMasterItem(id, action.item);
    if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(item, { status: 201 });
  }
  if (action.action === "updateItem") {
    const item = await updateMasterItem(id, action.itemId, action.item);
    if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(item);
  }
  if (action.action === "deleteItem") {
    const ok = await deleteMasterItem(id, action.itemId);
    return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (action.action === "promoteItem") {
    const item = await promoteItemToMaster(id, {
      name: action.name,
      checked: action.checked,
    });
    if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(item);
  }

  const master = await reorderMasterItems(id, action.itemIds);
  if (!master) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(master);
}, "collections.id.patch");

export const DELETE = withErrorHandler(async (_req: Request, { params }: Params) => {
  const { id } = await params;
  const ok = await deleteMasterList(id);
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}, "collections.id.delete");
