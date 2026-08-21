/**
 * Quiet agent status copy helpers.
 * Kept free of "use client" so vitest can import without the dock/job launcher.
 */

export type AgentUiPhase = "starting" | "running" | "ready" | "done" | "failed";

export function providerDisplayName(provider: string): string {
  const id = provider.trim().toLowerCase();
  if (id === "cursor" || id === "cursor-cli") return "Cursor";
  if (id === "chatgpt" || id === "chatgpt-cli" || id === "codex") return "ChatGPT";
  if (id === "opencode") return "OpenCode";
  if (id === "api") return "HTTP API";
  return "Agent";
}

/** Friendly chip / banner / status text — never raw CLI argv. */
export function formatAgentJobSummary(opts: {
  title: string;
  provider: string;
  summary?: string;
  kind?: string;
}): string {
  if (opts.summary?.trim()) return opts.summary.trim();
  const title = opts.title.trim() || "Agent job";
  const whom = providerDisplayName(opts.provider);
  if (/\b(cursor|chatgpt|opencode|codex)\b/i.test(title)) return title;
  if (opts.kind === "review" || /^review\b/i.test(title) || /\bdx audit\b/i.test(title)) {
    return `${title} · ${whom}`;
  }
  return title;
}

/** Product copy when the configured CLI is missing — never dump the binary name. */
export function cliUnavailableMessage(provider: string): string {
  const id = provider.trim().toLowerCase();
  if (id === "cursor" || id === "cursor-cli") {
    return "Cursor isn’t installed. Pick another provider in Setup.";
  }
  if (id === "chatgpt" || id === "chatgpt-cli" || id === "codex") {
    return "ChatGPT isn’t installed. Pick another provider in Setup.";
  }
  if (id === "api") {
    return "No API key. Set AI_API_KEY in Setup.";
  }
  return "This agent isn’t available. Check Setup.";
}

export function formatAgentStatusLine(opts: {
  phase: AgentUiPhase;
  summary?: string;
  providerLabel?: string;
}): string {
  const whom = opts.providerLabel?.trim();
  const summary = opts.summary?.trim();
  switch (opts.phase) {
    case "starting":
      return whom ? `${whom} · starting` : "Starting…";
    case "running":
      return summary || (whom ? `${whom} · running` : "Running…");
    case "ready":
      return whom ? `${whom} · ready` : "Ready";
    case "done":
      return summary || (whom ? `${whom} · done` : "Done");
    case "failed":
      return summary || (whom ? `${whom} isn’t available` : "Failed");
    default:
      return whom || "Agent";
  }
}
