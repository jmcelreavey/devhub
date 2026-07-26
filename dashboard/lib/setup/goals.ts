/**
 * What the user actually wants DevHub for, and which setup steps that implies.
 *
 * The wizard used to show all ten steps to everyone. Someone who wants notes
 * and tasks was walked through Datadog, Jira and cloud infrastructure before
 * reaching anything they cared about — and every skipped step reads as
 * something left undone. A ten-step wizard where seven don't apply isn't
 * thorough, it's discouraging.
 *
 * Asking one question first turns that into three or four relevant steps.
 *
 * Deliberately multi-select and deliberately non-binding: goals only decide what
 * gets *offered*, never what's possible. Every step stays reachable from the
 * step rail afterwards, so a wrong answer here costs nothing.
 */
export type GoalId = "code" | "notes" | "ops" | "everything";

export interface Goal {
  id: GoalId;
  label: string;
  description: string;
  /** Steps this goal needs, beyond the ones everyone gets. */
  steps: string[];
}

/** Shown to everyone regardless of goal — orientation, tools, paths, finish. */
export const ALWAYS_STEPS = ["welcome", "tools", "paths", "done"];

export const GOALS: Goal[] = [
  {
    id: "code",
    label: "My code",
    description: "Repositories, pull requests, and jumping into an editor",
    steps: ["github", "agent"],
  },
  {
    id: "notes",
    label: "Notes and planning",
    description: "Daily notes, tasks, and a calendar-aware morning briefing",
    steps: ["calendar", "jira"],
  },
  {
    id: "ops",
    label: "Running services",
    description: "Infrastructure, monitoring, and on-call context",
    steps: ["datadog", "bi"],
  },
  {
    id: "everything",
    label: "All of it",
    description: "Show every integration",
    steps: ["github", "agent", "calendar", "jira", "datadog", "bi"],
  },
];

export const SETUP_GOALS_KEY = "devhub:setup-goals";

/**
 * Which step ids to show for a set of goals.
 *
 * No goals selected returns everything: someone who skips the question should
 * see the full wizard, not an empty one. Silence means "don't filter", not
 * "want nothing".
 */
export function stepsForGoals(goals: GoalId[]): Set<string> {
  const chosen = GOALS.filter((g) => goals.includes(g.id));
  if (chosen.length === 0) {
    return new Set([...ALWAYS_STEPS, ...GOALS.flatMap((g) => g.steps)]);
  }
  return new Set([...ALWAYS_STEPS, ...chosen.flatMap((g) => g.steps)]);
}

/** Filter a step list by goals, preserving order. */
export function filterStepsByGoals<T extends { id: string }>(steps: T[], goals: GoalId[]): T[] {
  const allowed = stepsForGoals(goals);
  return steps.filter((s) => allowed.has(s.id));
}

export function isGoalId(value: unknown): value is GoalId {
  return typeof value === "string" && GOALS.some((g) => g.id === value);
}

/** Read saved goals, tolerating anything that isn't a valid list. */
export function parseGoals(raw: string | null): GoalId[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isGoalId);
  } catch {
    return [];
  }
}
