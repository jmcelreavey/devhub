import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { browserHumanRequest, browserError } from "@/lib/browser/access";
import { currentBrowser } from "@/lib/browser/runtime";
import { TRANSFER_LIMIT, downloadName } from "@/lib/browser/surface";

export async function POST(req: NextRequest) {
  const denied = browserHumanRequest(req); if (denied) return denied;
  try {
    const sessionId = z.string().uuid().parse(req.nextUrl.searchParams.get("session"));
    const id = z.string().uuid().parse(req.nextUrl.searchParams.get("transfer"));
    const session = currentBrowser(sessionId);
    const surface = session.surface;
    const transfer = session.view.transfer;
    if (!surface || !transfer || transfer.id !== id) throw new Error("This transfer expired. Request it from the site again.");
    if (transfer.kind === "download") {
      const buffer = await surface.download(id);
      return new Response(new Uint8Array(buffer), { headers: {
        "Content-Type": "application/octet-stream", "Cache-Control": "no-store",
        "Content-Disposition": "attachment; filename*=UTF-8''" + encodeURIComponent(downloadName(transfer.name)),
        "X-Content-Type-Options": "nosniff",
      } });
    }
    const name = z.string().min(1).max(500).parse(req.headers.get("x-file-name"));
    if (Number(req.headers.get("content-length")) > TRANSFER_LIMIT) throw new Error("Choose a file no larger than 20 MiB.");
    const reader = req.body?.getReader();
    if (!reader) throw new Error("Choose a file first.");
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > TRANSFER_LIMIT) { await reader.cancel(); throw new Error("Choose a file no larger than 20 MiB."); }
        chunks.push(chunk.value);
      }
    } finally { reader.releaseLock(); }
    const mimeType = z.string().max(200).regex(/^[a-zA-Z0-9][a-zA-Z0-9!#$&^_.+-]*\/[a-zA-Z0-9][a-zA-Z0-9!#$&^_.+-]*$/)
      .parse(req.headers.get("content-type")?.split(";")[0].trim() || "application/octet-stream");
    await surface.upload(id, { name: decodeURIComponent(name), mimeType, buffer: Buffer.concat(chunks) });
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return browserError(error); }
}
