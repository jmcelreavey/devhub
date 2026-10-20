import type { SlackTool } from "./mcp-catalog";
import { slackReadOnly } from "./tool-risk";

const STOP = new Set(["the", "and", "for", "are", "what", "whats", "what's", "with", "that", "this", "have", "has", "can", "you", "your", "my", "me", "any", "all", "show", "list", "tell", "give", "please", "get", "from", "into", "about", "there", "how", "many", "much", "is", "it", "to", "of", "in", "on", "do", "does", "did", "i", "a", "an"]);

function words(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 3 && !STOP.has(word)).map((word) => word.replace(/(?:ies)$/, "y").replace(/(?<=[a-z]{3})s$/, ""));
}

/**
 * Free, no-model guess at what a message is about: read-only tools whose name or description share words
 * with it. Name matches count double. Used only to offer "Did you mean" buttons when Jev can't route.
 */
export function guessTools(text: string, tools: readonly SlackTool[], limit = 3): SlackTool[] {
  const wanted = new Set(words(text));
  if (!wanted.size) return [];
  return tools
    .filter((tool) => slackReadOnly(tool))
    .map((tool) => {
      const name = new Set(words(tool.name.replace(/_/g, " ")));
      const description = new Set(words(tool.description ?? ""));
      let score = 0;
      for (const word of wanted) score += (name.has(word) ? 2 : 0) + (description.has(word) ? 1 : 0);
      return { tool, score };
    })
    .filter((entry) => entry.score >= 2)
    .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name))
    .slice(0, limit)
    .map((entry) => entry.tool);
}

function timeZone(): string {
  const configured = process.env.DEVHUB_TIMEZONE?.trim();
  if (configured) {
    try { new Intl.DateTimeFormat("en-GB", { timeZone: configured }); return configured; } catch { /* fall through */ }
  }
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/London";
}

/** "It's 23:41 on Sunday 18 October (Europe/London)." Free, no tools. */
export function timeAnswer(now = new Date()): string {
  const zone = timeZone();
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: zone, weekday: "long", day: "numeric", month: "long" }).format(now);
  return `It's ${time} on ${day} (${zone}).`;
}
