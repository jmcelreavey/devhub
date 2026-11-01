import { collectionLabelDrift } from "../../../../../../../../packages/shared/actions/workspace";
import { countLinkedLabelDriftAcrossNotes } from "../../../../../lib/checklists/note-label-propagation";
import { getMasterList } from "../../../../../lib/checklists/storage";
import { masterItemById } from "../../../../../../../../packages/shared/ui-lib/checklists/resolution";
import { getStorage } from "../../../../../lib/storage-server";
import { withErrorHandler } from "../../../../../lib/api-utils";

type Params = { params: Promise<{ id: string }> };


export const GET = withErrorHandler(async (req: Request, { params }: Params) => {
  const { id: masterListId } = await params;
  const itemId = new URL(req.url).searchParams.get("itemId")?.trim();
  if (!itemId) {
    return Response.json({ error: "itemId is required" }, { status: 400 });
  }

  const master = getMasterList(masterListId);
  const item = masterItemById(master ?? undefined, itemId);
  if (!item) return Response.json({ error: "Not found" }, { status: 404 });

  const excludeNotePath = new URL(req.url).searchParams.get("excludeNotePath")?.trim() || undefined;

  return await collectionLabelDrift.handler({ id: masterListId, itemId, excludeNotePath }, { execute: async () => {
    const summary = countLinkedLabelDriftAcrossNotes(getStorage(), masterListId, itemId, excludeNotePath);

    return Response.json({
      masterLabel: item.name,
      ...summary,
    });
  } }) as Response;
}, "collections.linked-label-drift.get");
