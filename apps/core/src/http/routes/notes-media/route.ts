import { notesMediaUpload } from "../../../../../../packages/shared/actions/notes-media";
import { requireDashboardAuth, withErrorHandler } from "../../../lib/api-utils";
import { NOTE_MEDIA_MAX_BYTES, storeNoteMedia } from "../../../lib/notes/media-store";
import { queueMediaOcr } from "../../../lib/notes/media-ocr";
import { ContentConflictError } from "../../../../../../packages/shared/storage/content";


/**
 * Store a pasted/dropped note image outside the git-tracked notes vault.
 * multipart: `file` (binary). Returns the stable `/api/notes-media/<hash>.<ext>` URL.
 */
export const POST = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;

  const declared = Number(req.headers.get("content-length"));
  // Multipart framing adds a little; reject obviously oversized bodies before buffering.
  if (Number.isFinite(declared) && declared > NOTE_MEDIA_MAX_BYTES + 64 * 1024) {
    return Response.json({ error: "Image is too big (8 MB max)." }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Expected multipart form data." }, { status: 400 });
  }

  const entry = form.get("file");
  if (typeof entry === "string" || !entry || typeof entry.arrayBuffer !== "function") {
    return Response.json({ error: "file must be a binary upload." }, { status: 400 });
  }

  try {
    const input = notesMediaUpload.input.parse({ bytes: new Uint8Array(await entry.arrayBuffer()) });
    const stored = await notesMediaUpload.handler(input, {
      execute: ({ bytes }) => storeNoteMedia(Buffer.from(bytes)),
    }) as Awaited<ReturnType<typeof storeNoteMedia>>;
    void queueMediaOcr(stored.name).catch(error => console.error("Could not queue screenshot indexing", error));
    return Response.json(
      { url: stored.url, name: stored.name, mime: stored.mime, size: stored.size },
      { status: stored.created ? 201 : 200 },
    );
  } catch (e) {
    if (e instanceof ContentConflictError) return Response.json({ error: e.message }, { status: 409 });
    return Response.json(
      { error: e instanceof Error ? e.message : "Could not store image." },
      { status: 400 },
    );
  }
}, "notes-media.post");
