import { NextResponse } from "next/server";
import { z } from "zod";
import { clearDraft, getDraft, startDraft } from "@/lib/voice/drafts";
import { voiceRoute } from "../_shared";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ wait: z.boolean().optional() });

/**
 * Draft a new learned-voice.md from unlearned answers. Writes nothing.
 *
 * By default it waits and returns the draft (the page does this). `wait: false`
 * starts it and returns at once; poll GET for the result. A draft already running is joined.
 */
export const POST = voiceRoute("train", async (req) => {
  // No body at all is the page's normal call, so a missing or empty one means the defaults.
  const body = bodySchema.safeParse(await req.json().catch(() => ({})));
  const { started, done } = startDraft();
  if (body.success && body.data.wait === false) {
    // Nobody is awaiting this; the failure lands in the GET status instead.
    done.catch(() => undefined);
    return NextResponse.json({ started }, { status: 202 });
  }
  return NextResponse.json(await done);
});

/** Where the draft stands: idle, running, ready (with the draft) or failed (with why). */
export const GET = voiceRoute("draft", async () =>
  NextResponse.json(getDraft(), { headers: { "Cache-Control": "no-store" } }),
);

/** Discard a finished draft so it can't be applied later by accident. */
export const DELETE = voiceRoute("discard", async () => {
  clearDraft();
  return NextResponse.json({ ok: true });
});
