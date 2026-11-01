import { z } from "zod";

export const localOperationRequest = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/),
  cli: z.string().min(1).max(4096),
  args: z.array(z.string().max(8192)).max(256),
  options: z.object({
    cwd: z.string().max(4096).optional(),
    env: z.record(z.string().min(1).max(4096).regex(/^[^=\0]+$/), z.string().max(65_536).regex(/^[^\0]*$/).optional()).optional(),
    timeoutMs: z.number().int().min(1).max(120_000).default(30_000),
    maxBuffer: z.number().int().min(1).max(65_536).default(65_536),
  }).strict(),
}).strict();

export const localOperationResponse = z.object({
  id: z.string().uuid(),
  result: z.object({ stdout: z.string(), stderr: z.string() }).strict().optional(),
  error: z.string().max(200).optional(),
}).strict().refine((value) => (value.result === undefined) !== (value.error === undefined));
