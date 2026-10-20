import { createHash } from "node:crypto";
import path from "node:path";
import { findTask } from "@shared/tasks/store.ts";
import { isTaskOwnershipBlocked } from "@shared/tasks/types.ts";
import { getActiveTasksDir } from "@/lib/content/dirs";
import { loadGithubPrsList } from "@/lib/github/prs-list";
import type { GithubPrsApiPayload } from "@/lib/github/prs";
import { listOwnedRepos } from "@/lib/ownership/owned-repos";
import { resolveLocalGithubRepos } from "@/lib/repos/resolution";
import { homeWorkKey, homeWorkSummary, type HomeWork } from "@/lib/storyboard/home-summary";
import { answerRepoQuestion, decideOrchestrationPlan, retryOrchestration } from "@/lib/storyboard/orchestrator";
import type { BoardCard } from "@/lib/storyboard/notes-board-shared";
import { reviewNotes } from "@/lib/storyboard/work-insights";
import type { TaskWorkflow } from "@/lib/workflows/types";
import { readTaskNoteMarkdown } from "@/lib/tasks/implement-ready-gather";
import { readOrchestration } from "@/lib/storyboard/orchestration-store";
import { prDetailHref } from "@/lib/storyboard/pr-detail";
import { sectionForTaskAction, taskDetailHref } from "@/lib/storyboard/task-detail";
import { TaskNoteNotFoundError, updateTaskNoteSections } from "@/lib/tasks/task-note-sections";
import { loadSlackSnapshot, withSlackProfile, type SlackSnapshot } from "./answers";
import { slackMilestonesFromCards, type SlackMilestone } from "./milestones";
import { readPluginNeeds } from "./plugin-needs";
import { slackDashboardBaseUrl } from "./format";
import { resumeTaskAgent } from "@/lib/tasks/resume-task-agent";

export interface SlackNeed {
  profile: string;
  entityId: string;
  taskId?: string;
  jiraKey?: string;
  questionId?: string;
  options?: string[];
  itemKey: string;
  title: string;
  needed: string;
  href: string;
  action: "answer" | "repo" | "retry" | "open" | "approve-plan";
  state?: "plan-ready" | "question" | "failed-run" | "review-ready" | "finished-feedback" | "push-failed";
  plan?: SlackPlan;
  prRows?: Array<{ title: string; href: string; needed: string }>;
}
export interface SlackPlan { runId: string; fingerprint: string; summary: string }

export interface SlackNeedsSnapshot { items: SlackNeed[]; peersKnown: boolean; /** What agent runs have just reached, read from the same board. */ milestones?: SlackMilestone[] }
export interface SlackTaskQuestion { id: string; text: string; kind: "note" | "repo"; options?: string[] }
export interface SlackTaskQuestions { questions: SlackTaskQuestion[]; closed: boolean }
export interface SlackTaskAnswer { question?: SlackTaskQuestion; remaining: number; detail?: string }
export class SlackAnswerError extends Error {}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function slackNeedKey(item: SlackNeed): string {
  return fingerprint([item.profile, item.entityId, item.questionId ?? null, item.itemKey]);
}

function planForCard(profile: string, card: BoardCard): SlackPlan | undefined {
  const runId = card.auto?.planRunId;
  if (!runId) return undefined;
  const markdown = card.notePath ? withSlackProfile(profile, () => readTaskNoteMarkdown(card.notePath!)) : null;
  const plan = markdown?.match(/^##\s+Plan\b[^\n]*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/im)?.[1]?.trim() ?? "";
  return { runId, fingerprint: fingerprint([runId, plan]), summary: card.summary?.filter(Boolean).join("\n") || plan.split(/\r?\n/).filter((line) => line.trim()).slice(0, 5).join("\n") || "Open the plan in DevHub to review the details." };
}

export function slackTaskQuestions(profile: string, taskId: string): SlackTaskQuestions {
  return withSlackProfile(profile, () => {
    const task = findTask(getActiveTasksDir(), taskId);
    if (!task || task.done || task.abandonedAt || isTaskOwnershipBlocked(task)) return { closed: true, questions: [] };
    const repo = readOrchestration(taskId)?.questions.filter((question) => question.kind === "repo" && question.state === "open")
      .sort((left, right) => left.askedAt.localeCompare(right.askedAt)).map((question): SlackTaskQuestion => ({ id: question.id, text: question.prompt, kind: "repo" })) ?? [];
    try {
      const note = updateTaskNoteSections({ taskId }, { op: "read" }).view.questions;
      return { closed: false, questions: [...repo, ...note.filter((question) => !question.resolved).map((question): SlackTaskQuestion => ({ id: question.id, text: question.text, kind: "note", ...(question.options?.length ? { options: question.options } : {}) }))] };
    } catch (error) {
      if (!(error instanceof TaskNoteNotFoundError)) throw error;
      return { closed: false, questions: repo };
    }
  });
}

export function slackNeedsFromHome(profile: string, work: readonly HomeWork[], questions = slackTaskQuestions, workflows: readonly TaskWorkflow[] = []): SlackNeed[] {
  const items = work.flatMap((entry): SlackNeed[] => {
    if (entry.kind === "task" && isTaskOwnershipBlocked(entry.card.task)) return [];
    const { presentation } = entry;
    const jiraKey = entry.kind === "task" ? entry.card.jira?.[0] : undefined;
    const taskTitle = entry.kind === "task" ? entry.card.title ?? "" : "";
    // A task from a plugin or an old note can be missing its title or status: still post a card with something to read.
    const base = {
      profile, entityId: homeWorkKey(entry), jiraKey,
      title: (entry.kind === "pr" ? `${entry.pr.repo}#${entry.pr.number} · ${entry.pr.title}`
        : jiraKey && !taskTitle.startsWith(jiraKey) ? `${jiraKey} · ${taskTitle}` : taskTitle).trim() || "Untitled task",
      needed: presentation.status?.trim() || "Waiting on you",
      href: entry.kind === "pr" ? prDetailHref("/", "", entry.pr, profile)
        : taskDetailHref("/storyboard", new URLSearchParams({ taskProfile: profile }).toString(), entry.card.taskId, sectionForTaskAction(presentation.action)),
    };
    if (entry.kind === "pr") return [{ ...base, action: "open", itemKey: fingerprint([presentation.status, entry.pr.headSha]) }];
    const taskId = entry.card.taskId;
    const action = presentation.action?.kind;
    if (action === "answer" || action === "choose-repo") {
      const open = questions(profile, taskId).questions;
      if (open.length) return open.map((question) => ({ ...base, taskId, state: /^push failed:/i.test(question.text.trim()) ? "push-failed" : "question", questionId: question.id, needed: question.text, ...(question.options?.length ? { options: question.options } : {}), action: question.kind === "repo" ? "repo" : "answer", itemKey: fingerprint(question.options?.length ? [question.id, question.text, question.options] : [question.id, question.text]) }));
    }
    const card = entry.card;
    if (action === "approve-plan") {
      const plan = planForCard(profile, card);
      return [{ ...base, taskId, state: "plan-ready", action: plan ? "approve-plan" : "open", plan, itemKey: fingerprint(["plan-ready", plan?.fingerprint, card.auto?.planRunId]) }];
    }
    const review = reviewNotes(card, workflows.find((workflow) => workflow.taskId === taskId));
    const state = card.finishedFeedback ? "finished-feedback" : /push.*fail|fail.*push/i.test(presentation.status) ? "push-failed"
      : card.failure || action === "retry" || action === "auto-retry" || presentation.status === "Workflow run failed" ? "failed-run"
      : review && action === "review" ? "review-ready" : undefined;
    if (state) {
      const evidence = state === "finished-feedback" ? [card.finishedFeedback?.key, card.finishedFeedback?.brief]
        : state === "review-ready" ? [review?.runId, review?.notes]
        : [card.failure?.key, card.run?.runId, card.auto?.phase, card.auto?.round, presentation.status];
      return [{ ...base, taskId, state, action: action === "retry" || action === "auto-retry" || presentation.status === "Workflow run failed" ? "retry" : "open", itemKey: fingerprint([state, evidence]) }];
    }
    return [{ ...base, taskId, action: action === "auto-retry" || action === "retry" || presentation.status === "Workflow run failed" ? "retry" : "open", itemKey: fingerprint([action, presentation.status, entry.card.auto?.phase, entry.card.auto?.round, entry.card.run?.runId]) }];
  });
  const prs = items.filter((item) => item.entityId.startsWith("pr:"));
  if (!prs.length) return items;
  const prRows = prs.map(({ title, href, needed }) => ({ title, href, needed }));
  return [...items.filter((item) => !item.entityId.startsWith("pr:")), {
    profile, entityId: "prs:actionable", title: "Pull requests needing you", needed: `${prs.length} PR${prs.length === 1 ? "" : "s"} need attention`,
    href: "/prs", action: "open", prRows, itemKey: fingerprint(prs.map((item) => [item.entityId, item.itemKey])),
  }];
}

export async function loadSlackNeedsSnapshot(profile: string, snapshot: SlackSnapshot = loadSlackSnapshot(profile), pluginNeeds: (profile: string) => SlackNeed[] = readPluginNeeds): Promise<SlackNeedsSnapshot> {
  if (snapshot.errors.length) throw new Error("Task sources are unavailable");
  let prs: GithubPrsApiPayload | undefined;
  let owned: string[] = [];
  try {
    prs = await loadGithubPrsList();
    if (prs.configured && !prs.stale) owned = listOwnedRepos().map((repo) => repo.fullName);
  } catch { prs = undefined; }
  const home = homeWorkSummary(snapshot.cards, snapshot.items, prs?.stale ? [] : prs?.reviews ?? [], Date.now(), prs?.stale ? [] : prs?.authored, owned, prs?.stale ? [] : prs?.feedbackPrs);
  return { items: [...slackNeedsFromHome(profile, home["needs-you"], slackTaskQuestions, snapshot.items.map((item) => item.workflow)), ...pluginNeeds(profile)], peersKnown: !!prs?.configured && !prs.stale, milestones: slackMilestonesFromCards(profile, snapshot.cards.filter((card) => !isTaskOwnershipBlocked(card.task))) };
}

export async function decideSlackPlan(profile: string, taskId: string, plan: SlackPlan, decision: "approve" | "revise", token: string, guidance?: string): Promise<void> {
  await withSlackProfile(profile, async () => {
    const task = findTask(getActiveTasksDir(), taskId);
    if (!task || task.done || task.abandonedAt || isTaskOwnershipBlocked(task)) throw new SlackAnswerError("This task is no longer yours to continue. Open DevHub to check it.");
    if (decision === "revise" && (!guidance?.trim() || guidance.length > 4000)) throw new SlackAnswerError("Describe the revision in 1 to 4,000 characters.");
    const card = loadSlackSnapshot(profile).cards.find((entry) => entry.taskId === taskId);
    if (!card || planForCard(profile, card)?.fingerprint !== plan.fingerprint) throw new SlackAnswerError("The plan changed. Review the latest plan in DevHub; nothing changed.");
    const result = await decideOrchestrationPlan({ action: "plan-decision", taskId, planRunId: plan.runId, decision, guidance, idempotencyKey: `slack-plan-${fingerprint(token)}` });
    await result.execute?.();
  });
}

export async function answerSlackTask(profile: string, taskId: string, answer: string, requestId: string, questionId?: string): Promise<SlackTaskAnswer> {
  return withSlackProfile(profile, async () => {
    if (!answer.trim() || answer.length > 12000) throw new SlackAnswerError("Use an answer between 1 and 12,000 characters.");
    const current = slackTaskQuestions(profile, taskId);
    // Several questions can be open at once; a card or reply answers its own, not just the first.
    const question = questionId ? current.questions.find((candidate) => candidate.id === questionId) : current.questions[0];
    if (!question) {
      if (questionId && current.questions.length) throw new SlackAnswerError("That question was already answered. Open the current question before answering.");
      return { remaining: 0 };
    }
    let detail: string | undefined;
    if (question.kind === "repo") {
      const orchestration = readOrchestration(taskId);
      if (!orchestration) throw new SlackAnswerError("This task is no longer waiting for a repo. Open DevHub to check it.");
      const input = answer.trim().replace(/^`|`$/g, "");
      const repos = (await resolveLocalGithubRepos()).filter(({ fullName, repo }) => input.toLowerCase() === fullName.toLowerCase() || input.toLowerCase() === repo.name.toLowerCase() || (path.isAbsolute(input) && path.resolve(input) === path.resolve(repo.path)));
      if (repos.length !== 1) throw new SlackAnswerError("Reply with one recognised repo's full name or absolute path, for example owner/repo. No repo was changed.");
      const result = await answerRepoQuestion({ action: "answer-repo", taskId, taskDate: orchestration.taskDate, cwd: repos[0].repo.path, idempotencyKey: `slack-${fingerprint(requestId)}` }, { origin: slackDashboardBaseUrl() });
      if (result.dispatchError) detail = "Repo linked, but planning couldn't resume. Open DevHub to check it.";
    } else {
      updateTaskNoteSections({ taskId }, { op: "resolve_question", id: question.id, answer });
    }
    return { question, remaining: slackTaskQuestions(profile, taskId).questions.length, detail };
  });
}

export async function retrySlackTask(profile: string, taskId: string, token: string): Promise<void> {
  await withSlackProfile(profile, async () => {
    const task = findTask(getActiveTasksDir(), taskId);
    if (!task || task.done || task.abandonedAt) throw new Error("This task is no longer open.");
    if (!readOrchestration(taskId)) {
      await resumeTaskAgent({ taskId, date: task.startDate, origin: slackDashboardBaseUrl() });
      return;
    }
    const result = await retryOrchestration({ action: "retry", taskId, idempotencyKey: `slack-${token}` }, { origin: slackDashboardBaseUrl() });
    await result.execute?.();
  });
}
