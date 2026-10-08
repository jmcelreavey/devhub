/**
 * Progress events for "Generate Jira ticket".
 *
 * Shared by the draft route (which writes them as NDJSON, one per line) and
 * the create form (which reads them), so this file must stay free of server
 * imports.
 */
import type { JiraTicketDraftResult } from "./draft-ticket";

export type DraftStepId = "context" | "jira" | "draft" | "format";

/** In display order. `context` and `jira` run side by side; the rest follow on. */
export const DRAFT_STEPS: readonly { id: DraftStepId; label: string }[] = [
  { id: "context", label: "Reading the task and linked notes" },
  { id: "jira", label: "Checking linked Jira tickets" },
  { id: "draft", label: "Writing the draft" },
  { id: "format", label: "Checking the draft" },
];

export type DraftEvent =
  /** `at` is milliseconds since the request started, so durations never depend on the client's clock. */
  | { type: "step"; step: DraftStepId; status: "running" | "done" | "error"; at: number; detail?: string }
  /** The title and description as far as the model has written them. */
  | { type: "partial"; summary: string; description: string }
  | { type: "result"; draft: JiraTicketDraftResult; totalMs: number }
  | { type: "error"; step: DraftStepId | null; message: string; totalMs: number };

export const DRAFT_NDJSON_TYPE = "application/x-ndjson";

/** Raised by the drafting pipeline so the route can say which step failed. */
export class DraftStepError extends Error {
  constructor(readonly step: DraftStepId, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = "DraftStepError";
  }
}

const ESCAPES: Record<string, string> = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f" };

/** Read a JSON string body from just after its opening quote, stopping at the closing quote or the end of the text. */
function readJsonString(text: string, from: number): string {
  let out = "";
  for (let i = from; i < text.length; i++) {
    const char = text[i]!;
    if (char === '"') break;
    if (char !== "\\") {
      out += char;
      continue;
    }
    const next = text[i + 1];
    if (next === undefined) break;
    if (next === "u") {
      const hex = text.slice(i + 2, i + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) break; // the escape is still arriving
      out += String.fromCharCode(parseInt(hex, 16));
      i += 5;
      continue;
    }
    out += ESCAPES[next] ?? next;
    i++;
  }
  return out;
}

function stringValueOf(text: string, key: string): string {
  const match = new RegExp(`"${key}"\\s*:\\s*"`).exec(text);
  return match ? readJsonString(text, match.index + match[0].length) : "";
}

/**
 * Pull the title and description out of a reply that is still being written.
 * The reply is a JSON object, so it can't be parsed until it's finished; this
 * reads whatever string values exist so far.
 */
export function extractPartialDraft(text: string): { summary: string; description: string } {
  return { summary: stringValueOf(text, "summary"), description: stringValueOf(text, "description") };
}

/**
 * Parse the model's JSON reply. Models regularly put a raw line break inside a
 * string value, which strict JSON rejects, so on failure retry with control
 * characters inside strings escaped. Anything still invalid throws.
 */
export function parseDraftJson(raw: string): unknown {
  const json = raw.trim().replace(/^`{3}(?:json)?\s*/i, "").replace(/\s*`{3}$/, "");
  try {
    return JSON.parse(json);
  } catch (strictError) {
    let inString = false;
    let escaped = false;
    let repaired = "";
    for (const char of json) {
      if (inString && !escaped && char.charCodeAt(0) < 0x20) {
        repaired += char === "\n" ? "\\n" : char === "\r" ? "\\r" : char === "\t" ? "\\t" : "";
        continue;
      }
      if (char === '"' && !escaped) inString = !inString;
      escaped = char === "\\" && !escaped;
      repaired += char;
    }
    try {
      return JSON.parse(repaired);
    } catch {
      throw strictError;
    }
  }
}

/**
 * Split an NDJSON byte stream into events. Hands back the unfinished tail so
 * the caller can prepend it to the next chunk.
 */
export function parseNdjsonChunk(buffer: string): { events: DraftEvent[]; rest: string } {
  const lines = buffer.split("\n");
  const rest = lines.pop() ?? "";
  const events: DraftEvent[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line) as DraftEvent);
    } catch {
      // A garbled line shouldn't end the whole draft; the result/error event still arrives.
    }
  }
  return { events, rest };
}
