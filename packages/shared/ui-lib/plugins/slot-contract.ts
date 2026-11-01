import { z } from "zod";
import { runtimeSlotSchema } from "./runtime-contract.ts";

const profile = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,31}$/);
export const slotContextSchema = z.discriminatedUnion("location", [
  z.object({ location: z.literal("setup") }).strict(),
  z.object({ location: z.literal("repo"), repoName: z.string().min(1).max(200).refine((s) => !/[\\/]/.test(s) && !s.includes("..")) }).strict(),
  z.object({ location: z.literal("task"), taskId: z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/), createdAt: z.string().min(1).max(128), profile }).strict(),
]);
export type SlotContext = z.infer<typeof slotContextSchema>;
export const slotActionSchema = z.object({ path: z.string().max(240), method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]), body: z.unknown().optional() }).strict();
export type SlotAction = z.infer<typeof slotActionSchema>;
export const slotRequestSchema = z.object({
  plugin: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/), slot: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/),
  context: slotContextSchema, action: slotActionSchema.optional(), confirmed: z.boolean().optional(),
  revision: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export const slotEntrySchema = runtimeSlotSchema.safeExtend({ plugin: z.string(), revision: z.string() });
export const slotCatalogSchema = z.object({ slots: z.array(slotEntrySchema).max(200) }).strict();
export type SlotEntry = z.infer<typeof slotEntrySchema>;
