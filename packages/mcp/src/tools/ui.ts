import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { desktopNavigation, uiOpen } from "../../../../packages/shared/actions/ui.ts";
import { registerAction } from "../actions/register.ts";
import type { Context } from "../context.ts";
import { requestAction, withDashboardErrors, type DashboardToolResult } from "../dashboard-client.ts";

export function registerUiTools(server: McpServer, ctx: Context): void {
  const { dashboard } = ctx;

  registerAction(server, uiOpen, {
    open: async (href) => ({ ...await requestAction<{ delivered: number; suppressed?: boolean }>(dashboard, desktopNavigation.http, { body: { href, newTab: true } }), href }),
  }, (r) => {
        const href = r.href;
        if (r.suppressed) return { content: [{ type: "text", text: `Ready: ${href}. Share this link with the user; agent work does not change their screen.` }] };
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
  }, (operation) => withDashboardErrors(async () => await operation() as DashboardToolResult));
}
