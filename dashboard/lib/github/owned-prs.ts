import type { GithubPrRow } from "./prs";

/** Both Home and PRs consume the ownership service's inventory. */
export interface OwnedPrsResponse {
  prs: GithubPrRow[];
  failedRepos: string[];
  limited: boolean;
}

export const OWNED_PRS_KEY = "/api/github/prs/owned";
