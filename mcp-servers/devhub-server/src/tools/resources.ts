/**
 * DevHub content as MCP resources — the cacheable, contextual side of the
 * protocol. Tools remain the way to *change* things; resources let a harness
 * pull a note, a doc, or an agent run's event stream without spending a tool
 * call, and let clients that subscribe get `notifications/resources/updated`
 * instead of re-polling.
 *
 * Served here:
 * - devhub://notes/{path}   — the vault note as readable markdown
 * - devhub://docs/{path}    — repo docs markdown
 * - devhub://agent-runs/{runId}/events — a dispatched run's events, formatted
 *   exactly like agent_output, so "watch what the agent did" is a read.
 * - devhub://jobs, devhub://jobs/log — scheduled jobs and scheduler activity,
 *   formatted exactly like jobs_list and jobs_log.
 *
 * Template variables use `{+path}` (RFC 6570 reserved expansion) so hierarchical
 * paths survive as one variable instead of being %-encoded.
 *
 * Updated notifications are best-effort: when a run-events read sees more
 * events than the previous read of the same URI in this process, the server
 * pings subscribers. Never a hard dependency — clients that don't subscribe
 * just re-read.
 */
import fs from "node:fs";
import path from "node:path";
import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Context } from "../context.ts";
import { blocksToText } from "../convert.ts";
import { formatAgentEvent, formatRunSummary, type AgentRunEvent, type AgentRunSummary } from "./agents.ts";
import {
  formatJob,
  formatSchedulerLog,
  formatWake,
  type JobSummary,
  type SchedulerLogResponse,
  type WakeSummary,
} from "./jobs.ts";

const RUN_ID_RE = /^run-[a-z0-9-]+$/;

/** Reject traversal and absolute escapes before anything touches the vault. */
function safeRelPath(raw: string, root: string): string | null {
  const decoded = decodeURIComponent(raw).replace(/\\/g, "/");
  if (/(^|\/)\.\.($|\/)/.test(decoded)) return null;
  // Compare like with like: /var is a symlink to /private/var on macOS, so
  // realpath both sides before the containment check.
  const resolved = path.resolve(root, decoded);
  const realRoot = realPathOrNull(root, root);
  const realResolved = realPathOrNull(resolved, root);
  if (!realRoot || !realResolved) return null;
  if (realResolved !== realRoot && !realResolved.startsWith(realRoot + path.sep)) return null;
  return decoded.replace(/^\/+/, "").replace(/\/+$/, "");
}

function realPathOrNull(target: string, fallbackRoot: string): string | null {
  try {
    return fs.realpathSync(target);
  } catch {
    // Not on disk yet (or a dangling path): the decoded string already refused
    // `..`, so re-anchoring under the real root is enough for containment.
    return path.join(realPathOrNull(fallbackRoot, fallbackRoot) ?? path.resolve(fallbackRoot), path.relative(path.resolve(fallbackRoot), target));
  }
}

interface RunPage {
  run: AgentRunSummary;
  events: AgentRunEvent[];
  next: number;
  total: number;
}

/** Last-seen event totals per run-events URI, for the updated notification. */
const lastEventTotal = new Map<string, number>();

export function registerResourceTools(server: McpServer, ctx: Context): void {
  const { storage, docsStorage, notesDir, docsDir, dashboard } = ctx;

  // ── notes ────────────────────────────────────────────────────────────────
  server.registerResource(
    "notes",
    new ResourceTemplate("devhub://notes/{+path}", {
      list: async () => ({
        resources: storage.list().flatMap(function walk(entry): Array<{ uri: string; name: string; mimeType: string }> {
          if (entry.type === "dir") return (entry.children ?? []).flatMap(walk);
          return [
            {
              uri: `devhub://notes/${entry.path.replace(/\.json$/i, "")}`,
              name: entry.path.replace(/\.json$/i, ""),
              mimeType: "text/markdown",
            },
          ];
        }),
      }),
    }),
    {
      description: `A DevHub note as readable markdown. Notes live under ${notesDir}.`,
      mimeType: "text/markdown",
    },
    async (uri) => {
      const rel = safeRelPath((uri.pathname ?? "").replace(/^\//, ""), notesDir);
      if (!rel) return { contents: [{ uri: uri.href, mimeType: "text/plain", text: "Invalid note path." }] };
      const note = storage.read(rel);
      if (!note) return { contents: [{ uri: uri.href, mimeType: "text/plain", text: `Note not found: ${rel}` }] };
      const blocks = note.content as unknown[];
      const text = blocksToText(Array.isArray(blocks) ? blocks : [blocks]);
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: `# ${note.path}\n\n${text}` }] };
    },
  );

  // ── docs ─────────────────────────────────────────────────────────────────
  server.registerResource(
    "docs",
    new ResourceTemplate("devhub://docs/{+path}", {
      list: async () => ({
        resources: docsStorage.list().flatMap(function walk(entry): Array<{ uri: string; name: string; mimeType: string }> {
          if (entry.type === "dir") return (entry.children ?? []).flatMap(walk);
          return [
            {
              uri: `devhub://docs/${entry.path.replace(/\.md$/i, "")}`,
              name: entry.path.replace(/\.md$/i, ""),
              mimeType: "text/markdown",
            },
          ];
        }),
      }),
    }),
    {
      description: `A repo doc as raw markdown. Docs live under ${docsDir}.`,
      mimeType: "text/markdown",
    },
    async (uri) => {
      const rel = safeRelPath((uri.pathname ?? "").replace(/^\//, ""), docsDir);
      if (!rel) return { contents: [{ uri: uri.href, mimeType: "text/plain", text: "Invalid doc path." }] };
      const doc = docsStorage.read(rel);
      if (!doc) return { contents: [{ uri: uri.href, mimeType: "text/plain", text: `Doc not found: ${rel}` }] };
      const body = typeof doc.content === "string" ? doc.content : JSON.stringify(doc.content, null, 2);
      const header = typeof doc.path === "string" ? doc.path : rel;
      return {
        contents: [{ uri: uri.href, mimeType: "text/markdown", text: `# ${header.replace(/\.md$/i, "")}\n\n${body}` }],
      };
    },
  );

  // ── agent run events ─────────────────────────────────────────────────────
  server.registerResource(
    "agent-runs-events",
    new ResourceTemplate("devhub://agent-runs/{runId}/events", {
      list: async () => {
        try {
          const data = await dashboard.get<{ runs: AgentRunSummary[] }>("/api/agent/runs", { limit: 50 });
          return {
            resources: data.runs.map((run) => ({
              uri: `devhub://agent-runs/${run.id}/events`,
              name: `${run.providerLabel} · ${run.title}`,
              mimeType: "text/plain",
            })),
          };
        } catch {
          // Dashboard down: an empty listing beats a failed listing.
          return { resources: [] };
        }
      },
    }),
    {
      description:
        "The event stream of a dispatched agent run (session, text, tool calls, results) as plain text, plus the run summary. Best-effort notifications/resources/updated fire while new events land.",
      mimeType: "text/plain",
    },
    async (uri) => {
      const match = /\/agent-runs\/([^/]+)\/events$/.exec(uri.href);
      const runId = match?.[1] ? decodeURIComponent(match[1]) : "";
      if (!RUN_ID_RE.test(runId)) {
        return { contents: [{ uri: uri.href, mimeType: "text/plain", text: `Invalid run id: ${runId}` }] };
      }
      const page = await dashboard.get<RunPage>(`/api/agent/runs/${encodeURIComponent(runId)}`, { since: 0, limit: 500 });
      const body = [
        formatRunSummary(page.run),
        "",
        page.events.length
          ? page.events.map((event) => formatAgentEvent(event)).join("\n")
          : "No events yet.",
        page.next < page.total ? `\n(More events — agent_output since=${page.next} pages deeper.)` : "",
      ].join("\n");
      // Best-effort updated ping once the stream has visibly grown.
      const previous = lastEventTotal.get(uri.href);
      if (previous !== undefined && page.total > previous) {
        lastEventTotal.set(uri.href, page.total);
        try {
          await server.server.sendResourceUpdated({ uri: uri.href });
        } catch {
          // Client may not be subscribed; a failed notification must not fail the read.
        }
      } else {
        lastEventTotal.set(uri.href, page.total);
      }
      return { contents: [{ uri: uri.href, mimeType: "text/plain", text: body }] };
    },
  );

  // ── scheduled jobs ───────────────────────────────────────────────────────
  server.registerResource(
    "jobs",
    "devhub://jobs",
    {
      description: "DevHub scheduled jobs with next and last run, plus the wake-helper status — the same view as jobs_list.",
      mimeType: "text/plain",
    },
    async (uri) => {
      const data = await dashboard.get<{ jobs: JobSummary[]; wake: WakeSummary }>("/api/jobs");
      const text = [
        formatWake(data.wake),
        "",
        data.jobs.length ? data.jobs.map((job) => formatJob(job)).join("\n") : "No scheduled jobs.",
      ].join("\n");
      return { contents: [{ uri: uri.href, mimeType: "text/plain", text }] };
    },
  );

  server.registerResource(
    "jobs-log",
    "devhub://jobs/log",
    {
      description:
        "Recent DevHub scheduler activity — why runs fired, how they ended, every wake scheduled — plus the wake helper's log. The same view as jobs_log.",
      mimeType: "text/plain",
    },
    async (uri) => {
      const data = await dashboard.get<SchedulerLogResponse>("/api/jobs/log", { lines: 200 });
      return { contents: [{ uri: uri.href, mimeType: "text/plain", text: formatSchedulerLog(data) }] };
    },
  );
}

/** Test seam: drop the per-process event-total cache. */
export function resetResourceCaches(): void {
  lastEventTotal.clear();
}
