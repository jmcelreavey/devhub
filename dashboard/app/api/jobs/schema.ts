import { z } from "zod";

export const AgentJobSchema = z.object({
  provider: z.string().trim().min(1).max(32),
  prompt: z.string().trim().min(1, "prompt is required").max(32_000, "prompt too long"),
  cwd: z.string().trim().min(1, "cwd is required").max(1_000),
  model: z.string().trim().max(120).optional(),
  effort: z.string().trim().max(32).regex(/^([A-Za-z0-9][A-Za-z0-9_-]{0,31})?$/).optional(),
  worktree: z.boolean().optional(),
  maxTurns: z.number().int().min(1).max(500).optional(),
});

/** MCP calls carry confirm:true as execution intent; no additional human prompt is needed. */
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
