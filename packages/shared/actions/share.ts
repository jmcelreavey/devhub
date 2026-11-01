import { z } from "zod";
import { defineAction } from "./define.ts";

const vaultParam = z
  .enum(["notes", "docs"])
  .default("notes")
  .describe("Which vault the path belongs to");

const pathParam = z
  .string()
  .min(1)
  .describe("Vault-relative path without extension (e.g. 'learnings/tools', 'daily/2026-08-05', 'diagrams/Acme/flow')");

interface ShareContext<Input> { execute: (input: Input) => unknown }

export const shareListInput = z.object({});
export const shareList = defineAction<typeof shareListInput, ShareContext<z.output<typeof shareListInput>>, unknown>({
  input: shareListInput,
  http: {"reason":"MCP composes live and one-time registries; HTTP keeps separate list routes."},
  mcp: { name: "share_list", toolset: "share", description: "List everything currently shared: live gist links (updatable, 14-day) and unread one-time links (burn-after-reading). Requires the dashboard running." },
  handler: (input, context) => context.execute(input),
});

export const sharePublishInput = z.object({ vault: vaultParam, path: pathParam }).meta({ additionalProperties: false });
export const sharePublish = defineAction<typeof sharePublishInput, ShareContext<z.output<typeof sharePublishInput>>, unknown>({
  input: sharePublishInput,
  http: {"method":"POST","path":"/api/share"},
  mcp: { name: "share_publish", toolset: "share", description: "Publish a note, doc, or diagram (notes vault path under diagrams/) as a secret GitHub Gist — a stable, updatable link. Re-running on an already-shared path pushes the current content to the same URL. Use share_one_time instead when the content should self-destruct after one read. Requires `gh` authenticated." },
  handler: (input, context) => context.execute(input),
});

export const shareRecoverInput = z.object({ vault: vaultParam, path: pathParam }).meta({ additionalProperties: false });
export const shareRecover = defineAction<typeof shareRecoverInput, ShareContext<z.output<typeof shareRecoverInput>>, unknown>({
  input: shareRecoverInput,
  http: {"method":"POST","path":"/api/share/recover"},
  mcp: { name: "share_recover", toolset: "share", description: "Restore a deleted note/doc/diagram from its still-live gist. Writes the gist content back to the original vault path and keeps the existing URL. Fails if a different file already occupies that path, or if the gist is gone. Does not create a new gist." },
  handler: (input, context) => context.execute(input),
});

export const shareOneTimeInput = z.object({
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
      }).meta({ additionalProperties: false });
export const shareOneTime = defineAction<typeof shareOneTimeInput, ShareContext<z.output<typeof shareOneTimeInput>>, unknown>({
  input: shareOneTimeInput,
  http: {"method":"POST","path":"/api/share/one-time", discriminator: "body has no markdown" },
  mcp: { name: "share_one_time", toolset: "share", description: "Publish a note, doc, or diagram (notes vault path under diagrams/) as a one-time link: encrypted client-side, destroyed by the server the first time it is opened. Returns the link and, by default, a generated password. NOTE: both come back in this same tool result, so treat the whole result as sensitive — pass the link and password to the recipient over two different channels, never in one message." },
  handler: (input, context) => context.execute(input),
});

export const shareRevokeInput = z.object({
        id: z.string().optional().describe("One-time link id, from share_list or share_one_time"),
        vault: z.enum(["notes", "docs"]).optional().describe("For live gist links"),
        path: z.string().optional().describe("For live gist links"),
      }).meta({ additionalProperties: false });
export const shareRevoke = defineAction<typeof shareRevokeInput, ShareContext<z.output<typeof shareRevokeInput>>, unknown>({
  input: shareRevokeInput,
  http: {"reason":"MCP selects a live or one-time revoke operation. Browser bulk-clear operations remain local."},
  mcp: { name: "share_revoke", toolset: "share", description: "Unshare something. Give `id` to revoke a one-time link (only works while it is still unread), or `vault`+`path` to delete a live gist link." },
  handler: (input, context) => context.execute(input),
});

function localShare<Schema extends z.ZodObject>(input: Schema, method: "GET" | "POST" | "DELETE", path: string, reason: string, discriminator?: string) {
  return defineAction<Schema, ShareContext<z.output<Schema>>, unknown>({ input, http: { method, path, discriminator }, mcp: { reason }, handler: (value, context) => context.execute(value) });
}
export const shareLiveListInput = z.object({});
export const shareLiveList = localShare(shareLiveListInput, "GET", "/api/share", "share_list composes this live registry with the one-time registry.");
export const shareOneTimeListInput = z.object({});
export const shareOneTimeList = localShare(shareOneTimeListInput, "GET", "/api/share/one-time", "share_list composes this one-time registry with the live registry.");
export const shareLiveRevokeInput = sharePublishInput;
export const shareLiveRevoke = localShare(shareLiveRevokeInput, "DELETE", "/api/share", "Selected by share_revoke when vault and path are supplied.", "query all is not 1");
export const shareOneTimeRevokeInput = z.object({ id: z.string().min(1) });
export const shareOneTimeRevoke = localShare(shareOneTimeRevokeInput, "DELETE", "/api/share/one-time", "Selected by share_revoke when an id is supplied.", "query all is not 1");
export const shareClearLiveInput = z.object({});
export const shareClearLive = localShare(shareClearLiveInput, "DELETE", "/api/share", "Bulk clearing every live share is an explicit dashboard operation, not exposed by share_revoke.", "query all=1");
export const shareClearOneTimeInput = z.object({});
export const shareClearOneTime = localShare(shareClearOneTimeInput, "DELETE", "/api/share/one-time", "Bulk clearing every one-time share is an explicit dashboard operation, not exposed by share_revoke.", "query all=1");
export const shareMarkdownInput = z.object({
  markdown: z.string().min(1).max(1_000_000), title: z.string().min(1).max(200),
  password: shareOneTimeInput.shape.password, expire: shareOneTimeInput.shape.expire,
});
export const shareMarkdown = localShare(shareMarkdownInput, "POST", "/api/share/one-time", "The History browser shares raw patches without creating notes. MCP shares existing vault paths only.", "body has markdown");
