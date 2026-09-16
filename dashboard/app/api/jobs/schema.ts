import { z } from "zod";

export const AgentJobSchema = z.object({
  provider: z.string().trim().min(1).max(32),
  prompt: z.string().trim().min(1, "prompt is required").max(32_000, "prompt too long"),
  cwd: z.string().trim().min(1, "cwd is required").max(1_000),
  model: z.string().trim().max(120).optional(),
  worktree: z.boolean().optional(),
  maxTurns: z.number().int().min(1).max(500).optional(),
});

/**
 * Who is asking. The Actions page sends "ui"; the MCP server sends "mcp" and
 * sets `confirmed` only after its user accepted an in-band prompt. Like the
 * terminal proposal flags this is not a boundary against local processes that
 * can already call the API — it keeps a model that can only reach MCP tools
 * from approving its own recurring agent run.
 */
const SourceSchema = z.enum(["ui", "mcp", "api"]).default("api");

export const JobCreateSchema = z
  .object({
    name: z.string().trim().min(1, "name is required").max(120),
    cron: z.string().trim().min(1, "cron is required").max(120),
    enabled: z.boolean().optional(),
    wake: z.boolean().optional(),
    script: z.string().trim().min(1).optional(),
    agent: AgentJobSchema.optional(),
    source: SourceSchema,
    confirmed: z.boolean().optional(),
  })
  .refine((b) => Boolean(b.script) !== Boolean(b.agent), {
    message: "Provide exactly one of script or agent",
    path: ["script"],
  });

export const JobUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  cron: z.string().trim().min(1).max(120).optional(),
  enabled: z.boolean().optional(),
  wake: z.boolean().optional(),
  script: z.string().trim().min(1).optional(),
  agent: AgentJobSchema.optional(),
  approve: z.boolean().optional(),
  source: SourceSchema,
  confirmed: z.boolean().optional(),
});

export function jobApproved(source: "ui" | "mcp" | "api", confirmed?: boolean): boolean {
  return source === "ui" || confirmed === true;
}
