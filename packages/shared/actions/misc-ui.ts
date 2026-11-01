import { z } from "zod";
import { defineAction } from "./define.ts";

interface Context<Input> { execute: (input: Input) => unknown }

export const notificationsReadInput = z.object({});
export const notificationsRead = defineAction<typeof notificationsReadInput, Context<z.output<typeof notificationsReadInput>>, unknown>({
  input: notificationsReadInput, http: { method: "GET", path: "/api/notifications" },
  mcp: { reason: "Notifications are a profile-scoped dashboard view." },
  handler: (input, context) => context.execute(input),
});
export const notificationsUpdateInput = z.object({ ids: z.array(z.string().min(1).max(1000)).min(1).max(500), action: z.enum(["read", "dismiss", "restore"]) }).strict();
export const notificationsUpdate = defineAction<typeof notificationsUpdateInput, Context<z.output<typeof notificationsUpdateInput>>, unknown>({
  input: notificationsUpdateInput, http: { method: "POST", path: "/api/notifications" },
  mcp: { reason: "Read and dismissal state belongs to the dashboard." },
  handler: (input, context) => context.execute(input),
});
export const notificationsPrefsInput = z.object({ ownedReposOnly: z.boolean() }).strict();
export const notificationsPrefs = defineAction<typeof notificationsPrefsInput, Context<z.output<typeof notificationsPrefsInput>>, unknown>({
  input: notificationsPrefsInput, http: { method: "PUT", path: "/api/notifications" },
  mcp: { reason: "Notification filtering is a dashboard preference." },
  handler: (input, context) => context.execute(input),
});

export const qaReadInput = z.object({ scope: z.string().nullable() });
export const qaRead = defineAction<typeof qaReadInput, Context<z.output<typeof qaReadInput>>, unknown>({
  input: qaReadInput,
  http: { method: "GET", path: "/api/qa" },
  mcp: { reason: "QA settings, scenarios and model availability are an authenticated dashboard view." },
  handler: (input, context) => context.execute(input),
});

export const qaMediaInput = z.object({ id: z.string(), file: z.string(), range: z.string().nullable() });
export const qaMedia = defineAction<typeof qaMediaInput, Context<z.output<typeof qaMediaInput>>, unknown>({
  input: qaMediaInput,
  http: { method: "GET", path: "/api/qa/runs/[id]/media/[file]" },
  mcp: { reason: "Authenticated, range-aware media streaming is a dashboard browser transport." },
  handler: (input, context) => context.execute(input),
});

export const launchCursorInput = z.object({});
export const launchCursor = defineAction<typeof launchCursorInput, Context<z.output<typeof launchCursorInput>>, unknown>({
  input: launchCursorInput,
  http: { method: "POST", path: "/api/actions/launch-cursor" },
  mcp: { reason: "Launching the local desktop application is a user-initiated dashboard action." },
  handler: (input, context) => context.execute(input),
});

export const avatarInput = z.object({ email: z.string() });
export const avatar = defineAction<typeof avatarInput, Context<z.output<typeof avatarInput>>, unknown>({
  input: avatarInput,
  http: { method: "GET", path: "/api/people/avatar" },
  mcp: { reason: "Avatar URL resolution is a dashboard presentation fallback for person chips." },
  handler: (input, context) => context.execute(input),
});


export const sidebarCountsInput = z.object({ scope: z.string().nullable() });
export const sidebarCounts = defineAction<typeof sidebarCountsInput, Context<z.output<typeof sidebarCountsInput>>, unknown>({
  input: sidebarCountsInput,
  http: { method: "GET", path: "/api/sidebar/counts" },
  mcp: { reason: "Sidebar badges and their local/external refresh scopes are dashboard presentation state." },
  handler: (input, context) => context.execute(input),
});

export const syncHealthInput = z.object({});
export const syncHealth = defineAction<typeof syncHealthInput, Context<z.output<typeof syncHealthInput>>, unknown>({
  input: syncHealthInput,
  http: { method: "GET", path: "/api/sync-health" },
  mcp: { reason: "Sync health is a dashboard view of local materialised configuration." },
  handler: (input, context) => context.execute(input),
});

export const syncPreviewInput = z.object({ kind: z.string().nullable(), prune: z.boolean(), exclude: z.array(z.string()) });
export const syncPreview = defineAction<typeof syncPreviewInput, Context<z.output<typeof syncPreviewInput>>, unknown>({
  input: syncPreviewInput,
  http: { method: "GET", path: "/api/sync-preview" },
  mcp: { reason: "The local sync preview supports dashboard confirmation and has no equivalent MCP action." },
  handler: (input, context) => context.execute(input),
});
