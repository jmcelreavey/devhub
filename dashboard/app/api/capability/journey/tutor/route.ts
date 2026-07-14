import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { NextResponse } from "next/server";
import { withErrorHandler } from "@/lib/api-utils";
import { NOTES_AI_NOT_CONFIGURED } from "@/lib/notes-ai/constants";
import { isNotesAiConfigured } from "@/lib/notes-ai/config";
import { buildTutorSystemPrompt } from "@/lib/repo-learn-ai";
import { REPO_LEARN_TUTOR_START } from "@/lib/repo-learn-constants";
import { resolveRepoPath } from "@/lib/repo-learn-resolve";
import { getRepoContextForTutor } from "@/lib/repo-learn-tutor-context";
import { tutorMessageText } from "@/lib/repo-learn-tutor-utils";
import { getNotesAiModel, getNotesAiCallOptions } from "@/lib/ai-provider";
import { readLatestSnapshot } from "@/lib/capability/snapshots";
import { labCategory, readLabRecord } from "@/lib/capability/journey";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Socratic tutor scoped to one Capability Radar signal in one repo. Reuses the
 * repo tutor's system prompt (built from real repo context) and appends a focus
 * directive so the calibration question centres on the signal + its evidence
 * files, turning the lab's static checkpoint into an interactive session.
 */
export const POST = withErrorHandler(async (req: Request) => {
  if (!isNotesAiConfigured()) {
    return NextResponse.json({ error: NOTES_AI_NOT_CONFIGURED }, { status: 503 });
  }

  const body = (await req.json()) as { messages?: UIMessage[]; repoName?: string; signalId?: string };
  const repoName = body.repoName?.trim();
  const signalId = body.signalId?.trim();
  if (!repoName || !signalId) {
    return NextResponse.json({ error: "repoName and signalId required" }, { status: 400 });
  }

  const repoPath = resolveRepoPath(repoName);
  if (!repoPath) return NextResponse.json({ error: "Repo not found" }, { status: 404 });

  const model = getNotesAiModel();
  if (!model) return NextResponse.json({ error: NOTES_AI_NOT_CONFIGURED }, { status: 503 });

  // Focus details from the latest snapshot (best-effort).
  const snapshot = readLatestSnapshot();
  const repoScan = snapshot?.repos.find((r) => r.repoName === repoName);
  const signal = repoScan?.signals.find((s) => s.id === signalId);
  const label = signal?.label ?? signalId;
  const evidence = (signal?.evidence ?? []).slice(0, 8);

  // Workspace the learner can actually run (for "check my work").
  const record = readLabRecord(labCategory(repoName, signalId));
  const workspacePath = record?.workspacePath;
  const services = record?.services ?? [];

  const context = await getRepoContextForTutor(repoPath);
  const focus = [
    "",
    "--- SESSION FOCUS ---",
    `Centre this entire session on "${label}" (${signal?.kind ?? "topic"}, ${signal?.area ?? "general"}) as used in THIS repo.`,
    evidence.length ? `Relevant files: ${evidence.join(", ")}.` : "",
    `Open with a calibration question about how ${label} is wired here, and keep every question anchored to it and these files.`,
    workspacePath
      ? `The learner has a hands-on workspace at ${workspacePath}${services.length ? ` (run \`docker compose up -d\` to start ${services.join(", ")})` : ""}. Give them concrete tasks to DO there, then ask them to paste the command/output so you can CHECK THEIR WORK. Confirm what's correct, point out what's off, and only advance when they've shown it works.`
      : "Give the learner concrete things to try, then ask them to paste output so you can check their work before advancing.",
    "This is a resumable session — if there is prior conversation, continue from where you left off rather than restarting.",
  ]
    .filter(Boolean)
    .join("\n");
  const system = buildTutorSystemPrompt(context) + "\n" + focus;

  const modelMessages = await convertToModelMessages(body.messages ?? []);
  const promptMessages = modelMessages.map((m) => {
    if (m.role === "user" && tutorMessageText(m.content) === REPO_LEARN_TUTOR_START) {
      return {
        ...m,
        content: [
          { type: "text" as const, text: `Start the tutoring session about ${label}. Ask me your first calibration question.` },
        ],
      };
    }
    return m;
  });

  const result = streamText({
    model,
    system,
    messages: promptMessages,
    maxOutputTokens: 1024,
    ...getNotesAiCallOptions(),
  });

  return result.toUIMessageStreamResponse();
}, "capability.journey.tutor");
