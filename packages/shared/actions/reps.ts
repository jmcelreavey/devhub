import { z } from "zod";
import { defineAction } from "./define.ts";

interface Context<Input> { execute: (input: Input) => unknown }
const mcp = { reason: "Daily reps are an interactive dashboard practice flow; no MCP operation exposes this workflow." };

export const repsGetInput = z.object({});
export const repsGet = defineAction<typeof repsGetInput, Context<z.output<typeof repsGetInput>>, unknown>({
  input: repsGetInput,
  http: { method: "GET", path: "/api/reps" }, mcp,
  handler: (input, context) => context.execute(input),
});

export const repsUpdateInput = z.object({ body: z.discriminatedUnion("action", [
  z.object({ action: z.literal("start") }),
  z.object({ action: z.literal("swap") }),
  z.object({ action: z.literal("save"), response: z.string().trim().min(1).max(20_000) }),
]) });
export const repsUpdate = defineAction<typeof repsUpdateInput, Context<z.output<typeof repsUpdateInput>>, unknown>({
  input: repsUpdateInput,
  http: { method: "POST", path: "/api/reps" }, mcp,
  handler: (input, context) => context.execute(input),
});

export const repsDiffInput = z.object({});
export const repsDiff = defineAction<typeof repsDiffInput, Context<z.output<typeof repsDiffInput>>, unknown>({
  input: repsDiffInput,
  http: { method: "GET", path: "/api/reps/diff" }, mcp,
  handler: (input, context) => context.execute(input),
});
