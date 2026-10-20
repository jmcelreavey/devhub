"use client";

import Link from "next/link";
import { useLive } from "@/lib/hooks/use-fetch";
import { OWNED_PRS_KEY, type OwnedPrsResponse } from "@/lib/github/owned-prs";
import { profileKey } from "@/lib/tasks/profile-scope";
import { filterPrRows } from "@/lib/github/pr-search";
import { PrRow } from "@/components/PrRow";
import { FetchError } from "@/components/ui/FetchError";
import { SkeletonRows } from "@/components/ui/SkeletonRows";

export function OwnedPrsPanel({ profile, query }: { profile?: string; query: string }) {
  const { data, error, mutate } = useLive<OwnedPrsResponse>(profileKey(OWNED_PRS_KEY, profile), { keepPreviousData: false, refreshInterval: 120_000 });
  const unavailable = !!error || !!data?.failedRepos.length;
  const rows = filterPrRows(data?.prs ?? [], query);
  return <section aria-label="Owned PRs">
    <p className="mb-3 text-xs text-text-muted">Open PRs in your <Link className="underline" href="/own">Owned repositories</Link>{data && !unavailable ? ` · ${rows.length}${data.limited ? "+" : ""}` : " · total unavailable"}</p>
    {unavailable ? <FetchError message="GitHub unavailable. Owned PR totals are unavailable." onRetry={() => void mutate()} /> : null}
    {!data && !error ? <SkeletonRows count={3} height={40} variant="list" /> : null}
    <div className="space-y-2">{rows.map((row) => <PrRow key={row.url} row={row} kind="reviews" density="comfortable" />)}</div>
    {data && !unavailable && !rows.length ? <p className="text-sm text-text-muted">{query ? "No Owned PRs match this search." : "No open PRs in your Owned repositories."}</p> : null}
  </section>;
}
