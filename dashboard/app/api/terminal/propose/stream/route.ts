import type { NextRequest } from "next/server";
import { withErrorHandler } from "@/lib/api-utils";
import { subscribeToTerminalProposals } from "@/lib/terminal-proposals";

export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

/**
 * Pings the dock when a proposal is created. Carries no proposal data — the
 * dock still reads `/api/terminal/propose?status=pending` — so it replaces the
 * 2.5s poll without widening what the endpoint exposes.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let active = true;
      // A client can vanish without abort/cancel firing; enqueue then throws.
      // Treat that as the disconnect instead of letting a timer throw forever.
      const send = (chunk: string) => {
        if (!active) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      const unsubscribe = subscribeToTerminalProposals(() => send("data: proposal\n\n"));
      const heartbeat = setInterval(() => send(": keep-alive\n\n"), 15_000);

      cleanup = () => {
        if (!active) return;
        active = false;
        clearInterval(heartbeat);
        unsubscribe();
      };
      req.signal.addEventListener("abort", cleanup, { once: true });
      controller.enqueue(encoder.encode(": connected\n\n"));
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream",
    },
  });
}, "terminal-proposals-stream");
