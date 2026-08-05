import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Context } from "../context.ts";
import { withDashboardErrors } from "../dashboard-client.ts";

/**
 * Read-side coverage for dashboard areas that had no MCP tools: skills,
 * context packs, collections, jobs, research, personal radar, persona,
 * learnings, agents and briefing tasks.
 *
 * These are all GET proxies. Action routes in the same areas (`/api/actions/*`
 * launches an editor or agent process, `/api/persona` writes config) are
 * deliberately not exposed yet — see the note at the bottom of this file.
 */

/** Render whatever the dashboard returned without guessing its shape too hard. */
function render(label: string, payload: unknown): string {
  if (payload == null) return `${label}: (empty)`;
  if (typeof payload === "string") return payload.trim() || `${label}: (empty)`;

  if (Array.isArray(payload)) return renderList(label, payload);

  if (typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => k !== "ok" && k !== "error");

    // Render every array the envelope carries as its own section. Several
    // routes return more than one (`/api/jobs` gives `jobs` *and* `scripts`),
    // and an earlier single-key-only version dumped those as raw JSON.
    const arrayKeys = keys.filter((k) => Array.isArray(obj[k]));
    if (arrayKeys.length > 0) {
      const sections = arrayKeys.map((k) =>
        renderList(k === keys[0] && arrayKeys.length === 1 ? label : titleCase(k), obj[k] as unknown[]),
      );
      const leftovers = keys.filter((k) => !arrayKeys.includes(k) && obj[k] != null);
      if (leftovers.length > 0) {
        sections.push(leftovers.map((k) => `${titleCase(k)}: ${String(obj[k])}`).join("\n"));
      }
      return sections.join("\n\n");
    }

    if (keys.length === 1 && typeof obj[keys[0]] === "string") {
      return (obj[keys[0]] as string).trim() || `${label}: (empty)`;
    }
  }

  return `${label}:\n\`\`\`json\n${JSON.stringify(payload, null, 2).slice(0, 6_000)}\n\`\`\``;
}

function titleCase(key: string): string {
  const spaced = key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[-_]/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function renderList(label: string, items: unknown[]): string {
  if (items.length === 0) return `${label}: none`;
  const lines = items.slice(0, 200).map((item) => {
    if (typeof item === "string") return `- ${item}`;
    if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      const name = o.name ?? o.title ?? o.id ?? o.path ?? o.key ?? o.label;
      // No name-like field — inline the object rather than printing "undefined",
      // which is what `/api/radar/personal` items did.
      if (name === undefined) return `- ${JSON.stringify(o)}`;
      const detail = o.description ?? o.summary ?? o.status ?? o.state;
      return detail ? `- **${String(name)}** — ${String(detail)}` : `- ${String(name)}`;
    }
    return `- ${String(item)}`;
  });
  const more = items.length > lines.length ? `\n_(+${items.length - lines.length} more)_` : "";
  return `${label} (${items.length}):\n${lines.join("\n")}${more}`;
}

export function registerWorkspaceTools(server: McpServer, ctx: Context): void {
  const { dashboard } = ctx;

  const readTool = (
    name: string,
    description: string,
    path: string,
    label: string,
    timeoutMs?: number,
  ) => {
    server.registerTool(name, { description }, async () =>
      withDashboardErrors(async () => {
        const data = await dashboard.get(path, undefined, timeoutMs);
        return { content: [{ type: "text", text: render(label, data) }] };
      }),
    );
  };

  readTool(
    "skills_list",
    "List the skills available in this DevHub workspace (core + plugin skills merged). Use this to find out what specialised capabilities exist before improvising.",
    "/api/skills",
    "Skills",
  );

  server.registerTool(
    "skills_read",
    {
      description: "Read a single skill's full definition by name, as listed by skills_list.",
      inputSchema: { name: z.string().min(1).describe("Skill name from skills_list") },
    },
    async ({ name }) =>
      withDashboardErrors(async () => {
        const data = await dashboard.get(`/api/skills/${encodeURIComponent(name)}`);
        return { content: [{ type: "text", text: render(`Skill: ${name}`, data) }] };
      }),
  );

  server.registerTool(
    "context_pack",
    {
      description:
        "Assemble the DevHub context pack — a consolidated snapshot of the current working state. Useful as a first call when picking up work with no other context.",
      inputSchema: {
        format: z
          .string()
          .optional()
          .describe("Optional format hint passed through to the dashboard (e.g. 'markdown')"),
      },
    },
    async ({ format }) =>
      withDashboardErrors(async () => {
        const data = await dashboard.get("/api/context-pack", format ? { format } : undefined, 60_000);
        return { content: [{ type: "text", text: render("Context pack", data) }] };
      }),
  );

  server.registerTool(
    "collections_list",
    {
      description:
        "List collections, or the collections a given note belongs to when `notePath` is supplied.",
      inputSchema: {
        notePath: z.string().optional().describe("Optional note path to filter by membership"),
      },
    },
    async ({ notePath }) =>
      withDashboardErrors(async () => {
        const data = await dashboard.get("/api/collections", notePath ? { notePath } : undefined);
        return { content: [{ type: "text", text: render("Collections", data) }] };
      }),
  );

  readTool("jobs_list", "List background jobs and their current status.", "/api/jobs", "Jobs");

  server.registerTool(
    "jobs_get",
    {
      description: "Get one background job by id, including its status and any result.",
      inputSchema: { id: z.string().min(1).describe("Job id from jobs_list") },
    },
    async ({ id }) =>
      withDashboardErrors(async () => {
        const data = await dashboard.get(`/api/jobs/${encodeURIComponent(id)}`);
        return { content: [{ type: "text", text: render(`Job ${id}`, data) }] };
      }),
  );

  readTool("research_list", "List research runs and their results.", "/api/research", "Research", 60_000);

  readTool(
    "radar_personal",
    "Personal radar: what DevHub thinks is currently worth your attention.",
    "/api/radar/personal",
    "Personal radar",
    60_000,
  );

  readTool(
    "persona_list",
    "List the configured persona modes (read-only — this tool does not switch persona).",
    "/api/persona",
    "Personas",
  );

  server.registerTool(
    "learnings_list",
    {
      description: "List captured learnings, optionally filtered to one category.",
      inputSchema: { category: z.string().optional().describe("Optional category filter") },
    },
    async ({ category }) =>
      withDashboardErrors(async () => {
        const data = await dashboard.get("/api/learnings", category ? { category } : undefined);
        return { content: [{ type: "text", text: render("Learnings", data) }] };
      }),
  );

  readTool(
    "agents_list",
    "List the agents configured in this workspace (core + plugin agents).",
    "/api/agents",
    "Agents",
  );

  readTool(
    "briefing_tasks",
    "The tasks attached to today's briefing canvas. Complements briefing_get, which returns the readable briefing text.",
    "/api/briefing/tasks",
    "Briefing tasks",
  );
}

/**
 * Deliberately not exposed yet:
 *
 * - `/api/actions/launch-{chamber,claude,opencode}` — spawns processes on the
 *   host. Worth having, but it should be an explicit decision rather than
 *   arriving as a side effect of a parity sweep.
 * - `/api/persona` POST, `/api/collections` POST, `/api/briefing/tasks` POST —
 *   writes whose request shapes deserve their own schemas rather than a
 *   pass-through, so an agent gets a useful validation error instead of a 400.
 * - `/api/setup/*`, `/api/desktop/*`, `/api/sidebar/*` — app-internal.
 * - `/api/tree`, `/api/since`, `/api/sync-{health,preview}`, `/api/note-order`,
 *   `/api/terminal/*` — UI-shaped, low agent value.
 */
