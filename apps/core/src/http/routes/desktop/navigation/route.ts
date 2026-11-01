import { parseBody,requireDashboardAuth,withErrorHandler } from "../../../../lib/api-utils";
import {
publishDesktopNavigation,
subscribeToDesktopNavigation,
type DesktopNavigation,
} from "../../../../lib/desktop/navigation";
import { hasBrowserNavigationIntent } from "../../../../lib/desktop/navigation-intent";
import { desktopNavigation, desktopNavigationInput, desktopNavigationStream } from "../../../../../../../packages/shared/actions/ui";


const encoder = new TextEncoder();

export const GET = withErrorHandler(async (req: Request) => {
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

  return desktopNavigationStream.handler({}, { subscribe: () => new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream",
    },
  }) }) as Response;
}, "desktop-navigation-stream");

export const POST = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, desktopNavigationInput);
  if (!parsed.ok) return parsed.response;

  return desktopNavigation.handler(parsed.data, { publish: (input) => {
  if (!hasBrowserNavigationIntent(req.headers)) {
    return Response.json({ delivered: 0, suppressed: true, href: input.href });
  }

  const delivered = publishDesktopNavigation(input);
  if (delivered === 0) {
    return Response.json({ error: "The DevHub desktop app is not connected." }, { status: 409 });
  }
  return Response.json({ delivered });
  } }) as Response;
}, "desktop-navigation-publish");
