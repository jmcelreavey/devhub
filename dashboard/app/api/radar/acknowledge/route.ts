import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withErrorHandler } from "@/lib/api-utils";
import { acknowledge, readAcknowledgements, unacknowledge } from "@/lib/radar/acknowledgements";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  kind: z.enum(["capability", "release"]),
  id: z.string().min(1),
  /**
   * Magnitude at the moment the user acknowledged — repo count for capability
   * signals, pending-advisory count for a dependency.
   *
   * Sent by the client rather than recomputed here on purpose: the user is
   * acknowledging *what they were shown*. Re-deriving it server-side would
   * silently acknowledge a different number if a rescan landed between render
   * and click, and the item would stay hidden at a level the user never saw.
   */
  watermark: z.coerce.number().int().min(0),
});

const DeleteSchema = BodySchema.pick({ kind: true, id: true });

/** POST — mark as seen at the magnitude the user was looking at. */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
      { status: 400 },
    );
  }
  const { kind, id, watermark } = parsed.data;
  return NextResponse.json({ acknowledgements: acknowledge(kind, id, watermark) });
}, "acknowledge radar item");

/** DELETE — undo, so an accidental click is recoverable without editing JSON. */
export const DELETE = withErrorHandler(async (req: NextRequest) => {
  const parsed = DeleteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
      { status: 400 },
    );
  }
  const { kind, id } = parsed.data;
  return NextResponse.json({ acknowledgements: unacknowledge(kind, id) });
}, "undo radar acknowledgement");

export const GET = withErrorHandler(async () => {
  return NextResponse.json({ acknowledgements: readAcknowledgements() });
}, "read radar acknowledgements");
