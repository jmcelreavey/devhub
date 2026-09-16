/**
 * Server-safe PR agent-review prompt (shared by UI launchAgentJob and
 * POST /api/github/prs/auto-review). Keep this free of "use client".
 */

/** Prompt handed to the agent for "Review with agent" / auto-review. */
export function agentReviewPrompt(prUrl: string, notePath?: string): string {
  const parts = [`Use the pr-explain-review skill to explain and review this GitHub PR: ${prUrl}`];
  if (notePath) {
    parts.push(
      `Save the finished write-up as a well-formatted note with the notes MCP (notes_write). Notes MCP path: ${notePath}`,
    );
  }
  return parts.join(" ");
}
