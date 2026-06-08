import { NextRequest, NextResponse } from "next/server";
import { assertNoteAssetRelPath, contentTypeForAssetPath } from "@/lib/notes-assets";
import { getStorage } from "@/lib/storage-server";
import { withErrorHandler } from "@/lib/api-utils";

type Params = { params: Promise<{ path: string[] }> };

export const dynamic = "force-dynamic";

export const GET = withErrorHandler(async (_req: NextRequest, { params }: Params) => {
  const { path: segments } = await params;
  const relPath = assertNoteAssetRelPath(segments.join("/"));
  const data = getStorage().readAsset(relPath);
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return new NextResponse(new Uint8Array(data), {
    status: 200,
    headers: {
      "Content-Type": contentTypeForAssetPath(relPath),
      "Cache-Control": "private, max-age=3600",
    },
  });
}, "notes-assets.get");
