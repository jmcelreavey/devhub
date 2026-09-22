/**
 * Raw material for the plan retro (skills/shared/devhub-retro): what finished,
 * what was dropped and why, how agent runs ended, which MCP calls failed, and
 * which skills exist to be improved. Read-only and compact — the retro agent
 * reads this, then opens the transcripts/notes it points at.
 */
import { getRepoRoot } from "@/lib/content/dirs";
import { devhubSharedSkillsDir, listSkillDirNames } from "@/lib/skills/shared";
import { skillUsageFor, type SkillUsage } from "@/lib/skills/usage";
import { listAgentRuns } from "@/lib/agent-runs/store";
import { listTaskDays } from "@/lib/tasks/storage";
import { getTaskAgentRuns, listTaskAgentRuns } from "@/lib/tasks/task-agent-runs";
import { mcpHistoryDir, readMcpHistoryWindow } from "@shared/mcp-history/index.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const HANDOFF_CHARS = 1_500;
/** A week is too short to call a skill unused; usage looks back a month. */
const SKILL_USAGE_DAYS = 30;

export interface RetroTask {
  taskId: string;
  date: string;
  text: string;
  outcome: "done" | "abandoned";
  abandonReason?: string;
  stage?: string;
  handoff?: string;
  runs: Array<{ runId: string; status: string; provider?: string; prUrl?: string; prState?: string; attention?: string }>;
}

export interface RetroInputs {
  since: string;
  until: string;
  tasks: RetroTask[];
  agentRuns: Array<{ id: string; title: string; provider: string; state: string; error?: string; turns?: number; costUsd?: number }>;
  mcpFailures: Array<{ tool: string; count: number; lastError: string }>;
  skills: string[];
  /** Claude Code invocations over the last SKILL_USAGE_DAYS, least-used first. */
  skillUsage: { windowDays: number; source: "claude-code-transcripts"; skills: SkillUsage[] };
}

function inWindow(iso: string | undefined, sinceMs: number): boolean {
  return Boolean(iso) && Date.parse(iso!) >= sinceMs;
}

export async function buildRetroInputs(days = 7, now = Date.now()): Promise<RetroInputs> {
  const sinceMs = now - Math.max(1, Math.min(days, 31)) * DAY_MS;

  const tasks: RetroTask[] = [];
  for (const day of listTaskDays()) {
    for (const task of day.tasks) {
      const outcome = task.done && inWindow(task.completedAt, sinceMs)
        ? "done"
        : task.abandonedAt && inWindow(task.abandonedAt, sinceMs)
          ? "abandoned"
          : null;
      if (!outcome) continue;
      const handoff = getTaskAgentRuns(task.id).handoff.trim();
      tasks.push({
        taskId: task.id,
        date: day.date,
        text: task.text,
        outcome,
        ...(task.abandonReason ? { abandonReason: task.abandonReason } : {}),
        ...(task.stage ? { stage: task.stage } : {}),
        ...(handoff ? { handoff: handoff.slice(-HANDOFF_CHARS) } : {}),
        runs: listTaskAgentRuns(task.id).map((r) => ({
          runId: r.runId,
          status: r.status,
          ...(r.provider ? { provider: r.provider } : {}),
          ...(r.prUrl ? { prUrl: r.prUrl } : {}),
          ...(r.prState ? { prState: r.prState } : {}),
          ...(r.attention ? { attention: r.attention.summary } : {}),
        })),
      });
    }
  }

  const agentRuns = listAgentRuns(Number.MAX_SAFE_INTEGER)
    .filter((run) => (run.status.finishedAt ?? 0) >= sinceMs)
    .map(({ spec, status }) => ({
      id: spec.id,
      title: spec.title,
      provider: spec.provider,
      state: status.state,
      ...(status.error ? { error: status.error } : {}),
      ...(status.turns !== undefined ? { turns: status.turns } : {}),
      ...(status.costUsd !== undefined ? { costUsd: status.costUsd } : {}),
    }));

  const failures = new Map<string, { count: number; lastError: string }>();
  for (const entry of readMcpHistoryWindow(mcpHistoryDir(), sinceMs, now, { errorsOnly: true })) {
    const prev = failures.get(entry.tool);
    failures.set(entry.tool, { count: (prev?.count ?? 0) + 1, lastError: entry.error ?? prev?.lastError ?? "" });
  }
  const mcpFailures = [...failures.entries()]
    .map(([tool, v]) => ({ tool, ...v }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  const skills = listSkillDirNames(devhubSharedSkillsDir(getRepoRoot()));

  return {
    since: new Date(sinceMs).toISOString(),
    until: new Date(now).toISOString(),
    tasks,
    agentRuns,
    mcpFailures,
    skills,
    skillUsage: {
      windowDays: SKILL_USAGE_DAYS,
      source: "claude-code-transcripts",
      skills: await skillUsageFor(skills, now - SKILL_USAGE_DAYS * DAY_MS),
    },
  };
}
