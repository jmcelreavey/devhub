import { z } from "zod";
import { defineAction } from "./define.ts";

const description = "DevHub in-app browser support was removed. This compatibility tool returns a removal notice; use agent browser or QA tooling.";
const http = { reason: "The in-app browser was removed; these compatibility notices exist only for MCP clients." };
interface BrowserContext { removed: () => { content: { type: "text"; text: string }[] } }

export const browserSessionInput = z.object({ taskId: z.string(), runId: z.string() }).meta({ additionalProperties: false });
export const browserSession = defineAction<typeof browserSessionInput, BrowserContext, ReturnType<BrowserContext["removed"]>>({
  input: browserSessionInput, http,
  mcp: { name: "browser_session", description, toolset: "work" },
  handler: (_, context) => context.removed(),
});

// Zod 3 accepted UUID-shaped identifiers without enforcing version or variant bits.
const legacyUuid = () => z.guid().meta({ format: "uuid" });
const scope = { sessionId: legacyUuid(), lease: z.string().min(43).max(43) };
export const browserObserveInput = z.object(scope).meta({ additionalProperties: false });
export const browserObserve = defineAction<typeof browserObserveInput, BrowserContext, ReturnType<BrowserContext["removed"]>>({
  input: browserObserveInput, http,
  mcp: { name: "browser_observe", description, toolset: "work" },
  handler: (_, context) => context.removed(),
});

export const browserRequestInput = z.object({ ...scope, action: z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("navigate"), url: z.string().url().max(2000) }).meta({ additionalProperties: false }),
  z.object({ kind: z.literal("click"), target: legacyUuid(), observation: legacyUuid() }).meta({ additionalProperties: false }),
  z.object({ kind: z.literal("type"), target: legacyUuid(), observation: legacyUuid(), text: z.string().min(1).max(2000) }).meta({ additionalProperties: false }),
]) }).meta({ additionalProperties: false });
export const browserRequest = defineAction<typeof browserRequestInput, BrowserContext, ReturnType<BrowserContext["removed"]>>({
  input: browserRequestInput, http,
  mcp: { name: "browser_request", description, toolset: "work" },
  handler: (_, context) => context.removed(),
});
