import { NextRequest, NextResponse } from "next/server";
import { requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { toNoteAssetApiUrl } from "@/lib/notes-assets";
import {
  NOTES_PASTE_IMAGE_MAX_BYTES,
  buildNotePasteAssetRelPath,
  extForNotePasteImage,
  isNotePasteImageFile,
} from "@/lib/notes/paste-image";
import { getStorage } from "@/lib/storage-server";

export const dynamic = "force-dynamic";

/**
 * Write a pasted/dropped image next to a note under `{noteSlug}/assets/…`.
 * multipart: `file` (binary) + `notePath` (notes slug without `.json`).
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data." }, { status: 400 });
  }

  const notePathRaw = form.get("notePath");
  if (typeof notePathRaw !== "string" || !notePathRaw.trim()) {
    return NextResponse.json({ error: "notePath is required." }, { status: 400 });
  }

  const entry = form.get("file");
  if (typeof entry === "string" || !entry || typeof entry.arrayBuffer !== "function") {
    return NextResponse.json({ error: "file must be a binary upload." }, { status: 400 });
  }
  const file = entry as File;

  if (!isNotePasteImageFile(file)) {
    return NextResponse.json(
      { error: `${file.name || "file"} isn’t a supported image.` },
      { status: 400 },
    );
  }
  if (file.size <= 0) {
    return NextResponse.json({ error: `${file.name || "image"} is empty.` }, { status: 400 });
  }
  if (file.size > NOTES_PASTE_IMAGE_MAX_BYTES) {
    return NextResponse.json(
      {
        error: `${file.name || "image"} is too big (${Math.round(NOTES_PASTE_IMAGE_MAX_BYTES / 1_048_576)} MB max).`,
      },
      { status: 400 },
    );
  }

  let assetPath: string;
  try {
    assetPath = buildNotePasteAssetRelPath(notePathRaw, {
      ext: extForNotePasteImage(file.type || "", file.name || ""),
      name: file.name || undefined,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Invalid note path." },
      { status: 400 },
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  try {
    const written = getStorage().writeAsset(assetPath, bytes);
    return NextResponse.json(
      {
        path: written.path,
        url: toNoteAssetApiUrl(written.path),
        size: written.size,
      },
      { status: 201 },
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not write image" },
      { status: 400 },
    );
  }
}, "notes-assets.post");
