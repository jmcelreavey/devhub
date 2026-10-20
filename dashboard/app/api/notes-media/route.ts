import { NextRequest, NextResponse } from "next/server";
import { requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { NOTE_MEDIA_MAX_BYTES, storeNoteMedia } from "@/lib/notes/media-store";

export const dynamic = "force-dynamic";

/**
 * Store a pasted/dropped note image outside the git-tracked notes vault.
 * multipart: `file` (binary). Returns the stable `/api/notes-media/<hash>.<ext>` URL.
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;

  const declared = Number(req.headers.get("content-length"));
  // Multipart framing adds a little; reject obviously oversized bodies before buffering.
  if (Number.isFinite(declared) && declared > NOTE_MEDIA_MAX_BYTES + 64 * 1024) {
    return NextResponse.json({ error: "Image is too big (8 MB max)." }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data." }, { status: 400 });
  }

  const entry = form.get("file");
  if (typeof entry === "string" || !entry || typeof entry.arrayBuffer !== "function") {
    return NextResponse.json({ error: "file must be a binary upload." }, { status: 400 });
  }

  try {
    const stored = storeNoteMedia(Buffer.from(await entry.arrayBuffer()));
    return NextResponse.json(
      { url: stored.url, name: stored.name, mime: stored.mime, size: stored.size },
      { status: stored.created ? 201 : 200 },
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not store image." },
      { status: 400 },
    );
  }
}, "notes-media.post");
