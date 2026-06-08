import { NextResponse } from "next/server";
import { propagateLinkedEntryLabelToNotes } from "@/lib/checklists/note-label-propagation";
import { getMasterList } from "@/lib/checklists/storage";
import { masterItemById } from "@/lib/checklists/resolution";
import { getStorage } from "@/lib/storage-server";
import { SyncLinkedLabelsSchema, formatZodError } from "@/lib/schemas";
import { withErrorHandler } from "@/lib/api-utils";

type Params = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

export const POST = withErrorHandler(async (req: Request, { params }: Params) => {
  const { id: masterListId } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = SyncLinkedLabelsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }

  const master = getMasterList(masterListId);
  const item = masterItemById(master ?? undefined, parsed.data.itemId);
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const result = await propagateLinkedEntryLabelToNotes(
    getStorage(),
    masterListId,
    parsed.data.itemId,
    parsed.data.label,
    parsed.data.excludeNotePath,
  );

  return NextResponse.json(result);
}, "collections.sync-linked-labels.post");
