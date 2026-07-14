import { withErrorHandler } from "@/lib/api-utils";
import { buildBriefingContext } from "@/lib/briefing-context";
import { readCanvas, renderCanvasDocument } from "@/lib/briefing-canvas";
import { decodeTheme } from "@/lib/briefing-theme";

export const dynamic = "force-dynamic";

// Serves the bespoke canvas as a full same-origin HTML document, with the live
// data + host theme injected. The /briefing page embeds this in an iframe.
// Same-origin + full access is deliberate (see lib/briefing-canvas.ts).
export const GET = withErrorHandler(async (request: Request) => {
  const url = new URL(request.url);
  const refresh = url.searchParams.get("refresh") === "1";
  const theme = decodeTheme(url.searchParams.get("theme"));
  const context = await buildBriefingContext({ refresh });
  const canvas = readCanvas();
  const html = renderCanvasDocument(canvas.html, context, theme);

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
      "X-Frame-Options": "SAMEORIGIN",
    },
  });
}, "briefing.canvas");
