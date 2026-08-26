import { NextRequest, NextResponse } from "next/server";
import { requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import {
  TERMINAL_PASTE_IMAGE_MAX_BYTES,
  TERMINAL_PASTE_IMAGE_MAX_FILES,
} from "@/lib/terminal-paste-image";
import {
  normalizePasteImageMime,
  writeTerminalPasteImages,
} from "@/lib/terminal-paste-image-fs";

export const dynamic = "force-dynamic";

/**
 * Write pasted/dropped images to a temp dir the PTY can read, return absolute paths.
 * multipart field `files` (one or more). CLI-agnostic — dock injects paths into stdin.
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

  const entries = form.getAll("files");
  if (entries.length === 0) {
    return NextResponse.json({ error: "No files uploaded." }, { status: 400 });
  }
  if (entries.length > TERMINAL_PASTE_IMAGE_MAX_FILES) {
    return NextResponse.json(
      { error: `Max ${TERMINAL_PASTE_IMAGE_MAX_FILES} images.` },
      { status: 400 },
    );
  }

  const inputs: { bytes: Buffer; mime: string; name?: string }[] = [];
  for (const entry of entries) {
    if (typeof entry === "string" || !entry || typeof entry.arrayBuffer !== "function") {
      return NextResponse.json({ error: "Each files entry must be a binary file." }, { status: 400 });
    }
    const file = entry as File;
    const mime = normalizePasteImageMime(file.type || "", file.name || "");
    if (!mime) {
      return NextResponse.json(
        { error: `${file.name || "file"} isn’t a supported image.` },
        { status: 400 },
      );
    }
    if (file.size <= 0) {
      return NextResponse.json({ error: `${file.name || "image"} is empty.` }, { status: 400 });
    }
    if (file.size > TERMINAL_PASTE_IMAGE_MAX_BYTES) {
      return NextResponse.json(
        {
          error: `${file.name || "image"} is too big (${Math.round(TERMINAL_PASTE_IMAGE_MAX_BYTES / 1_048_576)} MB max).`,
        },
        { status: 400 },
      );
    }
    const buf = Buffer.from(await file.arrayBuffer());
    inputs.push({ bytes: buf, mime, name: file.name || undefined });
  }

  try {
    const paths = await writeTerminalPasteImages(inputs);
    return NextResponse.json({ paths }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not write images" },
      { status: 400 },
    );
  }
}, "terminal.paste-image.post");
