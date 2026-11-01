"use client";

import { useLive } from "@/lib/hooks/use-fetch";
import { OWNED_REPOS_SWR_KEY } from "@/lib/ownership/owned-repos-swr";
import type { OwnedReposResponse } from "@shared/repos/ownership-types";
import { profileKey } from "@shared/tasks/profile-scope";
import { OWNED_PRS_KEY, type OwnedPrsResponse } from "../../../../packages/shared/ui-lib/github/owned-prs";

export function useOwnedPrs(profile: string | undefined, enabled = true) {
  const identities = useLive<OwnedReposResponse>(enabled && profile !== undefined ? OWNED_REPOS_SWR_KEY : null);
  const params = new URLSearchParams({ scope: "remote" });
  identities.data?.repos.forEach((repo) => params.append("repo", repo.fullName));
  const key = identities.data ? profileKey(`${OWNED_PRS_KEY}?${params}`, profile) : null;
  const remote = useLive<OwnedPrsResponse>(key, { keepPreviousData: false, /* GitHub PRs change independently. */ refreshInterval: 120_000 });
  return {
    ...remote,
    error: identities.error ?? remote.error,
    mutate: () => identities.error ? identities.mutate() : remote.mutate(),
  };
}
