"use client";

import Link from "next/link";
import { ListChecks } from "lucide-react";
import { useLive } from "@/lib/hooks/use-fetch";
import { PLAN_STATUS_LABELS, type PlanStatus, type PlanStatusBucket } from "@/lib/tasks/plan-status-labels";

/** Buckets that need a decision from you — the rest are counts. */
const ACTIONABLE: PlanStatusBucket[] = ["needsFix", "mergedToClose", "closedToDecide"];
const COUNTED: PlanStatusBucket[] = ["running", "waitingOnMerge", "resumable", "blocked", "readyToDispatch", "drafts"];
const MAX_ROWS = 4;

/** Count phrases: "2 running", "1 draft to write up". */
const COUNT_LABEL: Partial<Record<PlanStatusBucket, [one: string, many: string]>> = {
  running: ["agent running", "agents running"],
  waitingOnMerge: ["PR waiting on merge", "PRs waiting on merge"],
  resumable: ["stopped run to resume", "stopped runs to resume"],
  blocked: ["blocked", "blocked"],
  readyToDispatch: ["ready for an agent", "ready for an agent"],
  drafts: ["draft to write up", "drafts to write up"],
};

function countPhrase(bucket: PlanStatusBucket, n: number): string {
  const [one, many] = COUNT_LABEL[bucket] ?? [PLAN_STATUS_LABELS[bucket], PLAN_STATUS_LABELS[bucket]];
  return `${n} ${n === 1 ? one : many}`;
}

/** Plan-loop glance for the morning briefing: what needs you, then how much is in flight. */
export function BriefingPlanStatus() {
  const { data } = useLive<PlanStatus>("/api/tasks/plan-status", { refreshInterval: 60_000 });
  if (!data) return null;
  const urgent = ACTIONABLE.flatMap((bucket) => data[bucket].map((item) => ({ bucket, item }))).slice(0, MAX_ROWS);
  const counts = COUNTED.filter((bucket) => data[bucket].length > 0);
  if (urgent.length === 0 && counts.length === 0) return null;

  return (
    <div className="briefing-repos-digest" aria-label="Plan status">
      <div className="briefing-repos-digest-head">
        <ListChecks size={12} aria-hidden className="text-accent" />
        <span className="text-xs font-semibold text-text">Plans</span>
      </div>
      <ul className="briefing-repos-digest-list">
        {urgent.map(({ bucket, item }) => (
          <li key={`${bucket}-${item.taskId}`}>
            <Link href="/work?tab=tasks" className="briefing-repos-digest-row">
              <span className="briefing-repos-digest-name">{item.text}</span>
              <span className="briefing-repos-digest-reason">{PLAN_STATUS_LABELS[bucket]}</span>
            </Link>
          </li>
        ))}
        {counts.length > 0 ? (
          <li>
            <Link href="/work?tab=tasks" className="briefing-repos-digest-row">
              <span>{counts.map((bucket) => countPhrase(bucket, data[bucket].length)).join(" · ")}</span>
            </Link>
          </li>
        ) : null}
      </ul>
    </div>
  );
}
