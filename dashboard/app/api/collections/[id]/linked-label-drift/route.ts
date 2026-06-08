import { NextResponse } from "next/server";
import { countLinkedLabelDriftAcrossNotes } from "@/lib/checklists/note-label-propagation";
import { getMasterList } from "@/lib/checklists/storage";
import { masterItemById } from "@/lib/checklists/resolution";
import { getStorage } from "@/lib/storage-server";
import { withErrorHandler } from "@/lib/api-utils";

type Params = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

export const GET = withErrorHandler(async (req: Request, { params }: Params) => {
  const { id: masterListId } = await params;
  const itemId = new URL(req.url).searchParams.get("itemId")?.trim();
  if (!itemId) {
    return NextResponse.json({ error: "itemId is required" }, { status: 400 });
  }

  const master = getMasterList(masterListId);
  const item = masterItemById(master ?? undefined, itemId);
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const excludeNotePath = new URL(req.url).searchParams.get("excludeNotePath")?.trim() || undefined;
  const summary = countLinkedLabelDriftAcrossNotes(getStorage(), masterListId, itemId, excludeNotePath);

  return NextResponse.json({
    masterLabel: item.name,
    ...summary,
  });
}, "collections.linked-label-drift.get");
