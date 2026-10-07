import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { getNotesDir } from "@/lib/content/dirs";
import { findScenario } from "./scenarios";
import { MAX_ANSWER_CHARS, type VoiceAnswer, type VoiceAnswerRef } from "./types";

const ANSWERS_FILE = "answers.json";

const answersFileSchema = z.object({
  answers: z.array(
    z.object({
      scenarioId: z.string(),
      answer: z.string(),
      answeredAt: z.string(),
      trainedAt: z.string().optional(),
    }),
  ),
});

/** Personal data, so it lives in the notes vault rather than beside the code. */
export function voiceDir(): string {
  return path.join(getNotesDir(), "voice");
}

/**
 * A corrupt file throws instead of reading as empty: the next save would
 * overwrite it, and these answers are the only copy of what the person wrote.
 */
export function readAnswers(dir = voiceDir()): VoiceAnswer[] {
  const file = path.join(dir, ANSWERS_FILE);
  if (!fs.existsSync(file)) return [];
  const parsed = answersFileSchema.safeParse(JSON.parse(fs.readFileSync(file, "utf8")));
  if (!parsed.success) {
    throw new Error(`${file} is not valid voice data: ${parsed.error.issues[0]?.message ?? "unknown"}`);
  }
  return parsed.data.answers;
}

function writeAnswers(dir: string, answers: VoiceAnswer[]): void {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, ANSWERS_FILE);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ answers }, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
}

/**
 * Upsert one answer. Blank text clears it. Re-saving identical text keeps its
 * trained state, so tabbing through the quiz doesn't queue pointless retraining.
 */
export function saveAnswer(
  scenarioId: string,
  text: string,
  dir = voiceDir(),
  now = new Date(),
): VoiceAnswer[] {
  if (!findScenario(scenarioId)) throw new Error(`Unknown scenario: ${scenarioId}`);
  const answer = text.trim();
  if (answer.length > MAX_ANSWER_CHARS) {
    throw new Error(`Answer is over ${MAX_ANSWER_CHARS} characters.`);
  }

  const existing = readAnswers(dir);
  const previous = existing.find((a) => a.scenarioId === scenarioId);
  const others = existing.filter((a) => a.scenarioId !== scenarioId);
  const next = !answer
    ? others
    : previous?.answer === answer
      ? existing
      : [...others, { scenarioId, answer, answeredAt: now.toISOString() }];

  if (next !== existing) writeAnswers(dir, next);
  return next;
}

/** Answers that have never been folded into learned-voice.md (or changed since). */
export function pendingAnswers(answers: VoiceAnswer[]): VoiceAnswer[] {
  return answers.filter((a) => !a.trainedAt && findScenario(a.scenarioId));
}

/** Refs that no longer match a pending answer: edited, cleared or already trained meanwhile. */
export function staleRefs(refs: VoiceAnswerRef[], answers: VoiceAnswer[]): VoiceAnswerRef[] {
  const pending = pendingAnswers(answers);
  return refs.filter(
    (ref) => !pending.some((a) => a.scenarioId === ref.scenarioId && a.answeredAt === ref.answeredAt),
  );
}

/**
 * Mark exact answer versions as trained. Stale refs throw, so a stale draft
 * can't claim to have learned text it never saw.
 */
export function markTrained(refs: VoiceAnswerRef[], dir = voiceDir(), now = new Date()): void {
  const answers = readAnswers(dir);
  const stale = staleRefs(refs, answers);
  if (stale.length > 0) {
    throw new Error(`Answers changed since this draft was made: ${stale.map((r) => r.scenarioId).join(", ")}`);
  }

  const trainedAt = now.toISOString();
  writeAnswers(
    dir,
    answers.map((a) =>
      refs.some((ref) => ref.scenarioId === a.scenarioId && ref.answeredAt === a.answeredAt)
        ? { ...a, trainedAt }
        : a,
    ),
  );
}
