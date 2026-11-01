import { z } from "zod";
import { AgentDispatchError, dispatchAgentRun } from "../../../../../lib/agent-runs/dispatch";
import { taskTierChoice } from "../../../../../lib/storyboard/task-tiers";
import { toAgentRunSummary } from "../../../../../lib/agent-runs/store";
import { parseBody, requireDashboardAuth, withErrorHandler } from "../../../../../lib/api-utils";
import { httpAction } from "../../../../../lib/actions/http";
import { taskImplementReview, type TaskImplementReviewValue } from "../../../../../../../../packages/shared/actions/task-agent";
import { taskStorage } from "@devhub/core/storage/tasks";
import { getActiveTasksDir } from "../../../../../lib/notes/dir";
import { todayISO } from "../../../../../../../../packages/shared/utils.ts";
import { readImplementReviewPrefs } from "../../../../../domains/tasks/implement-review-prefs";
import { buildImplementReviewPrompt } from "../../../../../domains/tasks/implement-review-prompt";
import { present, ensureTasksMigrated } from "../../../../../domains/tasks/storage";


/** `pr-reviews/<slug>` with no empty, `.` or `..` segments. */
const REVIEW_NOTE_PATH = /^pr-reviews\/[A-Za-z0-9._@-]+(?:\/[A-Za-z0-9._@-]+)*$/;

const ReviewSchema = taskImplementReview.input.extend({
  notePath: z
    .string()
    .trim()
    .max(300)
    .refine((value) => REVIEW_NOTE_PATH.test(value) && !value.split("/").some((part) => part === "." || part === ".."), {
      message: "notePath must be under pr-reviews/",
    }),
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
export const POST = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, ReviewSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  return httpAction(taskImplementReview, {
    input: () => body,
    context: () => ({ review: async () => {
      const result = await executeReview(req, body);
      const value = await result.json() as TaskImplementReviewValue | { error: string; [key: string]: unknown };
      return result.ok
        ? { ok: true, value: value as TaskImplementReviewValue }
        : { ok: false, error: (value as { error: string }).error, status: result.status, body: value as Record<string, unknown> };
    } }),
    response: (result) => result.ok ? Response.json(result.value, { status: 201 }) : Response.json(result.body ?? { error: result.error }, { status: result.status }),
  })(req);
}, "tasks.implement.review.post");

async function executeReview(req: Request, body: z.output<typeof ReviewSchema>): Promise<Response> {
  if (body.depth >= 2) {
    return Response.json({ error: "A review run can't start another review." }, { status: 409 });
  }
  // The review step's model tier picks the reviewer when it names a provider; review settings are the fallback.
  const tier = taskTierChoice(body.taskId, "review");
  const prefs = readImplementReviewPrefs();
  const reviewer = tier.provider ? { provider: tier.provider, model: tier.model, effort: tier.effort } : prefs;
  if (!reviewer.provider) {
    return Response.json(
      { error: "No review assistant is assigned. Choose one in review settings before continuing.", code: "no_reviewer" },
      { status: 409 },
    );
  }
  await ensureTasksMigrated();
  const found = (await taskStorage(getActiveTasksDir()).onDay(body.date, todayISO())).find((item) => item.id === body.taskId);
  if (!found) return Response.json({ error: "The task could not be found." }, { status: 404 });
  const task = present(found, body.date);

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
      ...(reviewer.effort ? { effort: reviewer.effort } : {}),
      prompt,
      cwd: body.cwd,
      title: `Review · ${task.text}`.slice(0, 80),
      // Review the implementer's own checkout; a fresh worktree would not hold its uncommitted work.
      worktree: false,
      depth: body.depth,
      reviewRun: true,
      activity: { source: "interactive", action: "review", taskId: task.id, taskDate: body.date, notePath: body.notePath },
    });
    return Response.json(
      { run: toAgentRunSummary(run), reviewer: { provider: reviewer.provider, model: reviewer.model || null, ...(reviewer.effort ? { effort: reviewer.effort } : {}) }, notePath: body.notePath },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof AgentDispatchError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
