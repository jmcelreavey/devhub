import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Context } from "../context.ts";
import { blocksToText } from "../convert.ts";

/**
 * DX audit reports — the read side of the `dx-audit` skill.
 *
 * The skill (skills/shared/dx-audit) writes reports to notes at
 * `reviews/dx-audit-<repo>-<YYYY-MM-DD>`; these tools list and read them so
 * agents can pull the latest audit for a repo without knowing the path
 * convention. Filesystem-backed: no dashboard required.
 */

const NOTE_RE = /^dx-audit-(.+)-(\d{4}-\d{2}-\d{2})\.json$/;

interface AuditEntry {
  repo: string;
  date: string;
  path: string; // notes-relative, extensionless (notes_read compatible)
}

function listAudits(ctx: Context, repo?: string): AuditEntry[] {
  const entries = ctx.storage.list("reviews");
  const audits: AuditEntry[] = [];
  for (const entry of entries) {
    if (entry.type !== "file") continue;
    const m = entry.name.match(NOTE_RE);
    if (!m) continue;
    if (repo && m[1] !== repo) continue;
    audits.push({ repo: m[1], date: m[2], path: `reviews/${entry.name.replace(/\.json$/, "")}` });
  }
  audits.sort((a, b) => (a.date === b.date ? a.repo.localeCompare(b.repo) : b.date.localeCompare(a.date)));
  return audits;
}

export function registerDxAuditTools(server: McpServer, ctx: Context): void {
  server.registerTool(
    "dx_audit_list",
    {
      description:
        "List developer-experience audit reports written by the dx-audit skill (notes under reviews/dx-audit-<repo>-<date>). Optionally filter by repo name. Newest first.",
      inputSchema: {
        repo: z.string().optional().describe("Repo name to filter by (e.g. 'insider-app')"),
      },
    },
    async ({ repo }) => {
      const audits = listAudits(ctx, repo);
      if (!audits.length) {
        return {
          content: [
            {
              type: "text",
              text: `No DX audit reports found${repo ? ` for '${repo}'` : ""}. Run one from the Repos page DX Audit button (dx-audit skill).`,
            },
          ],
        };
      }
      const lines = audits.map((a) => `- ${a.repo} (${a.date}) — ${a.path}`);
      return { content: [{ type: "text", text: `DX audits (${audits.length}):\n${lines.join("\n")}` }] };
    },
  );

  server.registerTool(
    "dx_audit_read",
    {
      description:
        "Read a DX audit report as markdown. Give a repo name to get its latest audit, or a repo plus date (YYYY-MM-DD) for a specific one.",
      inputSchema: {
        repo: z.string().describe("Repo name (e.g. 'insider-app')"),
        date: z.string().optional().describe("Specific audit date YYYY-MM-DD; defaults to latest"),
      },
    },
    async ({ repo, date }) => {
      const audits = listAudits(ctx, repo);
      const target = date ? audits.find((a) => a.date === date) : audits[0];
      if (!target) {
        return {
          content: [
            {
              type: "text",
              text: `No DX audit found for '${repo}'${date ? ` on ${date}` : ""}. Try dx_audit_list, or run one from the Repos page.`,
            },
          ],
          isError: true,
        };
      }
      const note = ctx.storage.read(target.path);
      if (!note) {
        return { content: [{ type: "text", text: `Audit note missing on disk: ${target.path}` }], isError: true };
      }
      const text = blocksToText(note.content as unknown[]);
      return { content: [{ type: "text", text: `# ${target.repo} — ${target.date} (${target.path})\n\n${text}` }] };
    },
  );
}
