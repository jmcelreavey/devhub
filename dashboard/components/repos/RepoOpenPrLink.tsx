"use client";

import { CheckCircle2, CircleDot, ExternalLink, GitPullRequest, XCircle } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { useLive } from "@/lib/hooks/use-fetch";
import type { BranchOpenPr, PrChecksState } from "@/lib/github/branch-pr";

interface RepoOpenPrPayload {
  configured: boolean;
  branch: string | null;
  pr: BranchOpenPr | null;
  onDefaultBranch?: boolean;
}

const CHECK_ICON: Record<Exclude<PrChecksState, "none">, typeof CheckCircle2> = {
  passing: CheckCircle2,
  failing: XCircle,
  pending: CircleDot,
};

/** Rolled-up CI state. Icon carries a label because colour alone isn't a signal. */
function PrChecksIcon({ state }: { state: PrChecksState }) {
  if (state === "none") return null;
  const Icon = CHECK_ICON[state];
  return (
    <>
      <Icon size={10} className="repo-open-pr-checks" aria-hidden />
      <span className="sr-only">checks {state}</span>
    </>
  );
}

/**
 * True once the element has come near the viewport, and true forever after.
 *
 * The latch matters: un-setting it on scroll-away nulled the SWR key, which
 * dropped the cached PR and made the chip vanish and re-fetch every time a card
 * left and re-entered view.
 */
function useHasBeenNearViewport<T extends HTMLElement>(): [RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setSeen(true);
        io.disconnect();
      },
      // Prefetch a little before the card scrolls into view.
      { rootMargin: "200px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);

  return [ref, seen];
}

/**
 * Compact link to the open GitHub PR for the repo's current branch.
 * Renders nothing while loading, on error, or when no open PR exists.
 *
 * Fetch is gated to near-viewport cards so 50+ repos don't all hammer `gh`.
 * Branch is part of the SWR key so checkout changes bust the cache.
 */
export function RepoOpenPrLink({
  repoName,
  branch,
}: {
  repoName: string;
  branch: string | null;
}) {
  const [hostRef, nearViewport] = useHasBeenNearViewport<HTMLSpanElement>();
  // "Is this the trunk?" is answered by the route from origin/HEAD — guessing
  // main/master here got `develop`-based repos wrong in both directions.
  const skip = !branch || branch === "HEAD";

  const key =
    skip || !nearViewport
      ? null
      : `/api/repos/${encodeURIComponent(repoName)}/pr?branch=${encodeURIComponent(branch)}`;

  const { data } = useLive<RepoOpenPrPayload>(key, {
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
    shouldRetryOnError: false,
    dedupingInterval: 10_000,
    // Feature-branch cards only (main/master skipped). Faster hunt until a PR
    // appears; back off once we have one.
    refreshInterval: (latest) => (latest?.pr ? 300_000 : 60_000),
  });

  if (skip) return null;

  const pr = data?.pr;

  return (
    // Non-zero size so the observer has something to intersect before a PR is
    // found — a 0×0 target is unreliable across engines.
    <span ref={hostRef} className="inline-flex min-w-0" style={{ minWidth: 1, minHeight: 1 }}>
      {pr ? (
        <a
          href={pr.url}
          target="_blank"
          rel="noopener noreferrer"
          className="repo-open-pr-link"
          data-checks={pr.checks !== "none" ? pr.checks : undefined}
          title={[
            pr.title ? `${pr.title} — open PR` : `Open PR #${pr.number}`,
            pr.checks !== "none"
              ? `checks: ${pr.checkCounts.passed} passed, ${pr.checkCounts.failed} failed, ${pr.checkCounts.pending} pending`
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        >
          <GitPullRequest size={11} aria-hidden />
          PR #{pr.number}
          <PrChecksIcon state={pr.checks} />
          <ExternalLink size={10} aria-hidden />
        </a>
      ) : null}
    </span>
  );
}
