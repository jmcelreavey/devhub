"use client";

import Link from "@/lib/navigation";
import { useOwnedPrs } from "@/lib/github/use-owned-prs";
import { filterPrRows } from "../../../../packages/shared/ui-lib/github/pr-search";
import { PrRow } from "@/components/PrRow";
import { FetchError } from "@/components/ui/FetchError";
import { SkeletonRows } from "@/components/ui/SkeletonRows";

export function OwnedPrsPanel({ profile, query }: { profile?: string; query: string }) {
  const { data, error, mutate } = useOwnedPrs(profile);
  const unavailable = !!error || !!data?.failedRepos.length;
  const rows = filterPrRows(data?.prs ?? [], query);
  return <section aria-label="Owned PRs">
    <p className="mb-3 text-xs text-text-muted">Open PRs in your <Link className="underline" href="/repos?view=owned">Owned repositories</Link>{data && !unavailable ? ` · ${rows.length}${data.limited ? "+" : ""}` : unavailable ? " · total unavailable" : " · Loading…"}</p>
    {unavailable ? <FetchError message="GitHub unavailable. Owned PR totals are unavailable." onRetry={() => void mutate()} /> : null}
    {!data && !error ? <SkeletonRows count={3} height={40} variant="list" /> : null}
    <div className="space-y-2">{rows.map((row) => <PrRow key={row.url} row={row} kind="reviews" density="comfortable" canSkip={false} />)}</div>
    {data && !unavailable && !rows.length ? <p className="text-sm text-text-muted">{query ? "No Owned PRs match this search." : "No open PRs in your Owned repositories."}</p> : null}
  </section>;
}
