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

const JIRA_KEY_PATTERN = /^[A-Z][A-Z0-9]+-\d+$/;

export const JiraCreateIssueSchema = z.object({
  projectKey: z.string().regex(/^[A-Z][A-Z0-9]+$/, "projectKey must be a Jira project key"),
  summary: z.string().min(1, "summary is required").max(255),
  description: z.string().min(1, "description is required").max(5000),
  parentKey: z.union([z.string().regex(JIRA_KEY_PATTERN), z.null()]).optional(),
  issuetypeName: z.string().min(1).max(60).optional(),
  assignToMe: z.boolean().optional(),
  sprintId: z.union([z.number().int().positive(), z.null()]).optional(),
});

export const JiraTransitionSchema = z.object({
  transitionId: z.string().min(1, "transitionId is required"),
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

// ─── Briefing ───

const ChatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(20_000),
});

export const CanvasThemeSchema = z.object({
  mode: z.enum(["dark", "light"]),
  bg: z.string(),
  surface: z.string(),
  elevated: z.string(),
  text: z.string(),
  muted: z.string(),
  subtle: z.string(),
  border: z.string(),
  accent: z.string(),
  accentFg: z.string(),
});

/**
 * `theme` stays loose on purpose: the route runs it through `normalizeTheme`,
 * which is the real authority on partial/legacy shapes. Validating it strictly
 * here would reject payloads the app itself still sends.
 */
export const BriefingDesignSchema = z.object({
  message: z.string().min(1, "message is required").max(10_000),
  history: z.array(ChatMessageSchema).max(100).optional(),
  theme: z.unknown().optional(),
});

export const BriefingShareSchema = z.object({
  theme: z.unknown().optional(),
});

export const BriefingTaskCreateSchema = z.object({
  topic: z.string().min(3, "A topic of at least 3 characters is required").max(300),
});

// ─── Repos ───

/**
 * `owner/repo` as GitHub itself allows: alphanumerics, dot, dash, underscore.
 * `lib/repos.ts` sanitises again before touching the filesystem — this is the
 * outer gate, not the only one.
 */
export const RepoCloneSchema = z.object({
  fullName: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/, "fullName must look like owner/repo"),
});

// ─── Setup ───

export const DatadogCheckSchema = z.object({
  apiKey: z.string().max(200).optional(),
  applicationKey: z.string().max(200).optional(),
});

// ─── Share ───

export const ShareCreateSchema = z.object({
  vault: z.string(),
  path: z.string().min(1),
});

/**
 * `/api/setup/save` writes dashboard/.env.local — the highest-consequence body
 * in the app, since it is what toggles LAN exposure and rewrites integration
 * secrets. Every group is optional (the UI saves one section at a time) but
 * each field is pinned to a string so a nested object can't reach the env
 * writer. Directory paths get a further existence check in the handler.
 */
export const SetupSaveSchema = z.object({
  calendar: z
    .object({
      clientId: z.string().max(500).optional(),
      clientSecret: z.string().max(500).optional(),
      refreshToken: z.string().max(2000).optional(),
    })
    .optional(),
  jira: z
    .object({
      domain: z.string().max(300),
      email: z.string().max(300),
      apiToken: z.string().max(500),
    })
    .optional(),
  datadog: z
    .union([
      z.object({
        apiKey: z.string().max(200).optional(),
        applicationKey: z.string().max(200).optional(),
        email: z.string().max(300).optional(),
        scheduleId: z.string().max(200).optional(),
      }),
      z.null(),
    ])
    .optional(),
  core: z
    .object({
      repoRoot: z.string().max(4096).optional(),
      notesDir: z.string().max(4096).optional(),
    })
    .optional(),
  network: z
    .object({
      allowLan: z.boolean(),
      openchamberUiPassword: z.string().max(500).optional(),
    })
    .optional(),
  bi: z.object({ capiRepoPath: z.string().max(4096).optional() }).optional(),
  agent: z
    .object({
      cli: z.string().max(100).optional(),
      opencodeModel: z.string().max(200).optional(),
      cursorModel: z.string().max(200).optional(),
    })
    .optional(),
});
