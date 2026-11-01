import { z } from "zod";
import { defineAction } from "./define.ts";

interface Context<Input> { execute: (input: Input) => unknown }
const mcp = { reason: "Project groups are dashboard organisation preferences and have no matching MCP tool." };

export const projectsListInput = z.object({});
export const projectsList = defineAction<typeof projectsListInput, Context<z.output<typeof projectsListInput>>, unknown>({
  input: projectsListInput,
  http: { method: "GET", path: "/api/projects" }, mcp,
  handler: (input, context) => context.execute(input),
});

export const projectsCreateInput = z.object({ label: z.string().trim().min(1), repos: z.array(z.string()).default([]) });
export const projectsCreate = defineAction<typeof projectsCreateInput, Context<z.output<typeof projectsCreateInput>>, unknown>({
  input: projectsCreateInput,
  http: { method: "POST", path: "/api/projects" }, mcp,
  handler: (input, context) => context.execute(input),
});

export const projectsDeleteInput = z.object({ id: z.string() });
export const projectsDelete = defineAction<typeof projectsDeleteInput, Context<z.output<typeof projectsDeleteInput>>, unknown>({
  input: projectsDeleteInput,
  http: { method: "DELETE", path: "/api/projects" }, mcp,
  handler: (input, context) => context.execute(input),
});
