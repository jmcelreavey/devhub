import { notesMediaRead } from "../../../../../../../packages/shared/actions/notes-media";
import { withErrorHandler } from "../../../../lib/api-utils";
import { noteMediaMime, readNoteMedia } from "../../../../lib/notes/media-store";

type Params = { params: Promise<{ name: string }> };


export const GET = withErrorHandler(async (_req: Request, { params }: Params) => {
  const input = notesMediaRead.input.parse(await params);
  return await notesMediaRead.handler(input, { execute: ({ name }) => {
    const mime = noteMediaMime(name);
    if (!mime) return Response.json({ error: "Not found" }, { status: 404 });

    const data = readNoteMedia(name);
    if (!data) return Response.json({ error: "Not found" }, { status: 404 });

    return new Response(new Uint8Array(data), {
      status: 200,
      headers: {
        "Content-Type": mime,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        // Name is the content hash, so the bytes behind it never change.
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } }) as Response;
}, "notes-media.get");
