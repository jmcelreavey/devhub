import { shareList, sharePublish, shareRecover, shareOneTime, shareRevoke } from "../../../../packages/shared/actions/share.ts";
import { registerAction } from "../actions/register.ts";
import type { DashboardToolResult } from "../dashboard-client.ts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Context } from "../context.ts";
import { withDashboardErrors } from "../dashboard-client.ts";

/**
 * Sharing tools — parity with the editor's Share / One-time buttons.
 *
 * These proxy the dashboard rather than talking to GitHub or PrivateBin
 * directly, so the share registry stays owned by one process. A one-time link
 * created here shows up on `/shared` and can be revoked from either side.
 */

interface ShareStatus {
  key: string;
  vault: string;
  path: string;
  title: string;
  url: string;
  createdAt: number;
  stale: boolean;
  missing: boolean;
}

interface OneTimeRecord {
  id: string;
  vault: string;
  path: string;
  title: string;
  url: string;
  hasPassword: boolean;
  expire: string;
  createdAt: number;
  expiresAt: number;
}

function relative(ms: number): string {
  const diff = ms - Date.now();
  if (diff <= 0) return "expired";
  const hours = Math.round(diff / 3_600_000);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export function registerShareTools(server: McpServer, ctx: Context): void {
  const { dashboard } = ctx;

  registerAction(server, shareList, { execute: async () =>
      withDashboardErrors(async () => {
        const [live, oneTime] = await Promise.all([
          dashboard.get<{ shares: ShareStatus[] }>("/api/share"),
          dashboard.get<{ shares: OneTimeRecord[] }>("/api/share/one-time"),
        ]);

        const lines: string[] = [];

        lines.push(`## Live links (${live.shares.length})`);
        if (live.shares.length === 0) {
          lines.push("_none_");
        } else {
          for (const s of live.shares) {
            const flag = s.missing
              ? " **source deleted** — share_recover to restore from the gist"
              : s.stale
                ? " **stale**"
                : "";
            lines.push(`- ${s.title} (${s.vault}:${s.path})${flag}\n  ${s.url}`);
          }
        }

        lines.push("", `## One-time links (${oneTime.shares.length})`);
        if (oneTime.shares.length === 0) {
          lines.push("_none_");
        } else {
          lines.push(
            "_Unread as far as DevHub knows — the server destroys these on read and reports to nobody._",
          );
          for (const r of oneTime.shares) {
            const lock = r.hasPassword ? "password" : "link only";
            lines.push(`- ${r.title} (${r.vault}:${r.path}) — ${lock}, expires in ${relative(r.expiresAt)}\n  id: ${r.id}`);
          }
        }

        return { content: [{ type: "text", text: lines.join("\n") }] };
      }) },
    (result) => result as DashboardToolResult, undefined, { omitInputSchema: true });

  registerAction(server, sharePublish, { execute: async ({ vault, path }) =>
      withDashboardErrors(async () => {
        const body = await dashboard.post<{ share: ShareStatus }>("/api/share", { vault, path });
        return {
          content: [
            {
              type: "text",
              text: `Live: ${body.share.title}\n${body.share.url}\n\nAnyone with this link can read it. Expires 14 days after first publish.`,
            },
          ],
        };
      }) },
    (result) => result as DashboardToolResult);

  registerAction(server, shareRecover, { execute: async ({ vault, path }) =>
      withDashboardErrors(async () => {
        const body = await dashboard.post<{ share: ShareStatus }>("/api/share/recover", { vault, path });
        return {
          content: [
            {
              type: "text",
              text: `Restored ${body.share.vault}:${body.share.path} from the live gist.\n${body.share.url}`,
            },
          ],
        };
      }) },
    (result) => result as DashboardToolResult);

  registerAction(server, shareOneTime, { execute: async ({ vault, path, password, expire }) =>
      withDashboardErrors(async () => {
        const body = await dashboard.post<{ share: OneTimeRecord; passphrase: string }>(
          "/api/share/one-time",
          { vault, path, password, expire },
          60_000,
        );

        const lines = [
          `One-time link for ${body.share.title}:`,
          body.share.url,
        ];
        if (body.passphrase) {
          lines.push("", `Password: ${body.passphrase}`);
          lines.push(
            "",
            "Send these separately — the password is only a second factor if it travels a different route than the link. It is not stored anywhere; if it is lost, revoke and re-share.",
          );
        }
        lines.push(
          "",
          `Destroyed on first open, or after ${expire} if nobody opens it. Revoke with share_revoke id="${body.share.id}".`,
        );

        return { content: [{ type: "text", text: lines.join("\n") }] };
      }) },
    (result) => result as DashboardToolResult);

  registerAction(server, shareRevoke, { execute: async ({ id, vault, path }) =>
      withDashboardErrors(async () => {
        if (id) {
          await dashboard.delete("/api/share/one-time", { id });
          return { content: [{ type: "text", text: `Revoked one-time link ${id}.` }] };
        }
        if (vault && path) {
          await dashboard.delete("/api/share", { vault, path });
          return { content: [{ type: "text", text: `Removed live link for ${vault}:${path}.` }] };
        }
        return {
          content: [
            { type: "text", text: "Give either `id` (one-time link) or both `vault` and `path` (live link)." },
          ],
          isError: true,
        };
      }) },
    (result) => result as DashboardToolResult);
}
