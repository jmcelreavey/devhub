import { repsGet, repsUpdate } from "../../../../../../packages/shared/actions/reps";
import { parseBody, withErrorHandler } from "../../../lib/api-utils";
import { generateRep, repExcludeKey } from "../../../lib/reps/generate";
import {
  readRep,
  repStats,
  saveRepResponse,
  startRep,
  swapRep,
  toPublicRep,
  type Rep,
  type RepsApiPayload,
} from "../../../lib/reps/index";
import { todayISO } from "../../../../../../packages/shared/utils.ts";

function payload(rep: Rep | null, today: string): RepsApiPayload {
  return { rep: toPublicRep(rep), stats: repStats(today) };
}

export const GET = withErrorHandler(async (): Promise<Response> => {
  const today = todayISO();
  return Response.json(repsGet.handler(repsGet.input.parse({}), { execute: () => payload(readRep(today), today) }));
}, "reps.get");

export const POST = withErrorHandler(async (req: Request): Promise<Response> => {
  const parsed = await parseBody(req, repsUpdate.input.shape.body);
  if (!parsed.ok) return parsed.response;
  const input = repsUpdate.input.parse({ body: parsed.data });
  return await repsUpdate.handler(input, { execute: ({ body }) => updateRep(body) }) as Response;
}, "reps.post");

async function updateRep(body: ReturnType<typeof repsUpdate.input.parse>["body"]) {
  const today = todayISO();
  if (body.action === "start") {
    const existing = readRep(today);
    if (existing) return Response.json(payload(existing, today));
    const generated = await generateRep(today, 0);
    if (!generated) {
      return Response.json(
        { error: "No rep material found — own a repo with recent commits, or add a diagram." },
        { status: 409 },
      );
    }
    return Response.json(payload(await startRep(today, generated), today));
  }

  if (body.action === "swap") {
    const existing = readRep(today);
    if (!existing) return Response.json({ error: "No rep started for today" }, { status: 400 });
    if (existing.completedAt) {
      return Response.json({ error: "Too late to swap — this rep is already completed" }, { status: 400 });
    }
    const generated = await generateRep(today, existing.attempt + 1, repExcludeKey(existing));
    if (!generated) {
      return Response.json({ error: "Nothing else to swap to — this one's your rep." }, { status: 409 });
    }
    return Response.json(payload(await swapRep(today, generated), today));
  }

  return Response.json(payload(await saveRepResponse(today, body.response), today));
}
