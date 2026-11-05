"use client";

import { openAgentHandoff } from "@/lib/agent-handoff";

// Chat, not a run: the agent reads, recaps and waits. No worktree, no task
// link, so the chat never counts as the task's latest agent run.
const WAIT = "Summarise where it stands in a few lines, then wait for my questions. Don't change code, files, tickets or PRs unless I ask.";

export function chatAboutTask(task: { id: string; text: string }, opts: { cwd?: string; repoName?: string; notePath?: string; prUrl?: string; branch?: string } = {}): void {
  const context = [
    opts.notePath ? `Its task note is ${opts.notePath}.` : null,
    opts.branch ? `Its latest agent branch is ${opts.branch}.` : null,
    opts.prUrl ? `Its pull request is ${opts.prUrl}.` : null,
  ].filter(Boolean).join(" ");
  openAgentHandoff({
    title: "Chat about task",
    runTitle: `Chat · ${task.text}`,
    prompt: `Let's talk about DevHub task ${task.id}: "${task.text}". Read it first with the DevHub MCP (the task, its notes and agent runs). ${context} ${WAIT}`.replace(/\s+/g, " ").trim(),
    cwd: opts.cwd,
    repoName: opts.repoName,
    prUrl: opts.prUrl,
    worktree: false,
  });
}

export function chatAboutTicket(ticket: { key: string; summary: string; url: string }): void {
  openAgentHandoff({
    title: "Chat about ticket",
    runTitle: `Chat · ${ticket.key} ${ticket.summary}`,
    prompt: `Let's talk about Jira ticket ${ticket.key}: "${ticket.summary}" (${ticket.url}). Read it first with the DevHub MCP (jira_ticket_get), plus any linked DevHub tasks or PRs. ${WAIT}`,
    worktree: false,
  });
}

export function chatAboutPr(pr: { repo: string; number: number; title: string; url: string }): void {
  openAgentHandoff({
    title: "Chat about pull request",
    runTitle: `Chat · ${pr.repo}#${pr.number}`,
    prompt: `Let's talk about pull request ${pr.repo}#${pr.number}: "${pr.title}" (${pr.url}). Read it first with gh (gh pr view --comments, gh pr diff, gh pr checks). ${WAIT}`,
    repoName: pr.repo,
    prUrl: pr.url,
    worktree: false,
  });
}
