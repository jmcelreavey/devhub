import { NextResponse } from "next/server";
import { loadRepoPeople } from "@/lib/people/repo-people";
import { withScannedRepo, type RepoParams } from "../_shared";

/**
 * The repo's contributors, merged across the addresses each commits under.
 *
 * Supersedes `/git/authors`, which returned a raw email → account map and left
 * every caller to discover for itself that one human can own several addresses.
 *
 * Always 200: a repo with no GitHub remote still has people, just without
 * avatars, and that is a normal state rather than a failure.
 */
export async function GET(_req: Request, { params }: RepoParams) {
  const { name } = await params;
  const resolved = withScannedRepo(name);
  if (!resolved.ok) return resolved.response;

  const { people, byEmail, githubConfigured } = await loadRepoPeople(resolved.repoRoot);
  return NextResponse.json({
    people,
    // Sent as a flat email → key index rather than repeating each person per
    // address; the client rebuilds the lookup from `people`.
    emailIndex: Object.fromEntries(Object.entries(byEmail).map(([email, p]) => [email, p.key])),
    githubConfigured,
  });
}
