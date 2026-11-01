import { radarAcknowledgeInput, radarUnacknowledgeInput } from "../../../../../../../packages/shared/actions/workspace";
import { radarAcknowledgementsRead } from "../../../../../../../packages/shared/actions/workspace";
import { radarUnacknowledge } from "../../../../../../../packages/shared/actions/workspace";
import { radarAcknowledge } from "../../../../../../../packages/shared/actions/workspace";
import { withErrorHandler } from "../../../../lib/api-utils";
import { acknowledge, readAcknowledgements, unacknowledge } from "../../../../lib/radar/acknowledgements";


const BodySchema = radarAcknowledgeInput;
const DeleteSchema = radarUnacknowledgeInput;

/** POST — mark as seen at the magnitude the user was looking at. */
export const POST = withErrorHandler(async (req: Request) => {
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
      { status: 400 },
    );
  }

  return await radarAcknowledge.handler(parsed.data, { execute: async () => {
    const { kind, id, watermark } = parsed.data;
    return Response.json({ acknowledgements: acknowledge(kind, id, watermark) });
  } }) as Response;
}, "acknowledge radar item");

/** DELETE — undo, so an accidental click is recoverable without editing JSON. */
export const DELETE = withErrorHandler(async (req: Request) => {
  const parsed = DeleteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
      { status: 400 },
    );
  }

  return await radarUnacknowledge.handler(parsed.data, { execute: async () => {
    const { kind, id } = parsed.data;
    return Response.json({ acknowledgements: unacknowledge(kind, id) });
  } }) as Response;
}, "undo radar acknowledgement");

export const GET = withErrorHandler(async () => {
  return await radarAcknowledgementsRead.handler({}, { execute: async () => {
    return Response.json({ acknowledgements: readAcknowledgements() });
  } }) as Response;
}, "read radar acknowledgements");
