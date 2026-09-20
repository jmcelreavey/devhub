/**
 * Server-safe PR agent-review prompt (shared by UI launchAgentJob and
 * POST /api/github/prs/auto-review). Keep this free of "use client".
 *
 * Cursor (AionUi's default review harness) auto-names the conversation from the
 * first user-message line, overwriting create-time `name`. Lead with the
 * session title so the sidebar shows the ticket (or repo#PR), not
 * "PR Explain Review".
 */

import { parseGithubPrUrl } from "@/lib/entity-links/parse-pr";
import { jiraKeyFromText } from "@/lib/utils";

export function agentReviewSessionTitle(input: {
  title?: string;
  repo?: string;
  number?: number;
  url?: string;
}): string {
  const parsed = input.url ? parseGithubPrUrl(input.url) : null;
  const repo = (input.repo || parsed?.repo || "").trim();
  const number = input.number ?? parsed?.number;
  const ticket = input.title ? jiraKeyFromText(input.title) : null;
  const repoLabel = repo.includes("/") ? repo.slice(repo.lastIndexOf("/") + 1) : repo;
  const prLabel = number != null ? (repoLabel ? `${repoLabel}#${number}` : `#${number}`) : null;
  if (ticket && prLabel) return `${ticket} · ${prLabel}`;
  if (ticket) return ticket;
  if (prLabel) return prLabel;
  return "PR review";
}

/** Prompt handed to the agent for "Review with agent" / auto-review. */
export function agentReviewPrompt(prUrl: string, notePath?: string, sessionTitle?: string): string {
  const title = (sessionTitle ?? agentReviewSessionTitle({ url: prUrl })).trim();
  const parts = [
    `${title}\nUse the pr-explain-review skill to explain and review this GitHub PR: ${prUrl}`,
  ];
  if (notePath) {
    parts.push(
      `Save the finished write-up as a well-formatted note with the notes MCP (notes_write). Notes MCP path: ${notePath}`,
    );
  }
  return parts.join(" ");
}
