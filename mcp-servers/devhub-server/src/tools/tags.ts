/**
 * Tag tools — discovery and lookup for the derived `#tag` layer.
 *
 * Tags are never stored as objects: writing `#auth` in a task text, note body
 * or commit message IS creating the tag. So there is no `tags_create` — the
 * create path is just text. What agents need from MCP is the read side:
 * which tags exist (so they reuse rather than fork vocabulary), what a tag
 * connects to, and a guarded rename for when vocabulary drifts anyway.
 *
 * Dashboard-backed on purpose, same reasoning as recall: the tag index and
 * vault walks live in the dashboard process; duplicating them here would be a
 * second implementation to keep in sync.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Context } from "../context.ts";
import { withDashboardErrors } from "../dashboard-client.ts";

interface TagCount {
  id: string;
  count: number;
}

interface TagLookup {
  tag: string;
  tasks: Array<{ date: string; id: string; text: string; done: boolean }>;
  notes: Array<{ title: string; href: string }>;
  related: Array<{ kind: string; id: string; label: string }>;
}

export function registerTagsTools(server: McpServer, ctx: Context): void {
  const { dashboard } = ctx;

  server.registerTool(
    "tags_list",
    {
      description:
        "List known DevHub tags (#tokens) with usage counts. Call this BEFORE tagging new work: reusing an existing tag keeps the corpus connected, inventing a near-duplicate (`auth` vs `authentication`) splits it.",
      inputSchema: {
        q: z.string().optional().describe("Substring filter, e.g. 'auth'"),
      },
    },
    async ({ q }) =>
      withDashboardErrors(async () => {
        const data = await dashboard.get<{ tags: TagCount[] }>("/api/tags", { q });
        if (!data.tags?.length) {
          return { content: [{ type: "text", text: "No tags yet. Create one by writing #tag in a task or note." }] };
        }
        const lines = data.tags.map((t) => `#${t.id} (${t.count})`);
        return {
          content: [{ type: "text", text: `${data.tags.length} tag(s):\n${lines.join("\n")}` }],
        };
      }),
  );

  server.registerTool(
    "tags_lookup",
    {
      description:
        "Everything tied to one tag: matching tasks (live), notes and docs mentioning it (from the recall index), and PRs/Jira keys the derived graph associates with it. The 'give me the full picture around #topic' tool.",
      inputSchema: {
        tag: z.string().describe("Tag id without the # prefix, e.g. 'devhub'"),
      },
    },
    async ({ tag }) =>
      withDashboardErrors(async () => {
        const data = await dashboard.get<TagLookup>(`/api/tags/${encodeURIComponent(tag)}`);
        const sections: string[] = [];
        if (data.tasks.length) {
          sections.push(
            `Tasks (${data.tasks.length}):\n${data.tasks.map((t) => `- [${t.done ? "x" : " "}] ${t.date} ${t.text}`).join("\n")}`,
          );
        }
        if (data.notes.length) {
          sections.push(
            `Notes & docs:\n${data.notes.map((n) => `- ${n.title} — ${n.href}`).join("\n")}`,
          );
        }
        if (data.related.length) {
          sections.push(
            `Related:\n${data.related.map((r) => `- [${r.kind}] ${r.label}`).join("\n")}`,
          );
        }
        if (sections.length === 0) {
          return { content: [{ type: "text", text: `Nothing tagged #${tag} yet.` }] };
        }
        return { content: [{ type: "text", text: `#${tag}\n\n${sections.join("\n\n")}` }] };
      }),
  );

  server.registerTool(
    "tags_rename",
    {
      description:
        "Rename a tag everywhere: rewrites #from → #to across all task texts and note bodies. Boundary-safe (#auth-old survives renaming #auth). Destructive-ish but exact — requires confirm:true after you have told the user what will change. Prefer tags_list first to check the target name doesn't already exist.",
      inputSchema: {
        from: z.string().describe("Current tag id (no # prefix)"),
        to: z.string().describe("New tag id (no # prefix); lowercase letters/digits/-/_ starting with a letter or _"),
        confirm: z.boolean().optional().describe("Required true to apply the rewrite"),
      },
    },
    async ({ from, to, confirm }) => {
      if (!confirm) {
        return {
          content: [
            {
              type: "text",
              text: `This rewrites #${from} → #${to} across every task and note on disk. Re-run with confirm:true to apply.`,
            },
          ],
        };
      }
      return withDashboardErrors(async () => {
        const data = await dashboard.post<{ from: string; to: string; filesChanged: number; replacements: number }>(
          "/api/tags/rename",
          { from, to },
        );
        return {
          content: [
            {
              type: "text",
              text: `Renamed #${data.from} → #${data.to}: ${data.replacements} occurrence(s) across ${data.filesChanged} file(s).`,
            },
          ],
        };
      });
    },
  );
}
