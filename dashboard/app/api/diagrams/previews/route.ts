import { NextResponse, type NextRequest } from "next/server";
import { withErrorHandler, parseBody } from "@/lib/api-utils";
import { DiagramPreviewsSchema } from "@/lib/schemas";
import { getDiagramPreviews } from "@/lib/diagrams/diagram-preview";

export const dynamic = "force-dynamic";

export const POST = withErrorHandler(async (req: NextRequest) => {
  const parsed = await parseBody(req, DiagramPreviewsSchema);
  if (!parsed.ok) return parsed.response;
  return NextResponse.json({ previews: getDiagramPreviews(parsed.data.paths) });
}, "diagrams.previews.post");
