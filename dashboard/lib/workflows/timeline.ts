/**
 * The workflow's Updates list in plain words. Events are stored as raw one-line
 * summaries ("review run: completed", "Verification command started"); this
 * turns them into a short latest list and a run/step timeline. Pure and
 * client-safe: nothing is stored, so old events read the same way.
 */
import type { WorkflowEvent } from "./types";

export type UpdateTone = "ok" | "error" | "active" | "warn" | "neutral";

export interface UpdateLine {
  id: string;
  at: string;
  text: string;
  tone: UpdateTone;
}

export interface UpdateGroup {
  id: string;
  /** "Review run", "Verification", or the event's own text for one-offs. */
  label: string;
  start: string;
  end: string;
  /** Outcome of the group's last event, in plain words ("finished", "passed"). */
  outcome?: string;
  tone: UpdateTone;
  events: UpdateLine[];
}

export interface UpdateDay {
  /** Local YYYY-MM-DD. */
  day: string;
  groups: UpdateGroup[];
}

const RUN_RE = /^(\w[\w-]*) run: ([\w-]+)$/;
const RUN_STATE: Record<string, { text: string; tone: UpdateTone }> = {
  starting: { text: "starting", tone: "active" },
  running: { text: "running", tone: "active" },
  completed: { text: "finished", tone: "ok" },
  failed: { text: "failed", tone: "error" },
  "needs-attention": { text: "needs attention", tone: "warn" },
  abandoned: { text: "stopped", tone: "neutral" },
  paused: { text: "paused", tone: "warn" },
};

const capital = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

type Kind = { kind: "run"; role: string; state: string } | { kind: "verify"; phase: "start" | "step" | "end" } | { kind: "other" };

function classify(summary: string): Kind {
  const run = RUN_RE.exec(summary.trim());
  if (run) return { kind: "run", role: run[1]!, state: run[2]! };
  if (summary === "Verification started") return { kind: "verify", phase: "start" };
  if (summary === "Verification command started") return { kind: "verify", phase: "step" };
  if (/^Verification (passed|failed|\w+)$/.test(summary) || summary === "Evidence changed or verification was interrupted") return { kind: "verify", phase: "end" };
  return { kind: "other" };
}

/** One raw event in plain words, with a tone for its dot. */
export function describeUpdate(summary: string): { text: string; tone: UpdateTone } {
  const kind = classify(summary);
  if (kind.kind === "run") {
    const state = RUN_STATE[kind.state] ?? { text: kind.state.replace(/-/g, " "), tone: "neutral" as const };
    return { text: `${capital(kind.role)} run ${state.text}`, tone: state.tone };
  }
  if (summary === "Verification started") return { text: "Verification started", tone: "active" };
  if (summary === "Verification command started") return { text: "Running the checks", tone: "active" };
  if (summary === "Verification passed") return { text: "Checks passed", tone: "ok" };
  if (summary === "Verification failed") return { text: "Checks failed", tone: "error" };
  if (summary === "Evidence changed or verification was interrupted") return { text: "Verification interrupted: the code changed, so it needs another run", tone: "warn" };
  if (summary === "Review requires changes") return { text: "Review asked for changes", tone: "warn" };
  if (summary === "Updates read") return { text: "Marked as read", tone: "neutral" };
  if (/^Workflow /.test(summary)) return { text: summary.replace(/^Workflow /, "Workflow is now "), tone: "neutral" };
  return { text: summary, tone: "neutral" };
}

function line(event: WorkflowEvent): UpdateLine {
  return { id: event.id, at: event.at, ...describeUpdate(event.summary) };
}

/** Newest first, consecutive repeats of the same update folded into one, at most `limit`. */
export function latestUpdates(events: WorkflowEvent[], limit = 4): UpdateLine[] {
  const out: UpdateLine[] = [];
  for (let index = events.length - 1; index >= 0 && out.length < limit; index -= 1) {
    const event = events[index]!;
    if (index < events.length - 1 && events[index + 1]!.summary === event.summary) continue;
    out.push(line(event));
  }
  return out;
}

/** Local calendar day of an ISO time. */
export function localDay(at: string): string {
  const date = new Date(at);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Oldest-first events grouped into runs and verification passes, then by day
 * (newest day and newest group first). A run groups while the same role keeps
 * reporting; a verification pass runs from "started" to its result.
 */
export function updateTimeline(events: WorkflowEvent[]): UpdateDay[] {
  const groups: UpdateGroup[] = [];
  let open: { group: UpdateGroup; key: string; closed: boolean; last: string } | null = null;
  for (const event of events) {
    const kind = classify(event.summary);
    const item = line(event);
    // The same update logged twice in a row (two "review run: completed" a second apart) is one line.
    if (open && open.last === event.summary) {
      open.group.end = event.at;
      continue;
    }
    const key = kind.kind === "run" ? `run:${kind.role}` : kind.kind === "verify" ? "verify" : null;
    // A new pass starts at "starting" / "Verification started", or when the previous one already ended.
    const startsNew = kind.kind === "run" ? kind.state === "starting" : kind.kind === "verify" ? kind.phase === "start" : true;
    const joins = key !== null && open !== null && open.key === key && !open.closed && !startsNew && localDay(open.group.start) === localDay(event.at);
    if (joins && open) {
      open.group.events.push(item);
      open.group.end = event.at;
      open.last = event.summary;
    } else {
      const label = kind.kind === "run" ? `${capital(kind.role)} run` : kind.kind === "verify" ? "Verification" : item.text;
      const group: UpdateGroup = { id: event.id, label, start: event.at, end: event.at, tone: item.tone, events: [item] };
      groups.push(group);
      open = key ? { group, key, closed: false, last: event.summary } : null;
    }
    if (open) {
      const last = open.group.events.at(-1)!;
      open.group.tone = last.tone;
      if (kind.kind === "run") {
        open.group.outcome = RUN_STATE[kind.state]?.text ?? kind.state.replace(/-/g, " ");
        open.closed = ["completed", "failed", "abandoned"].includes(kind.state);
      } else if (kind.kind === "verify") {
        open.group.outcome = kind.phase === "end" ? (event.summary.startsWith("Verification ") ? event.summary.replace("Verification ", "") : "interrupted") : "running";
        open.closed = kind.phase === "end";
      }
    }
  }
  const days = new Map<string, UpdateGroup[]>();
  for (const group of [...groups].reverse()) {
    const day = localDay(group.end);
    days.set(day, [...(days.get(day) ?? []), group]);
  }
  return [...days.entries()].map(([day, list]) => ({ day, groups: list }));
}
