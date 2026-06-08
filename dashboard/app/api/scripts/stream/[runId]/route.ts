import { NextRequest } from "next/server";
import { getRun } from "@/lib/scripts-runner";

type Params = { params: Promise<{ runId: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { runId } = await params;
  const run = getRun(runId);
  if (!run) {
    return new Response("Run not found", { status: 404 });
  }

  const encoder = new TextEncoder();
  const capturedRun = run;
  const stream = new ReadableStream({
    start(controller) {
      function send(line: string) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(line)}\n\n`));
      }

      // Replay buffered lines
      for (const line of capturedRun.lines) send(line);

      // If already finished, close immediately
      if (capturedRun.exitCode !== undefined) {
        controller.enqueue(encoder.encode(`event: done\ndata: ${capturedRun.exitCode}\n\n`));
        controller.close();
        return;
      }

      // Subscribe to future lines
      function onLine(line: string) {
        if (line === "[DONE]") {
          controller.enqueue(
            encoder.encode(`event: done\ndata: ${capturedRun.exitCode ?? 1}\n\n`)
          );
          capturedRun.subscribers.delete(onLine);
          controller.close();
        } else {
          send(line);
        }
      }
      capturedRun.subscribers.add(onLine);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
