/**
 * Search across terminal session transcripts — "what was that command I ran on
 * Tuesday" — over the logs the PTY peer already tees to disk.
 *
 * R6 in the roadmap, with its own precondition attached: *"do the
 * retention/redaction thinking first; making a plaintext transcript more
 * discoverable is only good if it isn't full of tokens."*
 *
 * That caveat is the whole design. A shell transcript is one of the most
 * secret-dense files on a developer's machine: exported env vars, `curl -H
 * "Authorization: ..."`, cloud CLI output, pasted credentials. Today those
 * sit in a temp directory nobody greps. Adding search without masking would
 * turn a dormant risk into a convenient one, and the results end up rendered
 * in a browser and potentially copied elsewhere.
 *
 * So masking happens on the way *out*, before a line can reach an API
 * response, and it is deliberately over-eager: a false positive costs a
 * `[redacted]` in a search result, a false negative leaks a live credential.
 */
import fs from "node:fs";
import path from "node:path";
import { terminalLogDir, isValidSessionId, readSessionLogTail } from "@/lib/terminal-log";

export interface TerminalMatch {
  sessionId: string;
  /** 1-based line number within the cleaned transcript. */
  line: number;
  /** The matching line, redacted. */
  text: string;
  /** Session log mtime, ms. */
  modifiedAt: number;
}

export interface TerminalSearchResult {
  matches: TerminalMatch[];
  /** Sessions actually opened (after the cap). */
  sessionsSearched: number;
  /** True when the result set was cut short by a limit. */
  truncated: boolean;
}

/** Don't read unbounded history into memory for one query. */
const MAX_SESSIONS = 60;
const MAX_MATCHES = 200;
/** A pasted base64 blob shouldn't blow up the response. */
const MAX_LINE_CHARS = 400;

/**
 * Patterns whose *value* must never survive into a search result.
 *
 * Ordered roughly by confidence. Each replacement keeps enough shape for the
 * line to stay readable ("export AWS_SECRET_ACCESS_KEY=[redacted]") because a
 * result you can't recognise is a result you can't use.
 */
const REDACTIONS: { re: RegExp; replace: string }[] = [
  // Authorization / Proxy-Authorization headers, including curl -H forms.
  //
  // MUST run before the generic KEY=value rule below: "Authorization" contains
  // "AUTH", so that rule would otherwise match the header name and treat the
  // *scheme* ("Bearer") as the value, redacting the word Bearer and leaving the
  // real token in the output.
  //
  // The scheme also has to carry its own trailing whitespace. Written as
  // `(?:Bearer|Basic)?\s*\S+` the optional group happily matches empty and
  // `\S+` consumes the word "Bearer" instead of the credential. Both of these
  // leaked every bearer token in an earlier revision; the test caught it.
  {
    re: /\b((?:Proxy-)?Authorization\s*:\s*)(?:(?:Bearer|Basic|Token|Digest)\s+)?\S+/gi,
    replace: "$1[redacted]",
  },
  // KEY=value / KEY: value where the key name smells secret.
  {
    re: /\b([A-Za-z0-9_]*(?:SECRET|PASSWORD|PASSWD|TOKEN|APIKEY|API_KEY|ACCESS_KEY|PRIVATE_KEY|CREDENTIAL|SESSION_KEY|AUTH)[A-Za-z0-9_]*)(\s*[:=]\s*)("[^"]*"|'[^']*'|\S+)/gi,
    replace: "$1$2[redacted]",
  },
  // Known provider token shapes, which are recognisable on their own.
  { re: /\bgh[pousr]_[A-Za-z0-9]{16,}/g, replace: "[redacted-github-token]" },
  { re: /\bsk-[A-Za-z0-9-_]{16,}/g, replace: "[redacted-api-key]" },
  { re: /\bxox[abposr]-[A-Za-z0-9-]{8,}/g, replace: "[redacted-slack-token]" },
  { re: /\bAKIA[0-9A-Z]{16}\b/g, replace: "[redacted-aws-key-id]" },
  { re: /\bAIza[0-9A-Za-z\-_]{20,}/g, replace: "[redacted-google-key]" },
  { re: /\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, replace: "[redacted-jwt]" },
  // Credentials embedded in a URL: scheme://user:pass@host
  { re: /\b([a-z][a-z0-9+.-]*:\/\/[^\s:@/]+):([^\s@/]+)@/gi, replace: "$1:[redacted]@" },
  // PEM private key body.
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, replace: "[redacted-private-key]" },
  // CLI flags that take a secret inline.
  {
    re: /(--(?:password|token|api-key|secret|auth)(?:[= ]))("[^"]*"|'[^']*'|\S+)/gi,
    replace: "$1[redacted]",
  },
];

/**
 * Mask anything credential-shaped. Exported for tests, and because anything
 * else that renders transcript text should route through it too.
 */
export function redactSecrets(line: string): string {
  let out = line;
  for (const { re, replace } of REDACTIONS) {
    out = out.replace(re, replace);
  }
  return out;
}

/** Session logs, newest first. */
export function listSessionLogs(): { sessionId: string; file: string; modifiedAt: number }[] {
  const dir = terminalLogDir();
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out: { sessionId: string; file: string; modifiedAt: number }[] = [];
  for (const name of names) {
    if (!name.endsWith(".log")) continue;
    const sessionId = name.slice(0, -4);
    // Reuse the id validator so a stray file can't widen what we read.
    if (!isValidSessionId(sessionId)) continue;
    const file = path.join(dir, name);
    try {
      out.push({ sessionId, file, modifiedAt: fs.statSync(file).mtimeMs });
    } catch {
      /* vanished between readdir and stat */
    }
  }
  return out.sort((a, b) => b.modifiedAt - a.modifiedAt);
}

export interface SessionTranscript {
  sessionId: string;
  /** Redacted cleaned lines (same indexing as search hits). */
  lines: string[];
  modifiedAt: number;
  truncated: boolean;
}

/**
 * Historical transcript for the viewer — same tail + line index as search,
 * with secrets masked before anything reaches the browser.
 */
export function getSessionTranscript(sessionId: string): SessionTranscript | null {
  const tail = readSessionLogTail(sessionId);
  if (!tail) return null;
  return {
    sessionId: tail.sessionId,
    lines: tail.lines.map((line) => redactSecrets(line)),
    modifiedAt: tail.modifiedAt,
    truncated: tail.truncated,
  };
}

/**
 * Case-insensitive substring search across recent sessions.
 *
 * Substring rather than regex on purpose: this is reached from a search box,
 * and letting arbitrary user regex run over every transcript invites a
 * catastrophic-backtracking stall on the server for no real benefit.
 */
export function searchTerminalSessions(query: string, limit = MAX_MATCHES): TerminalSearchResult {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return { matches: [], sessionsSearched: 0, truncated: false };

  const logs = listSessionLogs().slice(0, MAX_SESSIONS);
  const matches: TerminalMatch[] = [];
  let truncated = false;
  let searched = 0;

  for (const log of logs) {
    searched += 1;
    const tail = readSessionLogTail(log.sessionId);
    if (!tail) continue;
    const lines = tail.lines;
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].toLowerCase().includes(needle)) continue;
      if (matches.length >= limit) {
        truncated = true;
        break;
      }
      const text = redactSecrets(lines[i]).slice(0, MAX_LINE_CHARS);
      matches.push({
        sessionId: log.sessionId,
        line: i + 1,
        text,
        modifiedAt: log.modifiedAt,
      });
    }
    if (truncated) break;
  }

  return { matches, sessionsSearched: searched, truncated };
}
