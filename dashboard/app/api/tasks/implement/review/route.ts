import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AgentDispatchError, dispatchAgentRun } from "@/lib/agent-runs/dispatch";
import { toAgentRunSummary } from "@/lib/agent-runs/store";
import { parseBody, requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { readImplementReviewPrefs } from "@/lib/tasks/implement-review-prefs";
import { buildImplementReviewPrompt } from "@/lib/tasks/implement-review-prompt";
import { getTasks, ensureTasksMigrated } from "@/lib/tasks/storage";

export const dynamic = "force-dynamic";

/** `pr-reviews/<slug>` with no empty, `.` or `..` segments. */
const REVIEW_NOTE_PATH = /^pr-reviews\/[A-Za-z0-9._@-]+(?:\/[A-Za-z0-9._@-]+)*$/;

const ReviewSchema = z.object({
  taskId: z.string().trim().min(1).max(128),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  cwd: z.string().trim().min(1).max(1_000),
  notePath: z
    .string()
    .trim()
    .max(300)
    .refine((value) => REVIEW_NOTE_PATH.test(value) && !value.split("/").some((part) => part === "." || part === ".."), {
      message: "notePath must be under pr-reviews/",
    }),
  branch: z.string().trim().min(1).max(200).optional(),
  base: z.string().trim().min(1).max(200).optional(),
  origin: z.url().max(500).optional(),
  /** The caller's DEVHUB_AGENT_DEPTH, forwarded by the MCP server. */
  depth: z.number().int().min(0).max(20).default(0),
});

/**
 * POST /api/tasks/implement/review: the implementing agent asks DevHub to start
 * the assistant the user assigned as reviewer (review-settings). The reviewer runs
 * read-only against the same checkout and saves its findings as a note.
 *
 * This is the only door through the nesting guard: it starts exactly the
 * configured reviewer, with a fixed read-only prompt, one level below the
 * implementer. A reviewer asking for another review is refused here.
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, ReviewSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  if (body.depth >= 2) {
    return NextResponse.json({ error: "A review run can't start another review." }, { status: 409 });
  }
  const reviewer = readImplementReviewPrefs();
  if (!reviewer.provider) {
    return NextResponse.json(
      { error: "No review assistant is assigned, so review your own diff.", code: "no_reviewer" },
      { status: 409 },
    );
  }
  await ensureTasksMigrated();
  const task = getTasks(body.date).find((item) => item.id === body.taskId);
  if (!task) return NextResponse.json({ error: "The task could not be found." }, { status: 404 });

  const origin =
    body.origin?.replace(/\/$/, "") ||
    req.headers.get("origin")?.replace(/\/$/, "") ||
    `http://127.0.0.1:${process.env.PORT || "1337"}`;
  const prompt = buildImplementReviewPrompt({
    origin,
    taskId: task.id,
    date: body.date,
    taskText: task.text,
    jiraKey: task.jiraKey,
    cwd: body.cwd,
    notePath: body.notePath,
    branch: body.branch,
    base: body.base,
  });

  try {
    const run = await dispatchAgentRun({
      provider: reviewer.provider,
      model: reviewer.model || undefined,
      prompt,
      cwd: body.cwd,
      title: `Review · ${task.text}`.slice(0, 80),
      // Review the implementer's own checkout; a fresh worktree would not hold its uncommitted work.
      worktree: false,
      depth: body.depth,
      reviewRun: true,
      // No taskId: the task chip and Resume follow the implementation run, not its reviewer.
      activity: { source: "interactive", action: "review", notePath: body.notePath },
    });
    return NextResponse.json(
      { run: toAgentRunSummary(run), reviewer: { provider: reviewer.provider, model: reviewer.model || null }, notePath: body.notePath },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof AgentDispatchError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}, "tasks.implement.review.post");
