import { MasterListCreateSchema, MasterListPatchSchema, MasterListItemInputSchema, MasterListItemPatchSchema, CollectionRoutePatchSchema, SyncLinkedLabelsSchema } from "../../../../packages/shared/actions/workspace";
import { sharePublishInput, shareOneTimeInput, shareMarkdownInput, shareOneTimeRevokeInput } from "../../../../packages/shared/actions/share";
import { z } from "zod";
import { optionalIntegrationSettingsSchema } from "./plugin-setup-schema";
import { taskCompletion, taskCreate, taskDelete, taskReorder, taskTimerStart, taskTimerStop, taskUpdate } from "../../../../packages/shared/actions/tasks";
import { repoCloneInput, repoCloneRemoteInput, repoInitInput } from "../../../../packages/shared/actions/repos";
import { jiraAssignBodyInput, jiraCreateDashboardInput, jiraTransitionBodyInput } from "../../../../packages/shared/actions/work";

export const EntityRefSchema = z.object({
  kind: z.enum(["task", "meeting", "pr", "note", "diagram", "calendar", "jira", "repo"]),
  id: z.string().min(1).max(200),
  label: z.string().min(1).max(200),
  href: z.string().max(1000).optional(),
  marker: z.string().max(500).optional(),
});

export const TaskCreateSchema = taskCreate.input.omit({ withNote: true, draft: true }).extend({
  text: z.string().min(1, "text is required").max(500),
  due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "due must be YYYY-MM-DD").optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD").optional(),
  links: z.array(EntityRefSchema).max(20).optional(),
  stage: z.enum(["draft"]).optional(),
  parentKey: z.string().regex(/^[A-Z][A-Z0-9_]*-[1-9][0-9]*$/).optional(),
});

export const TaskPatchSchema = taskUpdate.input
  .extend({
    id: z.string().min(1, "id is required"),
    text: z.string().min(1).max(500).optional(),
    done: z.boolean().optional(),
    completion: taskCompletion.input.shape.completion.optional(),
    due: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.null()]).optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    status: z.enum(["abandoned", "active"]).optional(),
    abandonReason: z.string().max(200).optional(),
    timer: z.union([taskTimerStart.input.shape.timer, taskTimerStop.input.shape.timer]).optional(),
    links: z.array(EntityRefSchema).max(20).optional(),
    stage: z.enum(["draft", "ready"]).optional(),
  })
  .refine(
    (v) =>
      v.text !== undefined ||
      v.done !== undefined ||
      v.completion !== undefined ||
      v.due !== undefined ||
      v.status !== undefined ||
      v.timer !== undefined ||
      v.links !== undefined ||
      v.stage !== undefined,
    { message: "Provide text, done, completion, due, status, timer, links, or stage" },
  );

export const TaskDeleteSchema = taskDelete.input.extend({
  id: z.string().min(1, "id is required"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const TaskReorderSchema = taskReorder.input;

export const JiraCreateIssueSchema = jiraCreateDashboardInput;

export const JiraTransitionSchema = jiraTransitionBodyInput;

export const JiraAssignSchema = jiraAssignBodyInput;

export const NotePutSchema = z.object({
  content: z.unknown(),
  expectedModified: z.number().finite().nonnegative().nullable().optional(),
  /** Task notes: when `expectedModified` is stale, keep the newer standard sections and apply only this save's free-form blocks. */
  mergeAgentSections: z.boolean().optional(),
});

export { MasterListCreateSchema, MasterListPatchSchema, MasterListItemInputSchema, MasterListItemPatchSchema, CollectionRoutePatchSchema, SyncLinkedLabelsSchema };

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

// ─── Repos ───

/**
 * `owner/repo` as GitHub itself allows: alphanumerics, dot, dash, underscore.
 * `lib/repos.ts` sanitises again before touching the filesystem — this is the
 * outer gate, not the only one.
 */
export const RepoCloneSchema = z.union([repoCloneInput, repoCloneRemoteInput]);

export const RepoInitSchema = repoInitInput;

// ─── Setup ───

export const TypesafeCheckSchema = z.object({ apiKey: z.string().max(500).optional() });

export const GithubDeviceLoginSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start") }),
  z.object({ action: z.literal("poll"), id: z.string().min(1).max(100) }),
]);

export const JiraCheckSchema = z.object({
  domain: z.string().max(300).optional(),
  email: z.string().max(300).optional(),
  apiToken: z.string().max(500).optional(),
});

// ─── Share ───

// HTTP accepts the legacy vault string and normalises it with parseVaultId.
export const ShareCreateSchema = sharePublishInput.extend({ vault: z.string() });
export const OneTimeShareCreateSchema = z.union([shareOneTimeInput.extend({ vault: z.string() }), shareMarkdownInput]);
export const OneTimeShareDeleteSchema = shareOneTimeRevokeInput;

/**
 * `/api/setup/save` writes apps/ui/.env.local — the highest-consequence body
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
      domain: z.string().max(300).optional(),
      email: z.string().max(300).optional(),
      apiToken: z.string().max(500).optional(),
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
      /**
       * Optional DevHub git checkout. Advanced only — an installed app does not
       * have one, and the setup form must not ask a normal user for it.
       */
      repoRoot: z.string().max(4096).optional(),
      notesDir: z.string().max(4096).optional(),
      /** The user's code folder — what "Repo root" used to be confused with. */
      reposDir: z.string().max(4096).optional(),
    })
    .optional(),
  network: z
    .object({
      agentsPassword: z.string().max(500).optional(),
    })
    .optional(),
  infra: z.object({ scriptsRepoPath: z.string().max(4096).optional() }).optional(),
  agent: z
    .object({
      provider: z.string().max(100).optional(),
      cli: z.string().max(100).optional(),
      opencodeModel: z.string().max(200).optional(),
      cursorModel: z.string().max(200).optional(),
    })
    .optional(),
  /** Jev, the model behind QA runs. null removes the saved key. */
  typesafe: z.union([z.object({ apiKey: z.string().max(500).optional() }), z.null()]).optional(),
  slack: optionalIntegrationSettingsSchema.optional(),
});
