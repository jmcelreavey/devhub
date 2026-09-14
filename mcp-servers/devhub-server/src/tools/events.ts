import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Context } from "../context.ts";
import { DashboardHttpError, withDashboardErrors, type DashboardClient } from "../dashboard-client.ts";

/**
 * events_wait: block until something outside the agent happens — CI finishes,
 * a PR is reviewed or merged, a script or agent run ends, a Datadog alert
 * fires, or a new event lands in the recall spine — instead of a hand-rolled
 * poll loop in the agent. Every kind polls a dashboard route.
 */

export interface PrStateLike {
  state: "OPEN" | "CLOSED" | "MERGED";
  reviewDecision: string | null;
  reviewCount: number;
  latestReview: { author: string; state: string } | null;
  checks: { total: number; pending: number; passed: number; failed: number; skipped: number };
  failedChecks: string[];
}

export type PrWaitCondition = "checks_done" | "review" | "merged_or_closed" | "any_change";

function describeChecks(pr: PrStateLike): string {
  const { checks } = pr;
  const failed = pr.failedChecks.length ? ` (failed: ${pr.failedChecks.slice(0, 5).join(", ")})` : "";
  return `${checks.passed} passed, ${checks.failed} failed, ${checks.skipped} skipped, ${checks.pending} pending${failed}`;
}

/** Reason the condition is met, or null. `baseline` is the state when waiting began. */
export function prConditionMet(until: PrWaitCondition, baseline: PrStateLike, current: PrStateLike): string | null {
  switch (until) {
    case "checks_done":
      return current.checks.total > 0 && current.checks.pending === 0 ? `checks finished: ${describeChecks(current)}` : null;
    case "review":
      if (current.reviewCount > baseline.reviewCount && current.latestReview) {
        return `new review from ${current.latestReview.author}: ${current.latestReview.state}`;
      }
      return current.reviewDecision !== baseline.reviewDecision
        ? `review decision is now ${current.reviewDecision ?? "none"}`
        : null;
    case "merged_or_closed":
      return current.state !== "OPEN" ? `PR ${current.state.toLowerCase()}` : null;
    case "any_change": {
      const fingerprint = (pr: PrStateLike) =>
        JSON.stringify([pr.state, pr.reviewDecision, pr.reviewCount, pr.checks]);
      return fingerprint(current) !== fingerprint(baseline)
        ? `PR changed: ${current.state.toLowerCase()}, review ${current.reviewDecision ?? "none"}, checks ${describeChecks(current)}`
        : null;
    }
  }
}

/** Items not seen when waiting began whose title contains `match` (case-insensitive). */
export function freshMatches<T extends { id: string; title: string }>(
  items: readonly T[],
  seenIds: ReadonlySet<string>,
  match?: string,
): T[] {
  const needle = match?.trim().toLowerCase();
  return items.filter((item) => !seenIds.has(item.id) && (!needle || item.title.toLowerCase().includes(needle)));
}

const KINDS = ["pr", "script_run", "agent_run", "datadog_alert", "recall_event"] as const;
const RECALL_KINDS = ["commit", "pr", "ticket", "run", "session", "note", "alert", "decision", "manual"] as const;

interface WaitInput {
  kind: (typeof KINDS)[number];
  repo?: string;
  number?: number;
  until?: PrWaitCondition;
  runId?: string;
  match?: string;
  recallKinds?: Array<(typeof RECALL_KINDS)[number]>;
}

interface Watcher {
  label: string;
  pollMs: number;
  /** Returns the reason when the event happened; `status` is the latest observation. */
  check(): Promise<{ done: string | null; status: string }>;
}

function watcherFor(input: WaitInput, dashboard: DashboardClient): Watcher | string {
  switch (input.kind) {
    case "pr": {
      if (!input.repo || !input.number) return "kind=pr needs repo (owner/name) and number.";
      const until = input.until ?? "checks_done";
      let baseline: PrStateLike | null = null;
      return {
        label: `${input.repo}#${input.number} (${until})`,
        pollMs: 15_000,
        async check() {
          const { pr } = await dashboard.get<{ pr: PrStateLike }>("/api/github/pr-state", {
            repo: input.repo,
            number: input.number,
          });
          baseline ??= pr;
          return { done: prConditionMet(until, baseline, pr), status: `${pr.state.toLowerCase()}, checks ${describeChecks(pr)}` };
        },
      };
    }
    case "script_run": {
      if (!input.runId) return "kind=script_run needs runId (from scripts_run).";
      const runId = input.runId;
      return {
        label: `script run ${runId}`,
        pollMs: 3_000,
        async check() {
          try {
            const run = await dashboard.get<{ script: string; finishedAt?: number; exitCode?: number; lines: string[] }>(
              `/api/scripts/runs/${encodeURIComponent(runId)}`,
            );
            if (run.finishedAt === undefined) return { done: null, status: `${run.script} running` };
            const tail = run.lines.slice(-10).join("\n");
            return { done: `${run.script} finished with exit ${run.exitCode ?? "?"}\n${tail}`, status: "finished" };
          } catch (err) {
            // The run log only exists once the runner has written it.
            if (err instanceof DashboardHttpError && err.status === 404) return { done: null, status: "no run log yet" };
            throw err;
          }
        },
      };
    }
    case "agent_run": {
      if (!input.runId) return "kind=agent_run needs runId (from agent_dispatch).";
      const runId = input.runId;
      return {
        label: `agent run ${runId}`,
        pollMs: 3_000,
        async check() {
          const { run } = await dashboard.get<{ run: { state: string; resultText: string | null; error: string | null } }>(
            `/api/agent/runs/${encodeURIComponent(runId)}`,
            { limit: 1 },
          );
          if (run.state === "queued" || run.state === "running") return { done: null, status: run.state };
          return { done: `agent run ${run.state}${run.error ? `: ${run.error}` : ""}${run.resultText ? `\n${run.resultText}` : ""}`, status: run.state };
        },
      };
    }
    case "datadog_alert": {
      let seen: Set<string> | null = null;
      return {
        label: `Datadog alert${input.match ? ` matching "${input.match}"` : ""}`,
        pollMs: 30_000,
        async check() {
          const data = await dashboard.get<
            | { ok: true; oncall: Array<{ id: string; title: string; status?: string }>; teamSlack: Array<{ id: string; title: string; status?: string }> }
            | { ok: false; message: string }
          >("/api/datadog/recent-alerts");
          if (!data.ok) throw new Error(`Datadog: ${data.message}`);
          const alerts = [...data.oncall, ...data.teamSlack];
          if (!seen) {
            seen = new Set(alerts.map((a) => a.id));
            return { done: null, status: `${alerts.length} existing alerts` };
          }
          const fresh = freshMatches(alerts, seen, input.match);
          return {
            done: fresh.length ? fresh.map((a) => `${a.title}${a.status ? ` [${a.status}]` : ""}`).join("\n") : null,
            status: `${alerts.length} recent alerts`,
          };
        },
      };
    }
    case "recall_event": {
      let seen: Set<string> | null = null;
      const kinds = input.recallKinds?.join(",");
      return {
        label: `recall event${kinds ? ` (${kinds})` : ""}${input.match ? ` matching "${input.match}"` : ""}`,
        pollMs: 5_000,
        async check() {
          const { events } = await dashboard.get<{ events: Array<{ id: string; title: string; kind: string; source: string; url?: string }> }>(
            "/api/recall/events",
            { limit: 200, kinds },
          );
          if (!seen) {
            seen = new Set(events.map((e) => e.id));
            return { done: null, status: "watching" };
          }
          const fresh = freshMatches(events, seen, input.match);
          return {
            done: fresh.length
              ? fresh.map((e) => `[${e.kind}] ${e.title} (${e.source})${e.url ? ` ${e.url}` : ""}`).join("\n")
              : null,
            status: "watching",
          };
        },
      };
    }
  }
}

export function registerEventTools(server: McpServer, ctx: Context): void {
  const { dashboard } = ctx;

  server.registerTool(
    "events_wait",
    {
      description:
        "Block until something happens outside this session, instead of polling: kind=pr (repo+number; until checks_done | review | merged_or_closed | any_change), script_run or agent_run (runId; until it finishes), datadog_alert (a new alert, optional title match), recall_event (a new event in the recall spine, optional recallKinds and title match). Returns what happened, or the last status on timeout. Requires the dashboard running (and gh auth for pr).",
      inputSchema: {
        kind: z.enum(KINDS),
        repo: z.string().optional().describe("pr: owner/name"),
        number: z.number().int().positive().optional().describe("pr: PR number"),
        until: z.enum(["checks_done", "review", "merged_or_closed", "any_change"]).optional().describe("pr: default checks_done"),
        runId: z.string().optional().describe("script_run / agent_run: the run id"),
        match: z.string().max(200).optional().describe("datadog_alert / recall_event: case-insensitive title substring"),
        recallKinds: z.array(z.enum(RECALL_KINDS)).optional().describe("recall_event: limit to these kinds"),
        // Under the 360s toolTimeoutSec harnesses get from mcp/shared/devhub.json.
        timeoutSeconds: z.number().int().min(5).max(300).optional().describe("Default 120, max 300"),
      },
    },
    async (input, extra) =>
      withDashboardErrors(async () => {
        const watcher = watcherFor(input, dashboard);
        if (typeof watcher === "string") return { content: [{ type: "text", text: watcher }], isError: true };

        const timeoutSeconds = input.timeoutSeconds ?? 120;
        const deadline = Date.now() + timeoutSeconds * 1_000;
        const progressToken = extra._meta?.progressToken;
        let polls = 0;
        let status = "not checked yet";

        for (;;) {
          const result = await watcher.check();
          polls += 1;
          status = result.status;
          if (result.done) {
            return { content: [{ type: "text", text: `Event for ${watcher.label}:\n${result.done}` }] };
          }
          if (progressToken !== undefined) {
            await extra.sendNotification({
              method: "notifications/progress",
              params: { progressToken, progress: polls, message: `${watcher.label}: ${status}` },
            });
          }
          const waitMs = Math.min(watcher.pollMs, deadline - Date.now());
          if (waitMs <= 0 || extra.signal.aborted) {
            return {
              content: [
                {
                  type: "text",
                  text: `No event for ${watcher.label} within ${timeoutSeconds}s (last status: ${status}). Call events_wait again to keep waiting.`,
                },
              ],
            };
          }
          await new Promise((resolve) => setTimeout(resolve, waitMs));
        }
      }),
  );
}
