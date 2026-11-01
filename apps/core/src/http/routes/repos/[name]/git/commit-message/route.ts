import { repoGitCommitMessage } from "../../../../../../../../../packages/shared/actions/repos";
import { httpAction } from "../../../../../../lib/actions/http";
import { generateText } from "ai";
import { getNotesAiCallOptions, getNotesAiModel } from "../../../../../../lib/ai/provider";
import { runGitRepoAsync } from "../../../../../../lib/git/repo-local";
import { getWritingVoicePrompt } from "../../../../../../lib/ai/writing-voice";
import { gitFail, withScannedRepo, type RepoParams } from "../_shared";

const MAX_DIFF_CHARS = 12_000;

export async function POST(req: Request, { params }: RepoParams) {
  const { name } = await params;
  const resolved = withScannedRepo(name);
  if (!resolved.ok) return resolved.response;
  const { repoRoot } = resolved;

  const body = (await req.json().catch(() => ({}))) as { stagedOnly?: boolean };
  const stagedOnly = body.stagedOnly !== false;
  return httpAction(repoGitCommitMessage, {
    input: () => ({ name, stagedOnly }),
    context: () => ({ suggest: async (_repo, staged) => {
      const response = await suggestCommitMessage(repoRoot, staged);
      return { status: response.status, body: await response.json() };
    } }),
    response: (result) => Response.json(result.body, { status: result.status }),
  })(req);
}

async function suggestCommitMessage(repoRoot: string, stagedOnly: boolean) {
  const diff = await runGitRepoAsync(
    repoRoot,
    stagedOnly ? ["diff", "--cached"] : ["diff", "HEAD"],
  );
  if (diff.status !== 0) return gitFail(diff, "Could not read diff");

  const raw = (diff.stdout || "").trim();
  if (!raw) {
    return Response.json(
      { error: stagedOnly ? "Nothing staged — stage files first." : "No changes to summarize." },
      { status: 400 },
    );
  }

  const model = getNotesAiModel({ action: "Suggest a commit message" });
  if (!model) {
    return Response.json(
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
      system: getWritingVoicePrompt() || undefined,
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
      return Response.json({ error: "AI returned an empty message" }, { status: 502 });
    }

    return Response.json({ message, source: "ai" as const });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "AI commit message failed" },
      { status: 502 },
    );
  }
}
