import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { parseBody, withErrorHandler } from "@/lib/api-utils";
import { blocksToText } from "@/lib/markdown-convert";
import { prNotePath } from "@/lib/pr-note";
import { gradeRep, readRep, repStats, repickRep, saveRepFindings, startRep, type RepsApiPayload } from "@/lib/reps";
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

export const GET = withErrorHandler(async (): Promise<NextResponse> => {
  const today = todayISO();
  const rep = readRep(today);
  const payload: RepsApiPayload = {
    rep,
    stats: repStats(today),
    ...(rep?.pr ? { agentReview: readAgentReview(rep.pr.repo, rep.pr.number) } : {}),
  };
  return NextResponse.json(payload);
}, "reps.get");

export const POST = withErrorHandler(async (req: NextRequest): Promise<NextResponse> => {
  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;
  const today = todayISO();
  const body = parsed.data;
  const rep =
    body.action === "start"
      ? await startRep(today, body.pr)
      : body.action === "repick"
        ? await repickRep(today, body.pr)
        : body.action === "save"
          ? await saveRepFindings(today, body.findings)
          : await gradeRep(today, { caught: body.caught, missed: body.missed });
  const payload: RepsApiPayload = {
    rep,
    stats: repStats(today),
    ...(rep.pr ? { agentReview: readAgentReview(rep.pr.repo, rep.pr.number) } : {}),
  };
  return NextResponse.json(payload);
}, "reps.post");
