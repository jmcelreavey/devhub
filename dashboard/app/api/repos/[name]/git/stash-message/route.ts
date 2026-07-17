import { NextResponse, type NextRequest } from "next/server";
import { generateText } from "ai";
import { getNotesAiCallOptions, getNotesAiModel } from "@/lib/ai-provider";
import { runGitRepoAsync } from "@/lib/git-repo-local";
import { gitFail, withScannedRepo, type RepoParams } from "../_shared";

const MAX_DIFF_CHARS = 12_000;
const MAX_STATUS_CHARS = 2_000;

export async function POST(_req: NextRequest, { params }: RepoParams) {
  const { name } = await params;
  const resolved = withScannedRepo(name);
  if (!resolved.ok) return resolved.response;
  const { repoRoot } = resolved;

  const [diff, status] = await Promise.all([
    runGitRepoAsync(repoRoot, ["diff", "HEAD"]),
    runGitRepoAsync(repoRoot, ["status", "--porcelain"]),
  ]);
  if (diff.status !== 0) return gitFail(diff, "Could not read diff");
  if (status.status !== 0) return gitFail(status, "Could not read status");

  const rawDiff = (diff.stdout || "").trim();
  const rawStatus = (status.stdout || "").trim();
  if (!rawDiff && !rawStatus) {
    return NextResponse.json({ error: "No changes to stash." }, { status: 400 });
  }

  const model = getNotesAiModel();
  if (!model) {
    return NextResponse.json(
      {
        error: "AI not configured. Set AI_API_KEY for in-app stash messages, or use Agent CLI handoff.",
        code: "ai_not_configured",
      },
      { status: 503 },
    );
  }

  const clippedDiff =
    rawDiff.length > MAX_DIFF_CHARS ? `${rawDiff.slice(0, MAX_DIFF_CHARS)}\n…(truncated)` : rawDiff;
  const clippedStatus =
    rawStatus.length > MAX_STATUS_CHARS
      ? `${rawStatus.slice(0, MAX_STATUS_CHARS)}\n…(truncated)`
      : rawStatus;

  try {
    const { text } = await generateText({
      model,
      ...getNotesAiCallOptions(),
      temperature: 0.2,
      prompt: [
        "Write a short git stash description for these working-tree changes.",
        "Rules: one line ≤72 chars, plain language, no quotes, no markdown fences,",
        "no conventional-commit prefix unless it genuinely helps, no trailing period.",
        "Describe why someone would stash this WIP (intent), not a file laundry list.",
        "",
        "STATUS:",
        clippedStatus || "(clean status — see diff)",
        "",
        "DIFF:",
        clippedDiff || "(no tracked diff — untracked-only)",
      ].join("\n"),
    });

    const message = text
      .trim()
      .replace(/^```(?:\w+)?\n?/, "")
      .replace(/\n?```$/, "")
      .split("\n")[0]
      ?.trim()
      .replace(/^["']|["']$/g, "")
      .trim();

    if (!message) {
      return NextResponse.json({ error: "AI returned an empty message" }, { status: 502 });
    }

    return NextResponse.json({ message, source: "ai" as const });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "AI stash message failed" },
      { status: 502 },
    );
  }
}
