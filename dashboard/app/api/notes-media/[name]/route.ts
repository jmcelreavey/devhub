import { NextRequest, NextResponse } from "next/server";
import { withErrorHandler } from "@/lib/api-utils";
import { noteMediaMime, readNoteMedia } from "@/lib/notes/media-store";

type Params = { params: Promise<{ name: string }> };

export const dynamic = "force-dynamic";

export const GET = withErrorHandler(async (_req: NextRequest, { params }: Params) => {
  const { name } = await params;
  const mime = noteMediaMime(name);
  if (!mime) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const data = readNoteMedia(name);
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return new NextResponse(new Uint8Array(data), {
    status: 200,
    headers: {
      "Content-Type": mime,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      // Name is the content hash, so the bytes behind it never change.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}, "notes-media.get");
