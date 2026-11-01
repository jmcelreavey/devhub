import { z } from "zod";
import { defineAction } from "./define.ts";

interface CapabilityContext<Input> { execute: (input: Input) => unknown }

export const capabilityRadarInput = z.object({});
export const capabilityRadar = defineAction<typeof capabilityRadarInput, CapabilityContext<z.output<typeof capabilityRadarInput>>, unknown>({
  input: capabilityRadarInput,
  http: {"method":"GET","path":"/api/capability/radar"},
  mcp: { name: "capability_radar", toolset: "capability", description: "Capability Radar: read the latest scan of technologies/patterns/concepts across your repos, what changed since the last scan, and knowledge-drift. Requires the dashboard running." },
  handler: (input, context) => context.execute(input),
});

export const capabilityScanInput = z.object({
        includeGithub: z.boolean().optional().describe("Also probe accessible un-cloned GitHub repos"),
        githubFilter: z.string().optional().describe("Restrict remote scan to repos whose full name contains this (e.g. an org like 'example-org')"),
      }).meta({ additionalProperties: false });
export const capabilityScan = defineAction<typeof capabilityScanInput, CapabilityContext<z.output<typeof capabilityScanInput>>, unknown>({
  input: capabilityScanInput,
  http: {"method":"POST","path":"/api/capability/scan"},
  mcp: { name: "capability_scan", toolset: "capability", description: "Run a Capability Radar scan across local repos (and optionally un-cloned GitHub repos). Writes a dated snapshot and returns what changed. Requires the dashboard running; may take a while with GitHub enabled." },
  handler: (input, context) => context.execute(input),
});

export const capabilityDigestInput = z.object({
        generate: z.boolean().optional().describe("Run a fresh scan + digest instead of returning the latest"),
        includeGithub: z.boolean().optional().describe("When generating, also probe un-cloned GitHub repos"),
        githubFilter: z.string().optional().describe("When generating, restrict remote scan to this org/owner substring"),
      }).meta({ additionalProperties: false });
export const capabilityDigest = defineAction<typeof capabilityDigestInput, CapabilityContext<z.output<typeof capabilityDigestInput>>, unknown>({
  input: capabilityDigestInput,
  http: {"reason":"MCP selects the existing digest read or generation route; no combined HTTP endpoint."},
  mcp: { name: "capability_digest", toolset: "capability", description: "The weekly 'what changed in your engineering environment' digest. By default returns the latest; pass generate=true to run a fresh scan + digest now. Requires the dashboard running." },
  handler: (input, context) => context.execute(input),
});

export const capabilityGetLabInput = z.object({
        signalId: z.string().describe("Signal id, e.g. 'flux', 'terraform', 'mongodb-atlas'"),
        repoName: z.string().optional().describe("Pin to a specific repo that has this signal"),
      }).meta({ additionalProperties: false });
export const capabilityGetLab = defineAction<typeof capabilityGetLabInput, CapabilityContext<z.output<typeof capabilityGetLabInput>>, unknown>({
  input: capabilityGetLabInput,
  http: {"method":"POST","path":"/api/capability/journey"},
  mcp: { name: "capability_get_lab", toolset: "capability", description: "Fetch an existing hands-on learning lab for a detected signal (markdown + workspace path). Labs are BUILT from the dashboard UI, which runs the capability-lab OpenCode skill in the terminal — this tool only reads the result. Use signal ids from capability_radar. Requires the dashboard running." },
  handler: (input, context) => context.execute(input),
});

export const capabilityCompleteLabInput = z.object({
        category: z.string().describe("Lab category, e.g. 'labs/eks-config/flux'"),
        done: z.boolean().optional().describe("false to reopen; defaults to true"),
      }).meta({ additionalProperties: false });
export const capabilityCompleteLab = defineAction<typeof capabilityCompleteLabInput, CapabilityContext<z.output<typeof capabilityCompleteLabInput>>, unknown>({
  input: capabilityCompleteLabInput,
  http: {"method":"POST","path":"/api/capability/journey/complete"},
  mcp: { name: "capability_complete_lab", toolset: "capability", description: "Mark a lab done (or reopen it) and tick its follow-up task. Use the category from capability_build_lab. Requires the dashboard running." },
  handler: (input, context) => context.execute(input),
});

export const capabilityDigestReadInput = z.object({});
export const capabilityDigestRead = defineAction<typeof capabilityDigestReadInput, CapabilityContext<z.output<typeof capabilityDigestReadInput>>, unknown>({
  input: capabilityDigestReadInput,
  http: { method: "GET", path: "/api/capability/digest" },
  mcp: { reason: "Selected by capability_digest for the latest digest; browser also receives digest history." },
  handler: (input, context) => context.execute(input),
});

export const capabilityDigestGenerateInput = capabilityDigestInput.omit({ generate: true });
export const capabilityDigestGenerate = defineAction<typeof capabilityDigestGenerateInput, CapabilityContext<z.output<typeof capabilityDigestGenerateInput>>, unknown>({
  input: capabilityDigestGenerateInput,
  http: { method: "POST", path: "/api/capability/digest" },
  mcp: { reason: "Selected by capability_digest when generation is requested." },
  handler: (input, context) => context.execute(input),
});

export const capabilityJourneyListInput = z.object({ repoName: z.string().optional() });
export const capabilityJourneyList = defineAction<typeof capabilityJourneyListInput, CapabilityContext<z.output<typeof capabilityJourneyListInput>>, unknown>({
  input: capabilityJourneyListInput,
  http: { method: "GET", path: "/api/capability/journey" },
  mcp: { reason: "The dashboard lists lab cards; capability_get_lab reads a selected lab." },
  handler: (input, context) => context.execute(input),
});

export const capabilityExplainInput = z.object({ deltaId: z.string().trim().min(1, "deltaId required"), refresh: z.boolean().optional() });
export const capabilityExplain = defineAction<typeof capabilityExplainInput, CapabilityContext<z.output<typeof capabilityExplainInput>>, unknown>({
  input: capabilityExplainInput,
  http: { method: "POST", path: "/api/capability/explain" },
  mcp: { reason: "Model-generated signal explanations remain a dashboard workflow." },
  handler: (input, context) => context.execute(input),
});

export const capabilityLabAdoptInput = capabilityGetLabInput;
export const capabilityLabAdopt = defineAction<typeof capabilityLabAdoptInput, CapabilityContext<z.output<typeof capabilityLabAdoptInput>>, unknown>({
  input: capabilityLabAdoptInput,
  http: { method: "POST", path: "/api/capability/journey/adopt" },
  mcp: { reason: "The local capability-lab skill registers a generated lab and workspace; MCP reads existing labs only." },
  handler: (input, context) => context.execute(input),
});

export const capabilityLabPlanInput = capabilityGetLabInput;
export const capabilityLabPlan = defineAction<typeof capabilityLabPlanInput, CapabilityContext<z.output<typeof capabilityLabPlanInput>>, unknown>({
  input: capabilityLabPlanInput,
  http: { method: "GET", path: "/api/capability/journey/plan" },
  mcp: { reason: "The browser prepares the local terminal's capability-lab skill invocation." },
  handler: (input, context) => context.execute(input),
});

export const capabilityLabSessionReadInput = z.object({ category: z.string() });
export const capabilityLabSessionRead = defineAction<typeof capabilityLabSessionReadInput, CapabilityContext<z.output<typeof capabilityLabSessionReadInput>>, unknown>({
  input: capabilityLabSessionReadInput,
  http: { method: "GET", path: "/api/capability/journey/session" },
  mcp: { reason: "Saved tutor conversations are a dashboard session view." },
  handler: (input, context) => context.execute(input),
});

export const capabilityLabSessionSaveInput = z.object({ category: z.string(), messages: z.array(z.unknown()), clear: z.boolean() });
export const capabilityLabSessionSave = defineAction<typeof capabilityLabSessionSaveInput, CapabilityContext<z.output<typeof capabilityLabSessionSaveInput>>, unknown>({
  input: capabilityLabSessionSaveInput,
  http: { method: "POST", path: "/api/capability/journey/session" },
  mcp: { reason: "Saving and clearing tutor conversations remains a dashboard workflow." },
  handler: (input, context) => context.execute(input),
});

export const capabilityTutorInput = z.object({ repoName: z.string(), signalId: z.string(), messages: z.array(z.unknown()) });
export const capabilityTutor = defineAction<typeof capabilityTutorInput, CapabilityContext<z.output<typeof capabilityTutorInput>>, unknown>({
  input: capabilityTutorInput,
  http: { method: "POST", path: "/api/capability/journey/tutor" },
  mcp: { reason: "This browser tutor returns an AI SDK stream; it is not a request/response MCP action." },
  handler: (input, context) => context.execute(input),
});

export const capabilityWorkspaceOpenInput = z.object({ category: z.string().trim().min(1, "category required") });
export const capabilityWorkspaceOpen = defineAction<typeof capabilityWorkspaceOpenInput, CapabilityContext<z.output<typeof capabilityWorkspaceOpenInput>>, unknown>({
  input: capabilityWorkspaceOpenInput,
  http: { method: "POST", path: "/api/capability/workspace/open" },
  mcp: { reason: "Launching a local editor requires an explicit browser action and a server-owned lab workspace path." },
  handler: (input, context) => context.execute(input),
});
