import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { artifactPath } from "@/lib/qa/store";
export const dynamic = "force-dynamic";
export const GET = withErrorHandler(async (req: NextRequest, context: { params: Promise<{ id: string; file: string }> }) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const { id, file } = await context.params;
  if (!/^[a-f0-9-]{36}$/.test(id)) return NextResponse.json({ error: "Invalid run ID." }, { status: 400 });
  const target = artifactPath(id, file);
  if (!target) return NextResponse.json({ error: "QA artifact not found." }, { status: 404 });
  const types: Record<string, string> = { png: "image/png", webm: "video/webm", mp4: "video/mp4" };
  const contentType = types[file.split(".").at(-1) ?? ""];
  if (!contentType) return NextResponse.json({ error: "Unsupported artifact." }, { status: 415 });
  const { size } = await fs.stat(target);
  const range = req.headers.get("range");
  let start = 0, end = size - 1;
  const unsatisfiable = () => new NextResponse(null, { status: 416, headers: { "Content-Range": "bytes */" + size } });
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) return unsatisfiable();
    start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
    end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return unsatisfiable();
  }
  const headers = new Headers({ "Content-Type": contentType, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff", "Accept-Ranges": "bytes", "Content-Length": String(end - start + 1) });
  if (range) headers.set("Content-Range", "bytes " + start + "-" + end + "/" + size);
  if (!size) return new NextResponse(null, { headers });
  const stream = Readable.toWeb(createReadStream(target, { start, end })) as ReadableStream<Uint8Array>;
  return new NextResponse(stream, { status: range ? 206 : 200, headers });
}, "qa.media");
