"use client";

import { useCallback, useState } from "react";
import { GitBranch } from "lucide-react";
import { revalidateScriptsHistory } from "@/lib/scripts-history-swr";
import { useToast } from "@/lib/use-toast";
import { waitForScriptRun } from "@/lib/wait-for-script-run";

interface Props {
  script: string;
  label: string;
  successMessage: string;
  /** Passed to the server for `sync_skills` / `collect_local_skills`. */
  excludeSkills?: string[];
  skills?: string[];
  excludeAgents?: string[];
  agents?: string[];
  /** Passed to the server for `sync_mcp_servers` / `collect_local_mcp_servers`. */
  excludeServers?: string[];
  servers?: string[];
  /** `sync_skills` / `sync_agents` / `sync_mcp_servers`: true removes extras not in the catalog. */
  prune?: boolean;
  onComplete?: () => void;
}

/**
 * Triggers a backend script via /api/scripts and shows a toast on completion.
 * Used by the Persona, Skills and MCP tabs so the "deploy this change" flow
 * stays consistent.
 */
export function SyncButton({
  script,
  label,
  successMessage,
  excludeSkills,
  skills,
  excludeAgents,
  agents,
  excludeServers,
  servers,
  prune,
  onComplete,
}: Props) {
  const [running, setRunning] = useState(false);
  const toast = useToast();

  const trigger = useCallback(async () => {
    setRunning(true);
    try {
      const body: Record<string, unknown> = { script, excludeSkills, skills, excludeAgents, agents, excludeServers, servers };
      if ((script === "sync_skills" || script === "sync_agents" || script === "sync_mcp_servers") && typeof prune === "boolean") {
        body.prune = prune;
      }
      const r = await fetch("/api/scripts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(await r.text());
      const { runId } = (await r.json()) as { runId: string };

      const exit = await waitForScriptRun(runId);
      revalidateScriptsHistory();
      if (exit === 0) {
        toast.success(successMessage);
        onComplete?.();
      } else {
        toast.error(`${label} exited with code ${exit}.`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `${label} failed.`);
    } finally {
      setRunning(false);
    }
  }, [script, label, successMessage, excludeSkills, skills, excludeAgents, agents, excludeServers, servers, prune, onComplete, toast]);

  return (
    <button
      onClick={trigger}
      disabled={running}
      className="btn btn-primary text-xs"
      style={{ display: "flex", alignItems: "center", gap: "6px", padding: "4px 10px" }}
    >
      <GitBranch size={11} className={running ? "animate-spin" : ""} aria-hidden />
      {running ? "Syncing…" : label}
    </button>
  );
}
