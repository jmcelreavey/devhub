import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { parseBody, withErrorHandler } from "@/lib/api-utils";
import { generateRep, repExcludeKey } from "@/lib/reps-generate";
import {
  readRep,
  repStats,
  saveRepResponse,
  startRep,
  swapRep,
  toPublicRep,
  type Rep,
  type RepsApiPayload,
} from "@/lib/reps";
import { todayISO } from "@/lib/utils";

const BodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start") }),
  z.object({ action: z.literal("swap") }),
  z.object({ action: z.literal("save"), response: z.string().trim().min(1).max(20_000) }),
]);

function payload(rep: Rep | null, today: string): RepsApiPayload {
  return { rep: toPublicRep(rep), stats: repStats(today) };
}

export const GET = withErrorHandler(async (): Promise<NextResponse> => {
  const today = todayISO();
  return NextResponse.json(payload(readRep(today), today));
}, "reps.get");

export const POST = withErrorHandler(async (req: NextRequest): Promise<NextResponse> => {
  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;
  const today = todayISO();
  const body = parsed.data;

  if (body.action === "start") {
    const existing = readRep(today);
    if (existing) return NextResponse.json(payload(existing, today));
    const generated = await generateRep(today, 0);
    if (!generated) {
      return NextResponse.json(
        { error: "No rep material found — own a repo with recent commits, or add a diagram." },
        { status: 409 },
      );
    }
    return NextResponse.json(payload(await startRep(today, generated), today));
  }

  if (body.action === "swap") {
    const existing = readRep(today);
    if (!existing) return NextResponse.json({ error: "No rep started for today" }, { status: 400 });
    if (existing.completedAt) {
      return NextResponse.json({ error: "Too late to swap — this rep is already completed" }, { status: 400 });
    }
    const generated = await generateRep(today, existing.attempt + 1, repExcludeKey(existing));
    if (!generated) {
      return NextResponse.json({ error: "Nothing else to swap to — this one's your rep." }, { status: 409 });
    }
    return NextResponse.json(payload(await swapRep(today, generated), today));
  }

  return NextResponse.json(payload(await saveRepResponse(today, body.response), today));
}, "reps.post");
