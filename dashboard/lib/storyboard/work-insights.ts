import type { BoardCard, BoardFailure } from "./notes-board-shared";
import type { TaskWorkflow } from "@/lib/workflows/types";

export function costLabel(value?: number): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return value < 0.01 ? "<$0.01" : `≈$${value.toFixed(2)}`;
}

export function reviewNotes(card: BoardCard, workflow?: TaskWorkflow): { gist: string; notes: string; runId: string } | undefined {
  const review = workflow?.reviews.at(-1);
  if (review && !review.stale && review.findings.trim()) return { gist: oneLine(review.findings), notes: review.findings, runId: review.runId };
  return review?.stale ? undefined : card.review;
}

export function oneLine(text: string): string {
  return text.replace(/[#*`>]/g, "").replace(/\s+/g, " ").trim().slice(0, 220);
}

export function failureSummary(error?: string, exitCode?: number | null, role = "Agent"): string {
  const detail = error?.trim();
  if (detail) {
    const reason = /ECONNREFUSED|connection refused/i.test(detail) ? "Couldn’t connect to the agent service."
      : /timed? ?out|timeout/i.test(detail) ? "The run timed out before it finished."
      : /rate.limit|429/i.test(detail) ? "The provider’s rate limit stopped the run."
      : /unauthori[sz]ed|authentication|401/i.test(detail) ? "The provider rejected the agent’s credentials."
      : oneLine(detail);
    return `${role[0].toUpperCase()}${role.slice(1)} failed: ${reason}`;
  }
  return `${role[0].toUpperCase()}${role.slice(1)} failed${typeof exitCode === "number" ? ` (exit code ${exitCode})` : ""}. No error detail was recorded. Open logs for context.`;
}

export function activeFailure(card: Pick<BoardCard, "failure" | "taskDone">): BoardFailure | undefined {
  return !card.taskDone && !card.failure?.cleared ? card.failure : undefined;
}
