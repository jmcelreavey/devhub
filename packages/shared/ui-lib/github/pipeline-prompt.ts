/**
 * Server-safe PR pipeline-investigate prompt (shared by UI launchAgentJob and
 * POST /api/github/prs/pipeline-investigate). Keep this free of "use client".
 */

/** Prompt handed to the agent for "Investigate pipeline" / MCP dispatch. */
export function agentPipelineInvestigatePrompt(prUrl: string, notePath?: string): string {
  const parts = [
    `Use the devhub-fix-pipeline skill to investigate CI/checks for this GitHub PR: ${prUrl}`,
    "Pull PR state and failed checks/logs, classify flake vs real failure, reproduce locally when practical, and only push fixes after explicit confirm.",
  ];
  if (notePath) {
    parts.push(
      `Write findings to the PR review note via notes MCP (notes_write / notes_append). Notes MCP path: ${notePath}`,
    );
  }
  return parts.join(" ");
}
