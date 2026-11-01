import { repoGitStashMessage } from "../../../../../../../../../packages/shared/actions/repos";
import { httpAction } from "../../../../../../lib/actions/http";
import { generateText } from "ai";
import { getNotesAiCallOptions, getNotesAiModel } from "../../../../../../lib/ai/provider";
import { runGitRepoAsync } from "../../../../../../lib/git/repo-local";
import { getWritingVoicePrompt } from "../../../../../../lib/ai/writing-voice";
import { gitFail, withScannedRepo, type RepoParams } from "../_shared";

const MAX_DIFF_CHARS = 12_000;
const MAX_STATUS_CHARS = 2_000;

export async function POST(req: Request, { params }: RepoParams) {
  const { name } = await params;
  const resolved = withScannedRepo(name);
  if (!resolved.ok) return resolved.response;
  const { repoRoot } = resolved;
  return httpAction(repoGitStashMessage, {
    input: () => ({ name }),
    context: () => ({ read: async () => {
      const response = await suggestStashMessage(repoRoot);
      return { status: response.status, body: await response.json() };
    } }),
    response: (result) => Response.json(result.body, { status: result.status }),
  })(req);
}

async function suggestStashMessage(repoRoot: string) {
  const [diff, status] = await Promise.all([
    runGitRepoAsync(repoRoot, ["diff", "HEAD"]),
    runGitRepoAsync(repoRoot, ["status", "--porcelain"]),
  ]);
  if (diff.status !== 0) return gitFail(diff, "Could not read diff");
  if (status.status !== 0) return gitFail(status, "Could not read status");

  const rawDiff = (diff.stdout || "").trim();
  const rawStatus = (status.stdout || "").trim();
  if (!rawDiff && !rawStatus) {
    return Response.json({ error: "No changes to stash." }, { status: 400 });
  }

  const model = getNotesAiModel({ action: "Suggest a stash message" });
  if (!model) {
    return Response.json(
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
      system: getWritingVoicePrompt() || undefined,
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
      return Response.json({ error: "AI returned an empty message" }, { status: 502 });
    }

    return Response.json({ message, source: "ai" as const });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "AI stash message failed" },
      { status: 502 },
    );
  }
}
