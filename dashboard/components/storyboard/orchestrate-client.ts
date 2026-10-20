"use client";

import { mutate } from "swr";
import { TASK_AGENT_RUNS_KEY } from "@/lib/tasks/use-task-agent-runs";
import { ORCHESTRATIONS_KEY } from "@/lib/storyboard/use-orchestrations";
import type { OrchestrationSummary } from "@/lib/storyboard/orchestration";

export interface OrchestratePostResult {
  ok: boolean;
  error?: string;
  summary?: OrchestrationSummary;
  runId?: string | null;
  cancelled?: string | null;
  dispatchError?: string | null;
}

/** POST to the orchestrate route with a fresh idempotency key, then refresh rows and the board header. */
export async function postOrchestrate(body: Record<string, unknown>): Promise<OrchestratePostResult> {
  try {
    const response = await fetch("/api/storyboard/orchestrate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, idempotencyKey: crypto.randomUUID().replaceAll("-", "") }),
    });
    const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) return { ok: false, error: String(json.error ?? "The orchestrator did not accept that.") };
    return { ok: true, summary: json.summary as OrchestrationSummary, runId: (json.runId as string | null) ?? null, cancelled: (json.cancelled as string | null) ?? null, dispatchError: (json.dispatchError as string | null) ?? null };
  } catch {
    return { ok: false, error: "Couldn't reach DevHub. Refresh before retrying." };
  } finally {
    void mutate(ORCHESTRATIONS_KEY);
    void mutate(TASK_AGENT_RUNS_KEY);
  }
}
