import { z } from "zod";
import { defineAction } from "./define.ts";

interface RecoveryContext<Input> { execute: (input: Input) => unknown }

// Restore keeps its existing header validation and streamed upload handling.

export const recoveryReadInput = z.object({ download: z.string().nullable() });
export const recoveryRead = defineAction<typeof recoveryReadInput, RecoveryContext<z.output<typeof recoveryReadInput>>, unknown>({
  input: recoveryReadInput,
  http: { method: "GET", path: "/api/recovery" },
  mcp: { reason: "The authenticated dashboard inventories local data or downloads a temporary encrypted backup." },
  handler: (input, context) => context.execute(input),
});

export const recoveryCreateInput = z.object({ passphrase: z.string().min(12).max(1024) }).strict();
export const recoveryCreate = defineAction<typeof recoveryCreateInput, RecoveryContext<z.output<typeof recoveryCreateInput>>, unknown>({
  input: recoveryCreateInput,
  http: { method: "POST", path: "/api/recovery" },
  mcp: { reason: "Creating an encrypted backup and issuing its temporary download belongs to the authenticated recovery workflow." },
  handler: (input, context) => context.execute(input),
});

export const recoveryRestoreInput = z.object({ options: z.unknown(), bundle: z.unknown() });
export const recoveryRestore = defineAction<typeof recoveryRestoreInput, RecoveryContext<z.output<typeof recoveryRestoreInput>>, unknown>({
  input: recoveryRestoreInput,
  http: { method: "POST", path: "/api/recovery/restore" },
  mcp: { reason: "Restoring an uploaded backup writes local files and requires the authenticated recovery workflow." },
  handler: (input, context) => context.execute(input),
});

export const rebuildStatusInput = z.object({});
export const rebuildStatus = defineAction<typeof rebuildStatusInput, RecoveryContext<z.output<typeof rebuildStatusInput>>, unknown>({
  input: rebuildStatusInput,
  http: { method: "GET", path: "/api/rebuild" },
  mcp: { reason: "The dashboard polls local checkout rebuild availability and progress." },
  handler: (input, context) => context.execute(input),
});

export const rebuildStartInput = z.object({ pull: z.boolean().optional() }).strict();
export const rebuildStart = defineAction<typeof rebuildStartInput, RecoveryContext<z.output<typeof rebuildStartInput>>, unknown>({
  input: rebuildStartInput,
  http: { method: "POST", path: "/api/rebuild" },
  mcp: { reason: "Pulling or rebuilding the running checkout is an explicit local dashboard operation." },
  handler: (input, context) => context.execute(input),
});
