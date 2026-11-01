import { z } from "zod";
import { defineAction } from "./define.ts";

interface PromptContext<Input> { execute: (input: Input) => unknown }

export const skillPromptInput = z.object({ task: z.string().optional().describe("What to apply the skill to") });
export const skillPrompt = defineAction<typeof skillPromptInput, PromptContext<z.output<typeof skillPromptInput>>, unknown>({
  input: skillPromptInput,
  http: { reason: "MCP prompts/get returns user-invoked workflow instructions; it is not an HTTP action." },
  mcp: { reason: "MCP prompt protocol operation, not an agent-callable tool. Keep prompt names, arguments and instructions on the prompt surface." },
  handler: (input, context) => context.execute(input),
});

export const raceVerdictPromptInput = z.object({
        runIds: z.string().describe("Comma-separated run ids, e.g. run-x1,run-x2,run-x3"),
        taskRef: z.string().optional().describe("Task or note ref to link the verdict to (e.g. task-2026-09-14)"),
      });
export const raceVerdictPrompt = defineAction<typeof raceVerdictPromptInput, PromptContext<z.output<typeof raceVerdictPromptInput>>, unknown>({
  input: raceVerdictPromptInput,
  http: { reason: "MCP prompts/get returns user-invoked workflow instructions; it is not an HTTP action." },
  mcp: { reason: "MCP prompt protocol operation, not an agent-callable tool. Keep prompt names, arguments and instructions on the prompt surface." },
  handler: (input, context) => context.execute(input),
});
