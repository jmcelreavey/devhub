import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { parseBody, withErrorHandler } from "@/lib/api-utils";
import { formatGenerateError } from "@/lib/ai/generate";
import { blocksToText } from "@/lib/markdown-convert";
import { prNotePath } from "@/lib/pr-note";
import { aiGradeFindings } from "@/lib/reps-grade";
import {
  gradeRep,
  markAgentReviewStarted,
  readRep,
  repStats,
  repickRep,
  saveRepFindings,
  startRep,
  type Rep,
  type RepsApiPayload,
} from "@/lib/reps";
import { todayISO } from "@/lib/utils";
import { getVaultStorage } from "@/lib/vault/vault-registry";

const PrSchema = z.object({
  repo: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, "repo must be owner/name"),
  number: z.number().int().positive(),
  title: z.string().min(1).max(500),
  url: z.string().url(),
});

const BodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), pr: PrSchema }),
  z.object({ action: z.literal("repick"), pr: PrSchema }),
  z.object({ action: z.literal("save"), findings: z.string().trim().min(1).max(20_000) }),
  z.object({ action: z.literal("agent-review-started") }),
  z.object({ action: z.literal("ai-grade") }),
  z.object({
    action: z.literal("grade"),
    caught: z.number().int().min(0).max(999),
    missed: z.number().int().min(0).max(999),
  }),
]);

/** Agent review note markdown for a PR, or undefined when it doesn't exist yet. */
function readAgentReview(repo: string, number: number): string | undefined {
  try {
    const note = getVaultStorage("notes").read(`${prNotePath({ repo, number })}.json`);
    if (!note) return undefined;
    const blocks = Array.isArray(note.content) ? note.content : [note.content];
    const markdown = blocksToText(blocks).trim();
    return markdown || undefined;
  } catch {
    return undefined;
  }
}

function repPayload(rep: Rep | null, today: string): RepsApiPayload {
  return {
    rep,
    stats: repStats(today),
    ...(rep?.pr ? { agentReview: readAgentReview(rep.pr.repo, rep.pr.number) } : {}),
  };
}

export const GET = withErrorHandler(async (): Promise<NextResponse> => {
  const today = todayISO();
  return NextResponse.json(repPayload(readRep(today), today));
}, "reps.get");

export const POST = withErrorHandler(async (req: NextRequest): Promise<NextResponse> => {
  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;
  const today = todayISO();
  const body = parsed.data;

  // Read-only AI step: grade the saved findings against the landed agent review.
  if (body.action === "ai-grade") {
    const rep = readRep(today);
    const findings = rep?.findings?.trim();
    const agentReview = rep?.pr ? readAgentReview(rep.pr.repo, rep.pr.number) : undefined;
    if (!findings) {
      return NextResponse.json({ ok: false, error: "Save your findings first." }, { status: 400 });
    }
    if (!agentReview) {
      return NextResponse.json({ ok: false, error: "Agent review hasn't landed yet." }, { status: 400 });
    }
    try {
      const grade = await aiGradeFindings(findings, agentReview);
      return NextResponse.json({ ok: true, grade });
    } catch (err) {
      return NextResponse.json({ ok: false, error: formatGenerateError(err) }, { status: 502 });
    }
  }

  const rep =
    body.action === "start"
      ? await startRep(today, body.pr)
      : body.action === "repick"
        ? await repickRep(today, body.pr)
        : body.action === "save"
          ? await saveRepFindings(today, body.findings)
          : body.action === "agent-review-started"
            ? await markAgentReviewStarted(today)
            : await gradeRep(today, { caught: body.caught, missed: body.missed });
  return NextResponse.json(repPayload(rep, today));
}, "reps.post");
