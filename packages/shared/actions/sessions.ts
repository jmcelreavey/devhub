import { z } from "zod";
import { defineAction } from "./define.ts";

export const sessionRecapInput = z.object({
  sessionId: z.string().optional().describe("OpenCode session id; omit to select the current busy or latest root"),
  includeChildren: z.boolean().optional().describe("Include descendant sessions (default false)"),
  directory: z.string().optional().describe("Workspace directory used to scope OpenCode sessions"),
}).meta({ additionalProperties: false });

export interface SessionRecapResponse {
  status: number;
  body: unknown;
}

export interface SessionRecapContext {
  recap: (input: z.output<typeof sessionRecapInput>) => Promise<SessionRecapResponse>;
}

export const sessionRecap = defineAction<typeof sessionRecapInput, SessionRecapContext, SessionRecapResponse>({
  input: sessionRecapInput,
  http: { method: "GET", path: "/api/opencode/recap" },
  mcp: {
    name: "sessions_recap",
    toolset: "sessions",
    description: "Return an OpenCode session recap containing only sessions, commands, MCP calls, file changes, failures, and mutations. Uses an explicit session id, otherwise the current busy root, otherwise the latest root.",
  },
  handler: (input, context) => context.recap(input),
});
