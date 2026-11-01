import { z } from "zod";
import { defineAction } from "./define.ts";

export interface WorkspaceContext<Input> { execute: (input: Input) => unknown }

export const skillsReadInput = z.object({ name: z.string().min(1).describe("Skill name from skills_list") }).meta({ additionalProperties: false });
export const skillsRead = defineAction<typeof skillsReadInput, WorkspaceContext<z.output<typeof skillsReadInput>>, unknown>({
  input: skillsReadInput,
  http: {"method":"GET","path":"/api/skills/[name]"},
  mcp: { name: "skills_read", toolset: "workspace", description: "Read a single skill's full definition by name, as listed by skills_list." },
  handler: (input, context) => context.execute(input),
});

export const skillsProposeUpdateInput = z.object({
      skill: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/),
      baseRevision: z.string().regex(/^[a-f0-9]{64}$/),
      runId: z.string().regex(/^run-[a-z0-9]{6,12}-[0-9a-f]{8}$/),
      reason: z.string().trim().min(10).max(2000),
      evidence: z.string().trim().min(20).max(8000),
      content: z.string().trim().min(20).max(100000),
    }).meta({ additionalProperties: false });
// HTTP rejects unknown proposal fields; MCP historically strips extra tool arguments.
export const skillsProposeUpdateBodyInput = skillsProposeUpdateInput.strict();
export const skillsProposeUpdate = defineAction<typeof skillsProposeUpdateInput, WorkspaceContext<z.output<typeof skillsProposeUpdateInput>>, unknown>({
  input: skillsProposeUpdateInput,
  http: {"method":"POST","path":"/api/skills/proposals"},
  mcp: { name: "skills_propose_update", toolset: "workspace", description: "Propose an improvement to an editable DevHub shared skill from a completed successful run. First read skills_read for its revision. Include concrete evidence from the run and the full proposed content. This saves a proposal for human review in /skills/proposals; it does not edit or sync the skill." },
  handler: (input, context) => context.execute(input),
});

export const contextPackInput = z.object({
        format: z
          .string()
          .optional()
          .describe("Optional format hint passed through to the dashboard (e.g. 'markdown')"),
      }).meta({ additionalProperties: false });
export const contextPack = defineAction<typeof contextPackInput, WorkspaceContext<z.output<typeof contextPackInput>>, unknown>({
  input: contextPackInput,
  http: {"method":"GET","path":"/api/context-pack"},
  mcp: { name: "context_pack", toolset: "workspace", description: "Assemble the DevHub context pack — a consolidated snapshot of the current working state. Useful as a first call when picking up work with no other context." },
  handler: (input, context) => context.execute(input),
});

export const collectionsListInput = z.object({
        notePath: z.string().optional().describe("Optional note path to filter by membership"),
      }).meta({ additionalProperties: false });
export const collectionsList = defineAction<typeof collectionsListInput, WorkspaceContext<z.output<typeof collectionsListInput>>, unknown>({
  input: collectionsListInput,
  http: {"method":"GET","path":"/api/collections"},
  mcp: { name: "collections_list", toolset: "workspace", description: "List collections, or the collections a given note belongs to when `notePath` is supplied." },
  handler: (input, context) => context.execute(input),
});

export const radarPersonalInput = z.object({});
export const radarPersonal = defineAction<typeof radarPersonalInput, WorkspaceContext<z.output<typeof radarPersonalInput>>, unknown>({
  input: radarPersonalInput,
  http: {"method":"GET","path":"/api/radar/personal"},
  mcp: { name: "radar_personal", toolset: "workspace", description: "Personal radar: what DevHub thinks is currently worth your attention." },
  handler: (input, context) => context.execute(input),
});

export const learningsListInput = z.object({ category: z.string().optional().describe("Optional category filter") }).meta({ additionalProperties: false });
export const learningsList = defineAction<typeof learningsListInput, WorkspaceContext<z.output<typeof learningsListInput>>, unknown>({
  input: learningsListInput,
  http: {"method":"GET","path":"/api/learnings"},
  mcp: { name: "learnings_list", toolset: "workspace", description: "List captured learnings, optionally filtered to one category." },
  handler: (input, context) => context.execute(input),
});

export const skillsListInput = z.object({});
export const skillsList = defineAction<typeof skillsListInput, WorkspaceContext<z.output<typeof skillsListInput>>, unknown>({
  input: skillsListInput, http: { method: "GET", path: "/api/skills" },
  mcp: { name: "skills_list", toolset: "workspace", description: "List the skills available in this DevHub workspace (core + plugin skills merged). Use this to find out what specialised capabilities exist before improvising." },
  handler: (input, context) => context.execute(input),
});
export const skillsProposalsInput = z.object({});
export const skillsProposals = defineAction<typeof skillsProposalsInput, WorkspaceContext<z.output<typeof skillsProposalsInput>>, unknown>({
  input: skillsProposalsInput, http: { method: "GET", path: "/api/skills/proposals", discriminator: "query id is empty or absent" },
  mcp: { name: "skills_proposals", toolset: "workspace", description: "List cited skill proposals and their current review state. Reads are fresh; proposals never apply themselves." },
  handler: (input, context) => context.execute(input),
});
export const personaListInput = z.object({});
export const personaList = defineAction<typeof personaListInput, WorkspaceContext<z.output<typeof personaListInput>>, unknown>({
  input: personaListInput, http: { method: "GET", path: "/api/persona", discriminator: "query id is empty or absent" },
  mcp: { name: "persona_list", toolset: "workspace", description: "List the configured persona modes (read-only — this tool does not switch persona)." },
  handler: (input, context) => context.execute(input),
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


export const skillCatalogCreateInput = z.object({ name: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/), description: z.string().optional() });
export const skillCatalogCreate = defineAction<typeof skillCatalogCreateInput, WorkspaceContext<z.output<typeof skillCatalogCreateInput>>, unknown>({
  input: skillCatalogCreateInput,
  http: { method: "POST", path: "/api/skills" },
  mcp: { reason: "Shared skill editing remains a local dashboard workflow; agents submit cited proposals for review." },
  handler: (input, context) => context.execute(input),
});

export const skillCatalogSaveInput = z.object({ name: z.string(), content: z.string().refine((content) => Boolean(content.trim())) });
export const skillCatalogSave = defineAction<typeof skillCatalogSaveInput, WorkspaceContext<z.output<typeof skillCatalogSaveInput>>, unknown>({
  input: skillCatalogSaveInput,
  http: { method: "PUT", path: "/api/skills/[name]" },
  mcp: { reason: "Shared skill editing remains a local dashboard workflow; agents submit cited proposals for review." },
  handler: (input, context) => context.execute(input),
});

export const skillCatalogRenameInput = z.object({ name: z.string(), newName: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/) });
export const skillCatalogRename = defineAction<typeof skillCatalogRenameInput, WorkspaceContext<z.output<typeof skillCatalogRenameInput>>, unknown>({
  input: skillCatalogRenameInput,
  http: { method: "PATCH", path: "/api/skills/[name]" },
  mcp: { reason: "Shared skill editing remains a local dashboard workflow; agents submit cited proposals for review." },
  handler: (input, context) => context.execute(input),
});

export const skillCatalogDeleteInput = z.object({ name: z.string() });
export const skillCatalogDelete = defineAction<typeof skillCatalogDeleteInput, WorkspaceContext<z.output<typeof skillCatalogDeleteInput>>, unknown>({
  input: skillCatalogDeleteInput,
  http: { method: "DELETE", path: "/api/skills/[name]" },
  mcp: { reason: "Shared skill editing remains a local dashboard workflow; agents submit cited proposals for review." },
  handler: (input, context) => context.execute(input),
});

export const skillLocalCandidatesInput = z.object({});
export const skillLocalCandidates = defineAction<typeof skillLocalCandidatesInput, WorkspaceContext<z.output<typeof skillLocalCandidatesInput>>, unknown>({
  input: skillLocalCandidatesInput,
  http: { method: "GET", path: "/api/skills/local" },
  mcp: { reason: "Installed skill discovery is a local import picker." },
  handler: (input, context) => context.execute(input),
});

export const skillLocalReadInput = z.object({ name: z.string() });
export const skillLocalRead = defineAction<typeof skillLocalReadInput, WorkspaceContext<z.output<typeof skillLocalReadInput>>, unknown>({
  input: skillLocalReadInput,
  http: { method: "GET", path: "/api/skills/local/[name]" },
  mcp: { reason: "Installed skill contents are a local import view." },
  handler: (input, context) => context.execute(input),
});

export const skillLocalDeleteInput = z.object({ name: z.string() });
export const skillLocalDelete = defineAction<typeof skillLocalDeleteInput, WorkspaceContext<z.output<typeof skillLocalDeleteInput>>, unknown>({
  input: skillLocalDeleteInput,
  http: { method: "DELETE", path: "/api/skills/local/[name]" },
  mcp: { reason: "Deleting installed skills is a local dashboard editing workflow." },
  handler: (input, context) => context.execute(input),
});

export const skillRefreshUpstreamInput = z.object({});
export const skillRefreshUpstream = defineAction<typeof skillRefreshUpstreamInput, WorkspaceContext<z.output<typeof skillRefreshUpstreamInput>>, unknown>({
  input: skillRefreshUpstreamInput,
  http: { method: "POST", path: "/api/skills/refresh-ai-tools" },
  mcp: { reason: "Updating the checked-out upstream skill catalog is an explicit local dashboard operation." },
  handler: (input, context) => context.execute(input),
});

export const skillProposalReadInput = z.object({ id: z.string().uuid() });
export const skillProposalRead = defineAction<typeof skillProposalReadInput, WorkspaceContext<z.output<typeof skillProposalReadInput>>, unknown>({
  input: skillProposalReadInput,
  http: { method: "GET", path: "/api/skills/proposals", discriminator: "query id is nonempty" },
  mcp: { reason: "The browser reviews one full proposal; skills_proposals lists summaries." },
  handler: (input, context) => context.execute(input),
});

export const skillProposalDecideInput = z.object({ id: z.string().uuid(), decision: z.enum(["accept", "reject"]), baseRevision: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const skillProposalDecide = defineAction<typeof skillProposalDecideInput, WorkspaceContext<z.output<typeof skillProposalDecideInput>>, unknown>({
  input: skillProposalDecideInput,
  http: { method: "PATCH", path: "/api/skills/proposals" },
  mcp: { reason: "Accepting or rejecting a cited skill proposal requires the existing browser review and revision recheck." },
  handler: (input, context) => context.execute(input),
});

export const personaTargetReadInput = z.object({ id: z.string() });
export const personaTargetRead = defineAction<typeof personaTargetReadInput, WorkspaceContext<z.output<typeof personaTargetReadInput>>, unknown>({
  input: personaTargetReadInput,
  http: { method: "GET", path: "/api/persona", discriminator: "query id is nonempty" },
  mcp: { reason: "Raw local persona targets are a dashboard editor view; persona_list returns the existing catalog." },
  handler: (input, context) => context.execute(input),
});

export const personaSaveInput = z.object({ id: z.string(), content: z.string() });
export const personaSave = defineAction<typeof personaSaveInput, WorkspaceContext<z.output<typeof personaSaveInput>>, unknown>({
  input: personaSaveInput,
  http: { method: "PUT", path: "/api/persona" },
  mcp: { reason: "Persona source writes and native-tool sync remain local editing workflows." },
  handler: (input, context) => context.execute(input),
});

export const personaLocalReadInput = z.object({ tool: z.string().nullable(), source: z.string().nullable() });
export const personaLocalRead = defineAction<typeof personaLocalReadInput, WorkspaceContext<z.output<typeof personaLocalReadInput>>, unknown>({
  input: personaLocalReadInput,
  http: { method: "GET", path: "/api/persona/local" },
  mcp: { reason: "The browser compares local persona blocks before importing them." },
  handler: (input, context) => context.execute(input),
});

export const collectionCreateInput = MasterListCreateSchema;
export const collectionCreate = defineAction<typeof collectionCreateInput, WorkspaceContext<z.output<typeof collectionCreateInput>>, unknown>({
  input: collectionCreateInput,
  http: { method: "POST", path: "/api/collections" },
  mcp: { reason: "Collection and checklist mutations are local dashboard workflows; collections_list only reads membership." },
  handler: (input, context) => context.execute(input),
});

export const collectionReadInput = z.object({ id: z.string() });
export const collectionRead = defineAction<typeof collectionReadInput, WorkspaceContext<z.output<typeof collectionReadInput>>, unknown>({
  input: collectionReadInput,
  http: { method: "GET", path: "/api/collections/[id]" },
  mcp: { reason: "The browser reads a selected collection editor; collections_list reads the catalog." },
  handler: (input, context) => context.execute(input),
});

export const collectionPatchInput = z.object({ id: z.string(), body: CollectionRoutePatchSchema });
export const collectionPatch = defineAction<typeof collectionPatchInput, WorkspaceContext<z.output<typeof collectionPatchInput>>, unknown>({
  input: collectionPatchInput,
  http: { method: "PATCH", path: "/api/collections/[id]" },
  mcp: { reason: "Collection and checklist editing stays on the browser surface." },
  handler: (input, context) => context.execute(input),
});

export const collectionDeleteInput = z.object({ id: z.string() });
export const collectionDelete = defineAction<typeof collectionDeleteInput, WorkspaceContext<z.output<typeof collectionDeleteInput>>, unknown>({
  input: collectionDeleteInput,
  http: { method: "DELETE", path: "/api/collections/[id]" },
  mcp: { reason: "Deleting a collection is an explicit browser editing operation." },
  handler: (input, context) => context.execute(input),
});

export const collectionLabelDriftInput = z.object({ id: z.string(), itemId: z.string().min(1), excludeNotePath: z.string().optional() });
export const collectionLabelDrift = defineAction<typeof collectionLabelDriftInput, WorkspaceContext<z.output<typeof collectionLabelDriftInput>>, unknown>({
  input: collectionLabelDriftInput,
  http: { method: "GET", path: "/api/collections/[id]/linked-label-drift" },
  mcp: { reason: "The browser previews linked-label propagation before editing notes." },
  handler: (input, context) => context.execute(input),
});

export const collectionSyncLabelsInput = SyncLinkedLabelsSchema.extend({ id: z.string() });
export const collectionSyncLabels = defineAction<typeof collectionSyncLabelsInput, WorkspaceContext<z.output<typeof collectionSyncLabelsInput>>, unknown>({
  input: collectionSyncLabelsInput,
  http: { method: "POST", path: "/api/collections/[id]/sync-linked-labels" },
  mcp: { reason: "Bulk linked-label propagation is an explicit browser checklist operation." },
  handler: (input, context) => context.execute(input),
});

export const radarReleaseViewInput = z.object({ prodOnly: z.boolean() });
export const radarReleaseView = defineAction<typeof radarReleaseViewInput, WorkspaceContext<z.output<typeof radarReleaseViewInput>>, unknown>({
  input: radarReleaseViewInput,
  http: { method: "GET", path: "/api/radar/releases" },
  mcp: { reason: "The browser release radar is an estate/version view, separate from shipped DevHub release notes." },
  handler: (input, context) => context.execute(input),
});

export const radarAcknowledgeInput = z.object({ kind: z.enum(["capability", "release"]), id: z.string().min(1), watermark: z.coerce.number().int().min(0) });
export const radarAcknowledge = defineAction<typeof radarAcknowledgeInput, WorkspaceContext<z.output<typeof radarAcknowledgeInput>>, unknown>({
  input: radarAcknowledgeInput,
  http: { method: "POST", path: "/api/radar/acknowledge" },
  mcp: { reason: "Acknowledgement stores exactly the magnitude shown to the user in the browser." },
  handler: (input, context) => context.execute(input),
});

export const radarUnacknowledgeInput = radarAcknowledgeInput.pick({ kind: true, id: true });
export const radarUnacknowledge = defineAction<typeof radarUnacknowledgeInput, WorkspaceContext<z.output<typeof radarUnacknowledgeInput>>, unknown>({
  input: radarUnacknowledgeInput,
  http: { method: "DELETE", path: "/api/radar/acknowledge" },
  mcp: { reason: "Undoing a browser acknowledgement is local preference state." },
  handler: (input, context) => context.execute(input),
});

export const radarAcknowledgementsReadInput = z.object({});
export const radarAcknowledgementsRead = defineAction<typeof radarAcknowledgementsReadInput, WorkspaceContext<z.output<typeof radarAcknowledgementsReadInput>>, unknown>({
  input: radarAcknowledgementsReadInput,
  http: { method: "GET", path: "/api/radar/acknowledge" },
  mcp: { reason: "Acknowledgement state belongs to the browser radar views." },
  handler: (input, context) => context.execute(input),
});
