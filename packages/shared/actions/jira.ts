import { z } from "zod";
import { defineAction } from "./define.ts";

interface JiraDashboardContext<Input> {
  execute: (input: Input) => Promise<Response>;
}

export const jiraDraftInput = z.object({
  taskId: z.string().trim().min(1).max(200),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export const jiraDraft = defineAction<typeof jiraDraftInput, JiraDashboardContext<z.output<typeof jiraDraftInput>>, Response>({
  input: jiraDraftInput,
  http: { method: "POST", path: "/api/jira/draft" },
  mcp: { reason: "Draft generation is a dashboard workflow with optional streamed progress and cancellation." },
  handler: (input, context) => context.execute(input),
});

export const jiraMetaInput = z.object({ project: z.string().nullable(), reference: z.string().nullable() });
export const jiraMeta = defineAction<typeof jiraMetaInput, JiraDashboardContext<z.output<typeof jiraMetaInput>>, Response>({
  input: jiraMetaInput,
  http: { method: "GET", path: "/api/jira/meta" },
  mcp: { reason: "This metadata is specific to the dashboard's Add to Jira form." },
  handler: (input, context) => context.execute(input),
});

export const jiraTicketRedirectInput = z.object({ key: z.string() });
export const jiraTicketRedirect = defineAction<typeof jiraTicketRedirectInput, JiraDashboardContext<z.output<typeof jiraTicketRedirectInput>>, Response>({
  input: jiraTicketRedirectInput,
  http: { method: "GET", path: "/api/jira/ticket/[key]/redirect" },
  mcp: { reason: "This endpoint redirects a browser to the configured Jira site." },
  handler: (input, context) => context.execute(input),
});
