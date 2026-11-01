import { voiceDraftStartInput, voiceDraftStart, voiceDraftStatus, voiceDraftDiscard } from "../../../../../../../packages/shared/actions/voice";
import { clearDraft, getDraft, startDraft } from "../../../../lib/voice/drafts";
import { voiceRoute } from "../_shared";


const bodySchema = voiceDraftStartInput;

/**
 * Draft a new learned-voice.md from unlearned answers. Writes nothing.
 *
 * By default it waits and returns the draft (the page does this). `wait: false`
 * starts it and returns at once; poll GET for the result. A draft already running is joined.
 */
export const POST = voiceRoute("train", async (req) => {
  // No body at all is the page's normal call, so a missing or empty one means the defaults.
  const body = bodySchema.safeParse(await req.json().catch(() => ({})));
  return await voiceDraftStart.handler(body.success ? body.data : {}, { execute: async () => {
    const { started, done } = await startDraft();
    if (body.success && body.data.wait === false) {
      // Nobody is awaiting this; the failure lands in the GET status instead.
      done.catch(() => undefined);
      return Response.json({ started }, { status: 202 });
    }
    return Response.json(await done);
  } }) as Response;
});

/** Where the draft stands: idle, running, ready (with the draft) or failed (with why). */
export const GET = voiceRoute("draft", async () =>
  Response.json(await voiceDraftStatus.handler({}, { execute: getDraft }), { headers: { "Cache-Control": "no-store" } }),
);

/** Discard a finished draft so it can't be applied later by accident. */
export const DELETE = voiceRoute("discard", async () => {
  await voiceDraftDiscard.handler({}, { execute: clearDraft });
  return Response.json({ ok: true });
});
