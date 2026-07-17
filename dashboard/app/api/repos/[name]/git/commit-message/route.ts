import { NextResponse, type NextRequest } from "next/server";
import { generateText } from "ai";
import { getNotesAiCallOptions, getNotesAiModel } from "@/lib/ai-provider";
import { runGitRepoAsync } from "@/lib/git-repo-local";
import { gitFail, withScannedRepo, type RepoParams } from "../_shared";

const MAX_DIFF_CHARS = 12_000;

export async function POST(req: NextRequest, { params }: RepoParams) {
  const { name } = await params;
  const resolved = withScannedRepo(name);
  if (!resolved.ok) return resolved.response;
  const { repoRoot } = resolved;

  const body = (await req.json().catch(() => ({}))) as { stagedOnly?: boolean };
  const stagedOnly = body.stagedOnly !== false;

  const diff = await runGitRepoAsync(
    repoRoot,
    stagedOnly ? ["diff", "--cached"] : ["diff", "HEAD"],
  );
  if (diff.status !== 0) return gitFail(diff, "Could not read diff");

  const raw = (diff.stdout || "").trim();
  if (!raw) {
    return NextResponse.json(
      { error: stagedOnly ? "Nothing staged — stage files first." : "No changes to summarize." },
      { status: 400 },
    );
  }

  const model = getNotesAiModel();
  if (!model) {
    return NextResponse.json(
      {
        error: "AI not configured. Set AI_API_KEY for in-app commit messages, or use Agent CLI handoff.",
        code: "ai_not_configured",
      },
      { status: 503 },
    );
  }

  const clipped = raw.length > MAX_DIFF_CHARS ? `${raw.slice(0, MAX_DIFF_CHARS)}\n…(truncated)` : raw;

  try {
    const { text } = await generateText({
      model,
      ...getNotesAiCallOptions(),
      temperature: 0.2,
      prompt: [
        "Write a conventional commit message for this git diff.",
        "Rules: one subject line ≤72 chars, optional body after a blank line,",
        "imperative mood, no quotes, no markdown fences, no trailing period on subject.",
        "Prefer feat/fix/refactor/chore/docs/test/style/perf prefixes.",
        "",
        "DIFF:",
        clipped,
      ].join("\n"),
    });

    const message = text
      .trim()
      .replace(/^```(?:\w+)?\n?/, "")
      .replace(/\n?```$/, "")
      .trim();

    if (!message) {
      return NextResponse.json({ error: "AI returned an empty message" }, { status: 502 });
    }

    return NextResponse.json({ message, source: "ai" as const });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "AI commit message failed" },
      { status: 502 },
    );
  }
}
