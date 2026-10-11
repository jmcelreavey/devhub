import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseBody } from "@/lib/api-utils";
import { browserHumanRequest, browserError } from "@/lib/browser/access";
import { currentBrowser, browserStatus } from "@/lib/browser/runtime";
import { SurfaceInputSchema } from "@/lib/browser/surface";

const Schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("stream"), sessionId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("input"), sessionId: z.string().uuid(), streamId: z.string().uuid(), input: SurfaceInputSchema }).strict(),
  z.object({ action: z.literal("tab"), sessionId: z.string().uuid(), tabId: z.string().uuid(), close: z.boolean().default(false) }).strict(),
  z.object({ action: z.literal("dialog"), sessionId: z.string().uuid(), dialogId: z.string().uuid(), accept: z.boolean(), text: z.string().max(2000).optional() }).strict(),
  z.object({ action: z.literal("reject-transfer"), sessionId: z.string().uuid(), transferId: z.string().uuid() }).strict(),
]);
export async function POST(req: NextRequest) {
  const denied = browserHumanRequest(req); if (denied) return denied;
  const parsed = await parseBody(req, Schema); if (!parsed.ok) return parsed.response;
  const input = parsed.data;
  try {
    const surface = currentBrowser(input.sessionId).surface;
    if (!surface) throw new Error("Restart the browser to enable its live view.");
    if (input.action === "stream") {
      const encoder = new TextEncoder();
      let stop: (() => Promise<void>) | undefined, ended = false;
      let pendingFrame: Uint8Array | undefined;
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          const close = () => { if (!ended) { ended = true; pendingFrame = undefined; controller.close(); } };
          const send = (event: string, data: unknown) => {
            if (ended || req.signal.aborted) return false;
            if (event === "heartbeat" && (controller.desiredSize ?? 0) <= 0) return true;
            const chunk = encoder.encode("event: " + event + "\ndata: " + JSON.stringify(data) + "\n\n");
            // Keep only the newest waiting frame, including the final image of a static page.
            if (event === "frame" && (controller.desiredSize ?? 0) <= 0) { pendingFrame = chunk; return true; }
            if (event === "frame") pendingFrame = undefined;
            controller.enqueue(chunk);
            if (event === "closed") close();
            return true;
          };
          req.signal.addEventListener("abort", () => { close(); void stop?.(); }, { once: true });
          try {
            stop = await surface.openStream(send);
            if (req.signal.aborted || ended) await stop();
          } catch { send("failure", { message: "Live view could not connect. Open an approved site in Chrome, then reconnect." }); close(); }
        },
        pull(controller) {
          if (!ended && pendingFrame) { const frame = pendingFrame; pendingFrame = undefined; controller.enqueue(frame); }
        },
        cancel() { ended = true; pendingFrame = undefined; void stop?.(); },
      });
      return new Response(body, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" } });
    }
    if (input.action === "input") await surface.input(input.streamId, input.input);
    else if (input.action === "tab") await surface.selectTab(input.tabId, input.close);
    else if (input.action === "dialog") await surface.answerDialog(input.dialogId, input.accept, input.text);
    else {
      if (currentBrowser(input.sessionId).view.transfer?.id !== input.transferId) throw new Error("This transfer already closed.");
      await surface.rejectTransfer();
    }
    return NextResponse.json(browserStatus(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return browserError(error); }
}
