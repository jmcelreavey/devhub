import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Context } from "../context.ts";
import { withDashboardErrors } from "../dashboard-client.ts";

/**
 * Open a DevHub page in front of the user.
 *
 * The generalized version of `notes_devhub_open`: instead of one tool per
 * entity, any validated internal href goes to the dashboard's navigation
 * channel (`/api/desktop/navigation`), which the running desktop app (and any
 * dashboard client subscribed to the stream) turns into a workspace tab.
 * Focus-or-open is the shell's job (openHref dedupes by href); this tool only
 * validates and forwards. When nothing is watching, the dashboard answers 409
 * and the tool says so instead of pretending the user saw the page.
 */

/** Reuse the route's own validation shape so tool and route agree by construction. */
const InternalHref = z
  .string()
  .trim()
  .min(1)
  .max(4_096)
  .refine((href) => href.startsWith("/") && !href.startsWith("//"), "Must be an internal DevHub path starting with /")
  .refine((href) => !href.startsWith("/api/"), "DevHub pages only — /api/ routes are not pages");

export function registerUiTools(server: McpServer, ctx: Context): void {
  const { dashboard } = ctx;

  server.registerTool(
    "ui_open",
    {
      description:
        "Open a DevHub page in a new workspace tab in the running DevHub app (desktop webview or browser dashboard). Accepts internal hrefs: /notes/<path>, /repos/<name>, /work, /briefing, /tasks, /skills, /search — the same paths the dashboard sidebar uses. Fails cleanly (isError) when no DevHub client is connected; ask the user to open DevHub, or keep going — nothing is lost.",
      inputSchema: {
        href: InternalHref.describe("Internal DevHub path to open, e.g. /notes/discovery/example or /work"),
        title: z.string().max(80).optional().describe("Unused today; reserved for a future tab-title override"),
      },
    },
    async ({ href }) =>
      withDashboardErrors(async () => {
        const r = await dashboard.post<{ delivered: number }>("/api/desktop/navigation", { href, newTab: true });
        if (r.delivered === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No DevHub client is connected — ${href} was not opened. Open DevHub and ask again, or continue without showing the page.`,
              },
            ],
            isError: true,
          };
        }
        return { content: [{ type: "text", text: `Opened ${href} in a new DevHub workspace tab.` }] };
      }),
  );
}
