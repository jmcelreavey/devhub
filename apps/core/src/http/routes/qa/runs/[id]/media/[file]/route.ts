import { qaMedia } from "../../../../../../../../../../packages/shared/actions/misc-ui";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { requireDashboardAuth, withErrorHandler } from "../../../../../../../lib/api-utils";
import { artifactPath } from "../../../../../../../lib/qa/store";
export const GET = withErrorHandler(async (req: Request, context: { params: Promise<{ id: string; file: string }> }) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const input = qaMedia.input.parse({ ...await context.params, range: req.headers.get("range") });
  return await qaMedia.handler(input, { execute: readMedia }) as Response;
}, "qa.media");

async function readMedia({ id, file, range }: ReturnType<typeof qaMedia.input.parse>) {
  if (!/^[a-f0-9-]{36}$/.test(id)) return Response.json({ error: "Invalid run ID." }, { status: 400 });
  const target = artifactPath(id, file);
  if (!target) return Response.json({ error: "QA artifact not found." }, { status: 404 });
  const types: Record<string, string> = { png: "image/png", webm: "video/webm", mp4: "video/mp4" };
  const contentType = types[file.split(".").at(-1) ?? ""];
  if (!contentType) return Response.json({ error: "Unsupported artifact." }, { status: 415 });
  const { size } = await fs.stat(target);
  let start = 0, end = size - 1;
  const unsatisfiable = () => new Response(null, { status: 416, headers: { "Content-Range": "bytes */" + size } });
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) return unsatisfiable();
    start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
    end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return unsatisfiable();
  }
  const headers = new Headers({ "Content-Type": contentType, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff", "Accept-Ranges": "bytes", "Content-Length": String(end - start + 1) });
  if (range) headers.set("Content-Range", "bytes " + start + "-" + end + "/" + size);
  if (!size) return new Response(null, { headers });
  const stream = Readable.toWeb(createReadStream(target, { start, end })) as ReadableStream<Uint8Array>;
  return new Response(stream, { status: range ? 206 : 200, headers });
}
