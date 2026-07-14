import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Context } from "../context.ts";
import { withDashboardErrors } from "../dashboard-client.ts";

interface Rollup {
  id: string;
  label: string;
  area: string;
  repos: string[];
}
interface DiffEntry {
  id: string;
  label: string;
  area: string;
  repos: string[];
  fromRepoCount?: number;
  toRepoCount?: number;
}
interface DriftEntry {
  id: string;
  label: string;
  daysSinceMine: number | null;
  repoCount: number;
}
interface RadarPayload {
  snapshot: {
    createdAt: string;
    repoCount: number;
    source: { local: number; github: number };
    signals: Record<string, Rollup>;
  } | null;
  diff: { added: DiffEntry[]; spread: DiffEntry[]; removed: DiffEntry[]; drift: DriftEntry[] } | null;
  aiConfigured?: boolean;
}

export function registerCapabilityTools(server: McpServer, ctx: Context): void {
  const { dashboard } = ctx;

  server.registerTool(
    "capability_radar",
    {
      description:
        "Capability Radar: read the latest scan of technologies/patterns/concepts across your repos, what changed since the last scan, and knowledge-drift. Requires the dashboard running.",
    },
    async () =>
      withDashboardErrors(async () => {
        const data = await dashboard.get<RadarPayload>("/api/capability/radar");
        if (!data.snapshot) {
          return { content: [{ type: "text", text: "No scan yet. Run capability_scan first." }] };
        }
        const rolls = Object.values(data.snapshot.signals).sort((a, b) => b.repos.length - a.repos.length);
        const top = rolls.slice(0, 12).map((r) => `- ${r.label} (${r.area}) — ${r.repos.length} repos`);
        const d = data.diff;
        const changed = d
          ? [
              d.added.length ? `Added: ${d.added.map((e) => e.label).join(", ")}` : null,
              d.spread.length ? `Spreading: ${d.spread.map((e) => `${e.label} ${e.fromRepoCount}→${e.toRepoCount}`).join(", ")}` : null,
              d.removed.length ? `Retired: ${d.removed.map((e) => e.label).join(", ")}` : null,
              d.drift.length ? `Drift: ${d.drift.map((e) => `${e.label} (${e.daysSinceMine ?? "never"}d)`).join(", ")}` : null,
            ].filter(Boolean)
          : [];
        const text = [
          `Capability Radar — ${data.snapshot.repoCount} repos (${data.snapshot.source.local} local, ${data.snapshot.source.github} remote), scanned ${data.snapshot.createdAt}.`,
          "",
          "Top coverage:",
          ...top,
          "",
          changed.length ? changed.join("\n") : "No changes since the previous scan.",
        ].join("\n");
        return { content: [{ type: "text", text }] };
      }),
  );

  server.registerTool(
    "capability_scan",
    {
      description:
        "Run a Capability Radar scan across local repos (and optionally un-cloned GitHub repos). Writes a dated snapshot and returns what changed. Requires the dashboard running; may take a while with GitHub enabled.",
      inputSchema: {
        includeGithub: z.boolean().optional().describe("Also probe accessible un-cloned GitHub repos"),
        githubFilter: z.string().optional().describe("Restrict remote scan to repos whose full name contains this (e.g. an org like 'businessinsider')"),
      },
    },
    async ({ includeGithub, githubFilter }) =>
      withDashboardErrors(async () => {
        const r = await dashboard.post<{ snapshot: { repoCount: number }; diff: { added: DiffEntry[]; spread: DiffEntry[] }; warnings?: string[] }>(
          "/api/capability/scan",
          { includeGithub, githubFilter },
          180_000,
        );
        const added = r.diff.added.map((e) => `+${e.label}`).join(", ") || "none";
        const warn = r.warnings?.length ? `\nWarnings: ${r.warnings.join("; ")}` : "";
        return { content: [{ type: "text", text: `Scanned ${r.snapshot.repoCount} repos. New: ${added}.${warn}` }] };
      }),
  );

  server.registerTool(
    "capability_digest",
    {
      description:
        "The weekly 'what changed in your engineering environment' digest. By default returns the latest; pass generate=true to run a fresh scan + digest now. Requires the dashboard running.",
      inputSchema: {
        generate: z.boolean().optional().describe("Run a fresh scan + digest instead of returning the latest"),
        includeGithub: z.boolean().optional().describe("When generating, also probe un-cloned GitHub repos"),
        githubFilter: z.string().optional().describe("When generating, restrict remote scan to this org/owner substring"),
      },
    },
    async ({ generate, includeGithub, githubFilter }) =>
      withDashboardErrors(async () => {
        if (generate) {
          const d = await dashboard.post<{ headline: string; markdown: string }>(
            "/api/capability/digest",
            { includeGithub, githubFilter },
            180_000,
          );
          return { content: [{ type: "text", text: d.markdown || d.headline }] };
        }
        const data = await dashboard.get<{ latest: { markdown: string; headline: string } | null }>("/api/capability/digest");
        return {
          content: [{ type: "text", text: data.latest ? data.latest.markdown : "No digest yet. Call with generate=true." }],
        };
      }),
  );

  server.registerTool(
    "capability_get_lab",
    {
      description:
        "Fetch an existing hands-on learning lab for a detected signal (markdown + workspace path). Labs are BUILT from the dashboard UI, which runs the capability-lab OpenCode skill in the terminal — this tool only reads the result. Use signal ids from capability_radar. Requires the dashboard running.",
      inputSchema: {
        signalId: z.string().describe("Signal id, e.g. 'flux', 'terraform', 'mongodb-atlas'"),
        repoName: z.string().optional().describe("Pin to a specific repo that has this signal"),
      },
    },
    async ({ signalId, repoName }) =>
      withDashboardErrors(async () => {
        const lab = await dashboard.post<{
          label: string;
          repoName: string;
          category: string;
          markdown: string;
          workspacePath?: string;
          services?: string[];
        }>("/api/capability/journey", { signalId, repoName });
        const ws = lab.workspacePath
          ? `\n\nWorkspace: ${lab.workspacePath}${lab.services?.length ? ` (services: ${lab.services.join(", ")})` : ""}`
          : "";
        return {
          content: [{ type: "text", text: `Lab: ${lab.label} in ${lab.repoName} (saved to Learnings → ${lab.category})${ws}\n\n${lab.markdown}` }],
        };
      }),
  );

  server.registerTool(
    "capability_complete_lab",
    {
      description: "Mark a lab done (or reopen it) and tick its follow-up task. Use the category from capability_build_lab. Requires the dashboard running.",
      inputSchema: {
        category: z.string().describe("Lab category, e.g. 'labs/eks-config/flux'"),
        done: z.boolean().optional().describe("false to reopen; defaults to true"),
      },
    },
    async ({ category, done }) =>
      withDashboardErrors(async () => {
        const r = await dashboard.post<{ done: boolean }>("/api/capability/journey/complete", { category, done });
        return { content: [{ type: "text", text: `Lab ${category} marked ${r.done ? "done" : "open"}.` }] };
      }),
  );
}
