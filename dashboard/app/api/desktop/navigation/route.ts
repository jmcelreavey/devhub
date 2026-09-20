import { parseBody,requireDashboardAuth,withErrorHandler } from "@/lib/api-utils";
import {
publishDesktopNavigation,
subscribeToDesktopNavigation,
type DesktopNavigation,
} from "@/lib/desktop/navigation";
import { hasBrowserNavigationIntent } from "@/lib/desktop/navigation-intent";
import { NextResponse,type NextRequest } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const NavigationSchema = z.object({
  href: z
    .string()
    .trim()
    .min(1)
    .max(4_096)
    .refine((href) => href.startsWith("/") && !href.startsWith("//"), "Must be an internal DevHub path"),
  newTab: z.literal(true),
});

const encoder = new TextEncoder();

export const GET = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;

  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let active = true;
      const send = (navigation: DesktopNavigation) => {
        if (active) controller.enqueue(encoder.encode(`data: ${JSON.stringify(navigation)}\n\n`));
      };
      const unsubscribe = subscribeToDesktopNavigation(send);
      const heartbeat = setInterval(() => {
        if (active) controller.enqueue(encoder.encode(": keep-alive\n\n"));
      }, 15_000);

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
}, "desktop-navigation-stream");

export const POST = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, NavigationSchema);
  if (!parsed.ok) return parsed.response;

  if (!hasBrowserNavigationIntent(req.headers)) {
    return NextResponse.json({ delivered: 0, suppressed: true, href: parsed.data.href });
  }

  const delivered = publishDesktopNavigation(parsed.data);
  if (delivered === 0) {
    return NextResponse.json({ error: "The DevHub desktop app is not connected." }, { status: 409 });
  }
  return NextResponse.json({ delivered });
}, "desktop-navigation-publish");
