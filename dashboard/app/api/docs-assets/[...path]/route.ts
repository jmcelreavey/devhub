import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { withErrorHandler } from "@/lib/api-utils";
import { getDocsDir } from "@/lib/content/dirs";
import { contentTypeForDocAsset } from "@/lib/docs/asset-src";

type Params = { params: Promise<{ path: string[] }> };

export const dynamic = "force-dynamic";

/**
 * Serve binary assets referenced by docs — the demo GIFs, mainly.
 *
 * Mirrors `/api/notes-assets`, and exists for the same reason: markdown embeds
 * files by relative path, and the viewer needs somewhere to fetch them from
 * that isn't a page route.
 *
 * Two guards, both load-bearing. The resolved path must stay inside DOCS_DIR,
 * checked after `path.resolve` so encoded or nested traversal cannot slip past
 * a string comparison. And the extension must be one we know how to serve —
 * an allowlist, so a doc cannot coax this route into handing back `.env` or a
 * `.md` source file just by linking to it.
 */
/**
 * WebKit (the desktop shell's webview) will not play a video whose server
 * ignores `Range`, so honour a single `bytes=` range. Anything else gets the
 * whole file, which every client accepts.
 */
function byteRange(header: string | null, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header?.trim() ?? "");
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  return start <= end && start < size ? { start, end } : null;
}

export const GET = withErrorHandler(async (req: NextRequest, { params }: Params) => {
  const { path: segments } = await params;
  const relPath = segments.map((s) => decodeURIComponent(s)).join("/");

  const contentType = contentTypeForDocAsset(relPath);
  if (!contentType) {
    return NextResponse.json({ error: "Unsupported asset type" }, { status: 404 });
  }

  const root = path.resolve(getDocsDir());
  const abs = path.resolve(root, relPath);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let data: Buffer;
  try {
    const stat = fs.statSync(abs);
    if (!stat.isFile()) return NextResponse.json({ error: "Not found" }, { status: 404 });
    data = fs.readFileSync(abs);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const headers = {
    "Content-Type": contentType,
    "Cache-Control": "private, max-age=3600",
    "Accept-Ranges": "bytes",
  };
  const range = byteRange(req.headers.get("range"), data.length);
  if (range) {
    return new NextResponse(new Uint8Array(data.subarray(range.start, range.end + 1)), {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${range.start}-${range.end}/${data.length}` },
    });
  }
  return new NextResponse(new Uint8Array(data), { status: 200, headers });
}, "docs-assets.get");
