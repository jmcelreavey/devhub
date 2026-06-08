import { z } from "zod";

export const TaskCreateSchema = z.object({
  text: z.string().min(1, "text is required").max(500),
  due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "due must be YYYY-MM-DD").optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD").optional(),
});

export const TaskPatchSchema = z
  .object({
    id: z.string().min(1, "id is required"),
    text: z.string().min(1).max(500).optional(),
    done: z.boolean().optional(),
    due: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.null()]).optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    status: z.enum(["abandoned", "active"]).optional(),
    abandonReason: z.string().max(200).optional(),
    timer: z.enum(["start", "stop"]).optional(),
  })
  .refine(
    (v) =>
      v.text !== undefined ||
      v.done !== undefined ||
      v.due !== undefined ||
      v.status !== undefined ||
      v.timer !== undefined,
    { message: "Provide text, done, due, status, or timer" },
  );

export const TaskDeleteSchema = z.object({
  id: z.string().min(1, "id is required"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const TaskReorderSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const NotePutSchema = z.object({
  content: z.unknown(),
});

const EmptyableStringSchema = z.union([z.string().max(500), z.null()]);

export const MasterListCreateSchema = z.object({
  name: z.string().min(1, "name is required").max(120),
  scopePath: z.string().max(500).optional().default(""),
  icon: z.string().max(40).optional(),
});

export const MasterListPatchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  scopePath: z.string().max(500).optional(),
  icon: EmptyableStringSchema.optional(),
});

export const MasterListItemInputSchema = z.object({
  name: z.string().min(1, "name is required").max(160),
  checked: z.boolean().optional(),
  notes: z.string().max(500).optional(),
});

export const MasterListItemPatchSchema = MasterListItemInputSchema.partial().extend({
  notes: EmptyableStringSchema.optional(),
});

export const CollectionRoutePatchSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("updateCollection"),
    collection: MasterListPatchSchema,
  }),
  z.object({
    action: z.literal("addItem"),
    item: MasterListItemInputSchema,
  }),
  z.object({
    action: z.literal("updateItem"),
    itemId: z.string().min(1),
    item: MasterListItemPatchSchema,
  }),
  z.object({
    action: z.literal("deleteItem"),
    itemId: z.string().min(1),
  }),
  z.object({
    action: z.literal("reorderItems"),
    itemIds: z.array(z.string().min(1)),
  }),
  z.object({
    action: z.literal("promoteItem"),
    name: z.string().min(1).max(160),
    checked: z.boolean().optional(),
  }),
]);

export const SyncLinkedLabelsSchema = z.object({
  itemId: z.string().min(1),
  label: z.string().min(1).max(160),
  excludeNotePath: z.string().max(500).optional(),
});

/** @deprecated Use MasterListCreateSchema */
export const CollectionCreateSchema = MasterListCreateSchema;

export const NoteOrderPatchSchema = z.object({
  paths: z.array(z.string().min(1)).min(1),
});

export function formatZodError(err: z.ZodError): string {
  return err.issues
    .map((i) => `${i.path.length ? i.path.join(".") + ": " : ""}${i.message}`)
    .join("; ");
}
