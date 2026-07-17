import { NextResponse, type NextRequest } from "next/server";
import { isSameOrigin } from "@/lib/api-utils";
import {
  getBriefingImage,
  isImageAiConfigured,
  normalizeImageSize,
} from "@/lib/briefing-images";

export const dynamic = "force-dynamic";

/**
 * Serve an AI-generated image for the briefing canvas:
 * GET /api/briefing/image?prompt=<description>&size=1536x1024
 *
 * Cached on disk per (model, size, prompt) — each unique prompt generates
 * once. 404 when image AI is unconfigured or generation fails, so canvas
 * <img> error fallbacks hide cleanly.
 */
export async function GET(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const prompt = request.nextUrl.searchParams.get("prompt")?.trim() ?? "";
  if (!prompt) {
    return NextResponse.json({ error: "prompt is required" }, { status: 400 });
  }
  if (!isImageAiConfigured()) {
    return NextResponse.json({ error: "Image AI not configured" }, { status: 404 });
  }

  const size = normalizeImageSize(request.nextUrl.searchParams.get("size"));
  const image = await getBriefingImage(prompt, size);
  if (!image) {
    return NextResponse.json({ error: "Image generation failed" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(image), {
    headers: {
      "Content-Type": "image/png",
      // Content is keyed by prompt+size, so it's immutable per URL.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
