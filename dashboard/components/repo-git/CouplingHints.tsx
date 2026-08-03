"use client";

import { Lightbulb } from "lucide-react";
import { useLive } from "@/lib/hooks/use-fetch";
import type { CouplingSuggestion } from "@/lib/git/change-coupling";
import { repoApi } from "./shared";

interface CouplingPayload {
  suggestions: CouplingSuggestion[];
  commitsAnalysed: number;
}

const basename = (p: string) => p.split("/").pop() || p;

/**
 * "You usually also change X."
 *
 * Derived from this repo's own commit log: if the last N commits touching
 * `bi-ops.ts` almost always touched `bi-ops.test.ts`, changing one without the
 * other is worth a nudge. It is a hint, never a block — the honest framing is
 * the historical ratio, not an assertion that you forgot something.
 */
export function CouplingHints({
  repoName,
  changedPaths,
}: {
  repoName: string;
  changedPaths: string[];
}) {
  // Sorted + newline-joined so the SWR key is stable regardless of stage order.
  const key =
    changedPaths.length > 0
      ? repoApi(
          repoName,
          `/git/coupling?paths=${encodeURIComponent([...changedPaths].sort().join("\n"))}`,
        )
      : null;

  const { data } = useLive<CouplingPayload>(key, {
    revalidateOnFocus: false,
    refreshInterval: 0,
    shouldRetryOnError: false,
    dedupingInterval: 30_000,
  });

  const suggestions = data?.suggestions ?? [];
  if (suggestions.length === 0) return null;

  return (
    <div className="repo-git-coupling">
      <div className="repo-git-coupling-head">
        <Lightbulb size={11} aria-hidden />
        Usually changed together
      </div>
      {suggestions.map((s) => (
        <div
          key={s.path}
          className="repo-git-coupling-row"
          title={`${s.together} of the last ${s.totalForSource} commits touching ${basename(
            s.because,
          )} also touched this file`}
        >
          <span className="font-mono truncate">{s.path}</span>
          <span className="repo-git-coupling-stat">
            {Math.round(s.confidence * 100)}%
            <span className="repo-git-coupling-because">with {basename(s.because)}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
