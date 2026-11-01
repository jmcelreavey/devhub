import type { z } from "zod";
import type { ActionDefinition } from "../../../../packages/shared/actions/define.ts";
import { skillsList, skillsProposals, personaList, type WorkspaceContext, skillsRead, skillsProposeUpdate, contextPack, collectionsList, radarPersonal, learningsList } from "../../../../packages/shared/actions/workspace.ts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Context } from "../context.ts";
import { requestAction, withDashboardErrors, type DashboardToolResult } from "../dashboard-client.ts";
import { listWidgetHtml, uiResult } from "../ui.ts";
import { agentsCatalogList } from "../../../../packages/shared/actions/agents.ts";
import { registerAction } from "../actions/register.ts";

/**
 * Read-side coverage for dashboard areas that had no MCP tools: skills,
 * context packs, collections, research, personal radar, persona,
 * learnings and agents.
 *
 * Catalog reads and cited skill proposals proxy the dashboard. Browser editing
 * and local launch operations stay on their existing surfaces; the shared
 * action definitions record the exposure decisions.
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

  return `${label}:\n\`\`\`json\n${JSON.stringify(payload).slice(0, 6_000)}\n\`\`\``;
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

  const readTool = <Schema extends z.ZodObject>(
    action: ActionDefinition<Schema, WorkspaceContext<z.output<Schema>>, unknown>,
    path: string, label: string, timeoutMs?: number,
  ) => registerAction(server, action, {
    execute: () => withDashboardErrors(async () => {
      const data = await dashboard.get(path, undefined, timeoutMs);
      return { content: [{ type: "text", text: render(label, data) }] };
    }),
  }, (result) => result as DashboardToolResult, undefined, { omitInputSchema: true });

  readTool(skillsList, "/api/skills", "Skills");

  registerAction(server, skillsRead, { execute: async ({ name }) =>
      withDashboardErrors(async () => {
        const data = await dashboard.get(`/api/skills/${encodeURIComponent(name)}`);
        return { content: [{ type: "text", text: render(`Skill: ${name}`, data) }] };
      }) },
    (result) => result as DashboardToolResult);

  readTool(skillsProposals, "/api/skills/proposals", "Skill proposals");

  registerAction(server, skillsProposeUpdate, { execute: async input => withDashboardErrors(async () => {
    const result = await dashboard.post<{ id: string; status: string }>("/api/skills/proposals", input);
    return { content: [{ type: "text", text: JSON.stringify({ id: result.id, status: result.status, review: "/skills/proposals" }) }] };
  }) },
    (result) => result as DashboardToolResult);

  registerAction(server, contextPack, { execute: async ({ format }) =>
      withDashboardErrors(async () => {
        const data = await dashboard.get("/api/context-pack", format ? { format } : undefined, 60_000);
        return { content: [{ type: "text", text: render("Context pack", data) }] };
      }) },
    (result) => result as DashboardToolResult);

  registerAction(server, collectionsList, { execute: async ({ notePath }) =>
      withDashboardErrors(async () => {
        const data = await dashboard.get("/api/collections", notePath ? { notePath } : undefined);
        return { content: [{ type: "text", text: render("Collections", data) }] };
      }) },
    (result) => result as DashboardToolResult);


  registerAction(server, radarPersonal, { execute: async () =>
      withDashboardErrors(async () => {
        const data = await dashboard.get<{
          items?: Array<{ ring?: string; text?: string }>;
          ownedRepoAttention?: Array<{ repo?: { fullName?: string }; attention?: { score?: number } }>;
        }>("/api/radar/personal", undefined, 60_000);
        const text = render("Personal radar", data);
        const items = [
          ...(data.items ?? []).map((item) => ({
            label: item.text || "(empty)",
            meta: item.ring,
          })),
          ...(data.ownedRepoAttention ?? []).slice(0, 8).map((row) => ({
            label: row.repo?.fullName || "owned repo",
            meta: `attention ${row.attention?.score ?? 0}`,
          })),
        ];
        const html = items.length ? listWidgetHtml("Personal radar", "Worth your attention", items) : null;
        return uiResult(text, html, "ui://devhub/radar/personal");
      }) },
    (result) => result as DashboardToolResult, undefined, { omitInputSchema: true });

  readTool(personaList, "/api/persona", "Personas");

  registerAction(server, learningsList, { execute: async ({ category }) =>
      withDashboardErrors(async () => {
        const data = await dashboard.get("/api/learnings", category ? { category } : undefined);
        return { content: [{ type: "text", text: render("Learnings", data) }] };
      }) },
    (result) => result as DashboardToolResult);

  registerAction(
    server, agentsCatalogList,
    { read: () => requestAction(dashboard, agentsCatalogList.http) },
    (data) => ({ content: [{ type: "text", text: render("Agents", data) }] }),
    (operation) => withDashboardErrors(async () => await operation() as DashboardToolResult),
    { omitInputSchema: true },
  );

}
