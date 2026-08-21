import fs from "node:fs";
import path from "node:path";
import { safeReadJSON, withMutex, writeAtomic } from "@/lib/atomic-write";
import { getRepsDir } from "@/lib/content/dirs";

export interface RepPr {
  repo: string;
  number: number;
  title: string;
  url: string;
}

export interface RepGrade {
  /** Agent findings you had already flagged yourself. */
  caught: number;
  /** Agent findings you missed. */
  missed: number;
}

export interface Rep {
  date: string;
  pr?: RepPr;
  /** Your AI-free review, markdown. */
  findings?: string;
  startedAt?: string;
  /** Set when findings are saved — this is what the streak counts. */
  completedAt?: string;
  gradedAt?: string;
  grade?: RepGrade;
}

export interface RepDayPoint {
  date: string;
  done: boolean;
  caught?: number;
  missed?: number;
}

export interface RepStats {
  streak: number;
  completedCount: number;
  gradedCount: number;
  caughtTotal: number;
  missedTotal: number;
  /** Last 35 days ending today, oldest first. */
  recent: RepDayPoint[];
}

/** GET /api/reps response body (client + server). */
export interface RepsApiPayload {
  rep: Rep | null;
  stats: RepStats;
  /** Agent review note content for today's rep PR, when the note exists. */
  agentReview?: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function repFile(date: string): string {
  return path.join(getRepsDir(), `${date}.json`);
}

export function readRep(date: string): Rep | null {
  if (!DATE_RE.test(date)) return null;
  return safeReadJSON<Rep | null>(repFile(date), null);
}

async function writeRep(rep: Rep): Promise<void> {
  await fs.promises.mkdir(getRepsDir(), { recursive: true });
  await writeAtomic(repFile(rep.date), `${JSON.stringify(rep, null, 2)}\n`);
}

/** Pick today's PR. Idempotent — once a day has a pick, it sticks. */
export async function startRep(date: string, pr: RepPr): Promise<Rep> {
  return withMutex(repFile(date), async () => {
    const existing = readRep(date);
    if (existing?.pr) return existing;
    const rep: Rep = { date, pr, startedAt: new Date().toISOString() };
    await writeRep(rep);
    return rep;
  });
}

/** Swap today's pick. Only allowed before findings are saved. */
export async function repickRep(date: string, pr: RepPr): Promise<Rep> {
  return withMutex(repFile(date), async () => {
    const rep = readRep(date);
    if (!rep || rep.completedAt) throw new Error("Too late to swap — this rep is already completed");
    rep.pr = pr;
    rep.startedAt = new Date().toISOString();
    await writeRep(rep);
    return rep;
  });
}

export async function saveRepFindings(date: string, findings: string): Promise<Rep> {
  return withMutex(repFile(date), async () => {
    const rep = readRep(date);
    if (!rep?.pr) throw new Error("No rep started for today");
    rep.findings = findings;
    rep.completedAt = new Date().toISOString();
    await writeRep(rep);
    return rep;
  });
}

export async function gradeRep(date: string, grade: RepGrade): Promise<Rep> {
  return withMutex(repFile(date), async () => {
    const rep = readRep(date);
    if (!rep?.completedAt) throw new Error("Finish your AI-free review first");
    rep.grade = grade;
    rep.gradedAt = new Date().toISOString();
    await writeRep(rep);
    return rep;
  });
}

function shiftISO(iso: string, deltaDays: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().split("T")[0];
}

/**
 * Consecutive completed days ending today (or yesterday when today isn't done
 * yet). Grading is optional and does not affect the streak.
 */
export function repStats(today: string): RepStats {
  const dir = getRepsDir();
  const completedDates = new Set<string>();
  const gradeByDate = new Map<string, RepGrade>();
  let completedCount = 0;
  let gradedCount = 0;
  let caughtTotal = 0;
  let missedTotal = 0;
  try {
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".json")) continue;
      const date = file.slice(0, -".json".length);
      if (!DATE_RE.test(date)) continue;
      const rep = safeReadJSON<Rep | null>(path.join(dir, file), null);
      if (!rep?.completedAt) continue;
      completedDates.add(date);
      completedCount += 1;
      if (rep.grade) {
        gradedCount += 1;
        caughtTotal += rep.grade.caught;
        missedTotal += rep.grade.missed;
        gradeByDate.set(date, rep.grade);
      }
    }
  } catch {
    // No reps dir yet — everything stays zero.
  }

  let streak = 0;
  let cursor = today;
  if (!completedDates.has(cursor)) cursor = shiftISO(cursor, -1);
  while (completedDates.has(cursor)) {
    streak += 1;
    cursor = shiftISO(cursor, -1);
  }

  const recent: RepDayPoint[] = [];
  for (let i = 34; i >= 0; i--) {
    const date = shiftISO(today, -i);
    const grade = gradeByDate.get(date);
    recent.push(
      grade
        ? { date, done: true, caught: grade.caught, missed: grade.missed }
        : { date, done: completedDates.has(date) },
    );
  }

  return { streak, completedCount, gradedCount, caughtTotal, missedTotal, recent };
}
