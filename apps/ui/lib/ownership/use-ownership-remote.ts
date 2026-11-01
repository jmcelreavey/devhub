"use client";

import { useLive } from "@/lib/hooks/use-fetch";
import type { ResolvedOwnedRepo } from "@shared/repos/ownership-types";

export function useOwnershipRemote(repos: Pick<ResolvedOwnedRepo, "fullName" | "defaultBranch">[] | undefined): void {
  const remote = repos?.map(({ fullName, defaultBranch }) => ({ fullName, defaultBranch }));
  const key = remote?.length ? `/api/own?scope=remote&repos=${encodeURIComponent(JSON.stringify(remote))}` : null;
  useLive(key, { /* GitHub repository metadata changes independently. */ refreshInterval: 120_000 });
}
