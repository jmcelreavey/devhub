import { prIdentity } from "@/lib/github/actionable-prs";
import type { GithubPrRow } from "@/lib/github/prs";

export function prDetailIdentity(value: string | null): string | null {
  return value && /^[a-z0-9_.-]+\/[a-z0-9_.-]+#[1-9]\d*$/i.test(value) ? value.toLowerCase() : null;
}

export function prDetailHref(pathname: string, search: string, pr: Pick<GithubPrRow, "repo" | "number">, profile?: string, hash = ""): string {
  const params = new URLSearchParams(search);
  params.delete("task");
  params.delete("taskSection");
  params.set("pr", prIdentity(pr));
  if (profile) params.set("taskProfile", profile);
  return `${pathname}?${params}${hash}`;
}
