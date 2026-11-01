import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dxAuditList, dxAuditRead } from "../../../../packages/shared/actions/dx-audit.ts";
import { registerAction } from "../actions/register.ts";
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
  registerAction(server, dxAuditList, { execute: async ({ repo }) => {
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
  } }, (result) => result);

  registerAction(server, dxAuditRead, { execute: async ({ repo, date }) => {
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
  } }, (result) => result);
}
