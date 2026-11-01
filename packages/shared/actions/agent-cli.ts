import { z } from "zod";
import { defineAction } from "./define.ts";

interface Context<Input> { execute: (input: Input) => unknown }

export const agentCliGetInput = z.object({});
export const agentCliGet = defineAction<typeof agentCliGetInput, Context<z.output<typeof agentCliGetInput>>, unknown>({
  input: agentCliGetInput,
  http: { method: "GET", path: "/api/agent-cli" },
  mcp: { reason: "Provider configuration and local CLI availability belong to dashboard setup." },
  handler: (input, context) => context.execute(input),
});

// Keep legacy body handling and its existing error responses in the route.
export const agentCliPutInput = z.object({ body: z.unknown() });
export const agentCliPut = defineAction<typeof agentCliPutInput, Context<z.output<typeof agentCliPutInput>>, unknown>({
  input: agentCliPutInput,
  http: { method: "PUT", path: "/api/agent-cli" },
  mcp: { reason: "Changing local provider settings is a dashboard setup action." },
  handler: (input, context) => context.execute(input),
});

export const agentUsageInput = z.object({ refresh: z.string().optional() });
export const agentUsage = defineAction<typeof agentUsageInput, Context<z.output<typeof agentUsageInput>>, unknown>({
  input: agentUsageInput,
  http: { method: "GET", path: "/api/agent-usage" },
  mcp: { reason: "Provider usage is an authenticated dashboard view of locally configured accounts." },
  handler: (input, context) => context.execute(input),
});

export const opencodeGetInput = z.object({});
export const opencodeGet = defineAction<typeof opencodeGetInput, Context<z.output<typeof opencodeGetInput>>, unknown>({
  input: opencodeGetInput,
  http: { method: "GET", path: "/api/opencode" },
  mcp: { reason: "OpenCode configuration and environment placeholder status are dashboard setup internals." },
  handler: (input, context) => context.execute(input),
});

// The route validates content and reports its existing JSON and secret errors.
export const opencodePutInput = z.object({ body: z.unknown() });
export const opencodePut = defineAction<typeof opencodePutInput, Context<z.output<typeof opencodePutInput>>, unknown>({
  input: opencodePutInput,
  http: { method: "PUT", path: "/api/opencode" },
  mcp: { reason: "Editing local OpenCode configuration is a dashboard setup action with secret checks." },
  handler: (input, context) => context.execute(input),
});
