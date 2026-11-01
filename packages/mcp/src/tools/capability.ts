import { capabilityRadar, capabilityScan, capabilityDigest, capabilityGetLab, capabilityCompleteLab } from "../../../../packages/shared/actions/capability.ts";
import { registerAction } from "../actions/register.ts";
import type { DashboardToolResult } from "../dashboard-client.ts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Context } from "../context.ts";
import { withDashboardErrors } from "../dashboard-client.ts";
import { listWidgetHtml, uiResult } from "../ui.ts";

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

  registerAction(server, capabilityRadar, { execute: async () =>
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
        const html = listWidgetHtml(
          "Capability Radar",
          `${data.snapshot.repoCount} repos`,
          rolls.slice(0, 12).map((r) => ({
            label: `${r.label} (${r.area})`,
            meta: `${r.repos.length} repos`,
          })),
        );
        return uiResult(text, html, "ui://devhub/capability/radar");
      }) },
    (result) => result as DashboardToolResult, undefined, { omitInputSchema: true });

  registerAction(server, capabilityScan, { execute: async ({ includeGithub, githubFilter }) =>
      withDashboardErrors(async () => {
        const r = await dashboard.post<{ snapshot: { repoCount: number }; diff: { added: DiffEntry[]; spread: DiffEntry[] }; warnings?: string[] }>(
          "/api/capability/scan",
          { includeGithub, githubFilter },
          180_000,
        );
        const added = r.diff.added.map((e) => `+${e.label}`).join(", ") || "none";
        const warn = r.warnings?.length ? `\nWarnings: ${r.warnings.join("; ")}` : "";
        return { content: [{ type: "text", text: `Scanned ${r.snapshot.repoCount} repos. New: ${added}.${warn}` }] };
      }) },
    (result) => result as DashboardToolResult);

  registerAction(server, capabilityDigest, { execute: async ({ generate, includeGithub, githubFilter }) =>
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
      }) },
    (result) => result as DashboardToolResult);

  registerAction(server, capabilityGetLab, { execute: async ({ signalId, repoName }) =>
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
      }) },
    (result) => result as DashboardToolResult);

  registerAction(server, capabilityCompleteLab, { execute: async ({ category, done }) =>
      withDashboardErrors(async () => {
        const r = await dashboard.post<{ done: boolean }>("/api/capability/journey/complete", { category, done });
        return { content: [{ type: "text", text: `Lab ${category} marked ${r.done ? "done" : "open"}.` }] };
      }) },
    (result) => result as DashboardToolResult);
}
