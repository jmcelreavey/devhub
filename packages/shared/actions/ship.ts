import { z } from "zod";
import { defineAction } from "./define.ts";

interface ShipContext<Input> { execute: (input: Input) => unknown }

export const repoShipInput = z.object({
        message: z.string().optional().describe("Feature commit message (default 'chore: ship local work')"),
        dryRun: z.boolean().optional().describe("Preview the actual public patch without committing or pushing"),
        confirm: z.boolean().optional().describe("Required (true) to commit or push; omitted/false previews safely"),
        includeUpstream: z
          .boolean()
          .optional()
          .describe("Also push the public core (default true); false = private + plugins only"),
      }).meta({ additionalProperties: false });
export const repoShip = defineAction<typeof repoShipInput, ShipContext<z.output<typeof repoShipInput> & { preview: boolean }>, unknown>({
  input: repoShipInput,
  http: {"reason":"Host-local detached shipping script behind the Git queues. Preview is the default; mutation requires explicit confirmation. No HTTP route is added."},
  mcp: { name: "repo_ship", toolset: "ship", description: "Preview shipping by default. With confirm=true, commit local work, reconcile newer public-core changes, push the private mirror, port the leak-scanned generic catalog patch to public main, and push enabled plugins. Runs detached — poll repo_ship_status." },
  handler: (input, context) => context.execute({ ...input, preview: input.dryRun === true || input.confirm !== true }),
});

export const repoShipStatusInput = z.object({
        lines: z.number().int().min(1).max(200).optional().describe("Log lines to return (default 25)"),
      }).meta({ additionalProperties: false });
export const repoShipStatus = defineAction<typeof repoShipStatusInput, ShipContext<z.output<typeof repoShipStatusInput>>, unknown>({
  input: repoShipStatusInput,
  http: {"reason":"Host-local shipping log and process status. No HTTP route is added."},
  mcp: { name: "repo_ship_status", toolset: "ship", description: "Status of the current/last repo_ship run: running/done/failed plus the tail of its log." },
  handler: (input, context) => context.execute(input),
});
