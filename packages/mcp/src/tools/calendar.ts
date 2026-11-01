import { calendarWeek, calendarList } from "../../../../packages/shared/actions/calendar.ts";
import { registerAction } from "../actions/register.ts";
import type { DashboardToolResult } from "../dashboard-client.ts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Context } from "../context.ts";
import { withDashboardErrors } from "../dashboard-client.ts";

interface CalEvent {
  summary?: string;
  start?: string;
  end?: string;
  allDay?: boolean;
  [k: string]: unknown;
}

export function registerCalendarTools(server: McpServer, ctx: Context): void {
  const { dashboard } = ctx;

  registerAction(server, calendarWeek, { execute: async () =>
      withDashboardErrors(async () => {
        const data = await dashboard.get<{ days?: Record<string, CalEvent[]>; needsReauth?: boolean }>(
          "/api/calendar/week",
        );
        if (data.needsReauth) {
          return {
            content: [
              { type: "text", text: "Google Calendar needs reconnecting — open /calendar in the dashboard to re-auth." },
            ],
            isError: true,
          };
        }
        const days = data.days ?? {};
        const dates = Object.keys(days).sort();
        if (dates.length === 0) {
          return { content: [{ type: "text", text: "No calendar events this week (or calendar not configured)." }] };
        }
        const out: string[] = [];
        for (const date of dates) {
          const events = days[date] ?? [];
          if (events.length === 0) continue;
          out.push(`**${date}**`);
          for (const e of events) {
            const time = e.allDay ? "all-day" : [e.start, e.end].filter(Boolean).join("–") || "";
            out.push(`  - ${time ? `${time} ` : ""}${e.summary ?? "(untitled)"}`);
          }
        }
        return {
          content: [{ type: "text", text: out.length ? out.join("\n") : "No events scheduled this week." }],
        };
      }) },
    (result) => result as DashboardToolResult, undefined, { omitInputSchema: true });

  registerAction(server, calendarList, { execute: async () =>
      withDashboardErrors(async () => {
        const data = await dashboard.get<{
          configured: boolean;
          calendars?: Array<{ id: string; summary?: string }>;
          selectedIds?: string[];
          needsReauth?: boolean;
        }>("/api/calendar/calendars");
        if (!data.configured) {
          const hint = data.needsReauth ? "needs reconnecting" : "not configured";
          return { content: [{ type: "text", text: `Google Calendar ${hint} (set it up in /setup).` }], isError: true };
        }
        const selected = new Set(data.selectedIds ?? []);
        const lines = (data.calendars ?? []).map(
          (c) => `- ${selected.has(c.id) ? "[x]" : "[ ]"} ${c.summary ?? c.id} (${c.id})`,
        );
        return { content: [{ type: "text", text: `Calendars:\n${lines.join("\n")}` }] };
      }) },
    (result) => result as DashboardToolResult, undefined, { omitInputSchema: true });
}
