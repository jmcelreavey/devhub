import { revalidateScriptsHistory } from "./scripts-history-swr";
import { waitForScriptRun } from "./wait-for-script-run";

export type CollectScript = "collect_local_skills" | "collect_local_agents";

export async function runCollectImport(opts: {
  script: CollectScript;
  names: string[];
  importBodyKey: "importSkillNames" | "importAgentNames";
  onLog?: (line: string) => void;
}): Promise<number> {
  const r = await fetch("/api/scripts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ script: opts.script, [opts.importBodyKey]: opts.names }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? r.statusText);
  const { runId } = data as { runId: string };

  const code = await waitForScriptRun(runId, { onLine: opts.onLog });
  revalidateScriptsHistory();
  return code;
}
