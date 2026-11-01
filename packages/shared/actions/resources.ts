import { z } from "zod";
import { defineAction } from "./define.ts";

interface ResourceContext<Input> { execute: (input: Input) => unknown }

export const resourceNotesInput = z.object({ uri: z.string() });
export const resourceNotes = defineAction<typeof resourceNotesInput, ResourceContext<z.output<typeof resourceNotesInput>>, unknown>({
  input: resourceNotesInput,
  http: { reason: "devhub://notes/{+path} is an MCP resource; the existing content tools and HTTP routes keep their own contracts." },
  mcp: { reason: "MCP resources/read protocol operation, not a tool. Preserve resource caching, listings and update notifications." },
  handler: (input, context) => context.execute(input),
});

export const resourceNotesListInput = z.object({});
export const resourceNotesList = defineAction<typeof resourceNotesListInput, ResourceContext<z.output<typeof resourceNotesListInput>>, unknown>({
  input: resourceNotesListInput,
  http: { reason: "devhub://notes/{+path} is an MCP resource; the existing content tools and HTTP routes keep their own contracts." },
  mcp: { reason: "MCP resources/list protocol operation, not a tool. Preserve resource caching, listings and update notifications." },
  handler: (input, context) => context.execute(input),
});

export const resourceDocsInput = z.object({ uri: z.string() });
export const resourceDocs = defineAction<typeof resourceDocsInput, ResourceContext<z.output<typeof resourceDocsInput>>, unknown>({
  input: resourceDocsInput,
  http: { reason: "devhub://docs/{+path} is an MCP resource; the existing content tools and HTTP routes keep their own contracts." },
  mcp: { reason: "MCP resources/read protocol operation, not a tool. Preserve resource caching, listings and update notifications." },
  handler: (input, context) => context.execute(input),
});

export const resourceDocsListInput = z.object({});
export const resourceDocsList = defineAction<typeof resourceDocsListInput, ResourceContext<z.output<typeof resourceDocsListInput>>, unknown>({
  input: resourceDocsListInput,
  http: { reason: "devhub://docs/{+path} is an MCP resource; the existing content tools and HTTP routes keep their own contracts." },
  mcp: { reason: "MCP resources/list protocol operation, not a tool. Preserve resource caching, listings and update notifications." },
  handler: (input, context) => context.execute(input),
});

export const resourceAgentRunEventsInput = z.object({ uri: z.string() });
export const resourceAgentRunEvents = defineAction<typeof resourceAgentRunEventsInput, ResourceContext<z.output<typeof resourceAgentRunEventsInput>>, unknown>({
  input: resourceAgentRunEventsInput,
  http: { reason: "devhub://agent-runs/{runId}/events is an MCP resource; the existing content tools and HTTP routes keep their own contracts." },
  mcp: { reason: "MCP resources/read protocol operation, not a tool. Preserve resource caching, listings and update notifications." },
  handler: (input, context) => context.execute(input),
});

export const resourceAgentRunEventsListInput = z.object({});
export const resourceAgentRunEventsList = defineAction<typeof resourceAgentRunEventsListInput, ResourceContext<z.output<typeof resourceAgentRunEventsListInput>>, unknown>({
  input: resourceAgentRunEventsListInput,
  http: { reason: "devhub://agent-runs/{runId}/events is an MCP resource; the existing content tools and HTTP routes keep their own contracts." },
  mcp: { reason: "MCP resources/list protocol operation, not a tool. Preserve resource caching, listings and update notifications." },
  handler: (input, context) => context.execute(input),
});

export const resourceJobsInput = z.object({ uri: z.string() });
export const resourceJobs = defineAction<typeof resourceJobsInput, ResourceContext<z.output<typeof resourceJobsInput>>, unknown>({
  input: resourceJobsInput,
  http: { reason: "devhub://jobs is an MCP resource; the existing content tools and HTTP routes keep their own contracts." },
  mcp: { reason: "MCP resources/read protocol operation, not a tool. Preserve resource caching, listings and update notifications." },
  handler: (input, context) => context.execute(input),
});

export const resourceJobsLogInput = z.object({ uri: z.string() });
export const resourceJobsLog = defineAction<typeof resourceJobsLogInput, ResourceContext<z.output<typeof resourceJobsLogInput>>, unknown>({
  input: resourceJobsLogInput,
  http: { reason: "devhub://jobs/log is an MCP resource; the existing content tools and HTTP routes keep their own contracts." },
  mcp: { reason: "MCP resources/read protocol operation, not a tool. Preserve resource caching, listings and update notifications." },
  handler: (input, context) => context.execute(input),
});
