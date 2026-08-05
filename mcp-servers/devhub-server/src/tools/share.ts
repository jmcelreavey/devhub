import { z } from "zod";
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

const vaultParam = z
  .enum(["notes", "docs"])
  .default("notes")
  .describe("Which vault the path belongs to");

const pathParam = z
  .string()
  .min(1)
  .describe("Vault-relative path without extension (e.g. 'learnings/tools', 'daily/2026-08-05')");

function relative(ms: number): string {
  const diff = ms - Date.now();
  if (diff <= 0) return "expired";
  const hours = Math.round(diff / 3_600_000);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export function registerShareTools(server: McpServer, ctx: Context): void {
  const { dashboard } = ctx;

  server.registerTool(
    "share_list",
    {
      description:
        "List everything currently shared: live gist links (updatable, 14-day) and unread one-time links (burn-after-reading). Requires the dashboard running.",
    },
    async () =>
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
            const flag = s.missing ? " **source deleted**" : s.stale ? " **stale**" : "";
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
      }),
  );

  server.registerTool(
    "share_publish",
    {
      description:
        "Publish a note or doc as a secret GitHub Gist — a stable, updatable link. Re-running on an already-shared note pushes the current content to the same URL. Use share_one_time instead when the content should self-destruct after one read. Requires `gh` authenticated.",
      inputSchema: { vault: vaultParam, path: pathParam },
    },
    async ({ vault, path }) =>
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
      }),
  );

  server.registerTool(
    "share_one_time",
    {
      description:
        "Publish a note or doc as a one-time link: encrypted client-side, destroyed by the server the first time it is opened. Returns the link and, by default, a generated password. NOTE: both come back in this same tool result, so treat the whole result as sensitive — pass the link and password to the recipient over two different channels, never in one message.",
      inputSchema: {
        vault: vaultParam,
        path: pathParam,
        password: z
          .boolean()
          .default(true)
          .describe("Protect with a generated six-word passphrase (recommended)"),
        expire: z
          .enum(["5min", "10min", "1hour", "1day", "1week", "1month"])
          .default("1day")
          .describe("Backstop expiry — the link normally dies on first read"),
      },
    },
    async ({ vault, path, password, expire }) =>
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
      }),
  );

  server.registerTool(
    "share_revoke",
    {
      description:
        "Unshare something. Give `id` to revoke a one-time link (only works while it is still unread), or `vault`+`path` to delete a live gist link.",
      inputSchema: {
        id: z.string().optional().describe("One-time link id, from share_list or share_one_time"),
        vault: z.enum(["notes", "docs"]).optional().describe("For live gist links"),
        path: z.string().optional().describe("For live gist links"),
      },
    },
    async ({ id, vault, path }) =>
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
      }),
  );
}
