import { requireDashboardAuth, withErrorHandler } from "../../../../lib/api-utils";
import { httpAction } from "../../../../lib/actions/http";
import { terminalPasteImage } from "../../../../../../../packages/shared/actions/terminal";
import {
  TERMINAL_PASTE_IMAGE_MAX_BYTES,
  TERMINAL_PASTE_IMAGE_MAX_FILES,
} from "../../../../../../../packages/shared/ui-lib/terminal/paste-image";
import {
  normalizePasteImageMime,
  writeTerminalPasteImages,
} from "../../../../lib/terminal/paste-image-fs";


/**
 * Write pasted/dropped images to a temp dir the PTY can read, return absolute paths.
 * multipart field `files` (one or more). CLI-agnostic — dock injects paths into stdin.
 */
export const POST = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Expected multipart form data." }, { status: 400 });
  }

  const entries = form.getAll("files");
  if (entries.length === 0) {
    return Response.json({ error: "No files uploaded." }, { status: 400 });
  }
  if (entries.length > TERMINAL_PASTE_IMAGE_MAX_FILES) {
    return Response.json(
      { error: `Max ${TERMINAL_PASTE_IMAGE_MAX_FILES} images.` },
      { status: 400 },
    );
  }

  const inputs: { bytes: Buffer; mime: string; name?: string }[] = [];
  for (const entry of entries) {
    if (typeof entry === "string" || !entry || typeof entry.arrayBuffer !== "function") {
      return Response.json({ error: "Each files entry must be a binary file." }, { status: 400 });
    }
    const file = entry as File;
    const mime = normalizePasteImageMime(file.type || "", file.name || "");
    if (!mime) {
      return Response.json(
        { error: `${file.name || "file"} isn’t a supported image.` },
        { status: 400 },
      );
    }
    if (file.size <= 0) {
      return Response.json({ error: `${file.name || "image"} is empty.` }, { status: 400 });
    }
    if (file.size > TERMINAL_PASTE_IMAGE_MAX_BYTES) {
      return Response.json(
        {
          error: `${file.name || "image"} is too big (${Math.round(TERMINAL_PASTE_IMAGE_MAX_BYTES / 1_048_576)} MB max).`,
        },
        { status: 400 },
      );
    }
    const buf = Buffer.from(await file.arrayBuffer());
    inputs.push({ bytes: buf, mime, name: file.name || undefined });
  }

  return httpAction(terminalPasteImage, {
    input: () => ({ files: inputs }),
    context: () => ({ write: async (files) => {
      try {
        const paths = await writeTerminalPasteImages(files.map(({ bytes, ...file }) => ({
          ...file,
          bytes: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
        })));
        return { status: 201, body: { paths } };
      } catch (error) {
        return { status: 400, body: { error: error instanceof Error ? error.message : "Could not write images" } };
      }
    } }),
    response: ({ status, body }) => Response.json(body, { status }),
  })(req);
}, "terminal.paste-image.post");
