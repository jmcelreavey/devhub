import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { parseBody } from "@/lib/api-utils";
import { runGitRepoAsync } from "@/lib/git/repo-local";
import {
  isSafeRemoteName,
  isSafeRemoteUrl,
  parseRemotes,
  webLinkRemote,
} from "@/lib/repos/remote-parsers";
import { gitFail, withScannedRepo, type RepoParams } from "../_shared";

/** The repo's remotes, plus which one web links should follow. */
export async function GET(_req: NextRequest, { params }: RepoParams) {
  const { name } = await params;
  const resolved = withScannedRepo(name);
  if (!resolved.ok) return resolved.response;

  const [list, upstreamResult] = await Promise.all([
    runGitRepoAsync(resolved.repoRoot, ["remote", "-v"]),
    runGitRepoAsync(resolved.repoRoot, [
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      "@{u}",
    ]),
  ]);
  if (list.status !== 0) return gitFail(list, "Could not list remotes");

  const remotes = parseRemotes(list.stdout || "");
  const upstream = upstreamResult.status === 0 ? upstreamResult.stdout.trim() || null : null;
  return NextResponse.json({
    remotes,
    upstream,
    // Which remote the current branch's links belong to — the fork, when you
    // are working on one, rather than whatever `origin` happens to be.
    linkRemote: webLinkRemote(remotes, upstream)?.name ?? null,
  });
}

const BodySchema = z.object({
  action: z.enum(["add", "rename", "remove", "set-url"]),
  name: z.string().min(1).max(100),
  /** New name for `rename`. */
  newName: z.string().min(1).max(100).optional(),
  /** URL for `add` and `set-url`. */
  url: z.string().min(1).max(2048).optional(),
});

export async function POST(req: NextRequest, { params }: RepoParams) {
  const { name: repoName } = await params;
  const resolved = withScannedRepo(repoName);
  if (!resolved.ok) return resolved.response;

  const body = await parseBody(req, BodySchema);
  if (!body.ok) return body.response;
  const { action, name, newName, url } = body.data;
  const rp = resolved.repoRoot;

  // Names and URLs are interpolated into git argv, so both are validated before
  // any of them reaches a subprocess.
  if (!isSafeRemoteName(name)) {
    return NextResponse.json({ error: "Invalid remote name" }, { status: 400 });
  }

  switch (action) {
    case "add": {
      if (!url || !isSafeRemoteUrl(url)) {
        return NextResponse.json({ error: "Invalid remote URL" }, { status: 400 });
      }
      const result = await runGitRepoAsync(rp, ["remote", "add", name, url]);
      if (result.status !== 0) return gitFail(result, "Could not add the remote");
      // Fetch so its branches appear immediately; a remote you cannot see the
      // branches of is not much use, and this is the moment to pay for it.
      await runGitRepoAsync(rp, ["fetch", name, "--prune"], { timeout: 120_000 });
      return NextResponse.json({ ok: true });
    }

    case "rename": {
      if (!newName || !isSafeRemoteName(newName)) {
        return NextResponse.json({ error: "Invalid new remote name" }, { status: 400 });
      }
      const result = await runGitRepoAsync(rp, ["remote", "rename", name, newName]);
      if (result.status !== 0) return gitFail(result, "Could not rename the remote");
      return NextResponse.json({ ok: true });
    }

    case "remove": {
      const result = await runGitRepoAsync(rp, ["remote", "remove", name]);
      if (result.status !== 0) return gitFail(result, "Could not remove the remote");
      return NextResponse.json({ ok: true });
    }

    case "set-url": {
      if (!url || !isSafeRemoteUrl(url)) {
        return NextResponse.json({ error: "Invalid remote URL" }, { status: 400 });
      }
      const result = await runGitRepoAsync(rp, ["remote", "set-url", name, url]);
      if (result.status !== 0) return gitFail(result, "Could not change the remote URL");
      return NextResponse.json({ ok: true });
    }

    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
}
