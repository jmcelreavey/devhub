import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { withMutex } from "@/lib/atomic-write";
import { pluginAssetDirs } from "@/lib/plugins/registry";
import { readPaseoManaged } from "./managed";
import { withPaseo } from "./client";

const START = "<!-- devhub:paseo-context:start -->";
const END = "<!-- devhub:paseo-context:end -->";
export function mergePaseoContext(existing: string, context: string): string {
  const block = `${START}\n${context.trim()}\n${END}`;
  const start = existing.indexOf(START);
  const end = existing.indexOf(END, start);
  if (start >= 0 && end >= start) return existing.slice(0, start) + block + existing.slice(end + END.length);
  return [existing.trim(), block].filter(Boolean).join("\n\n");
}

/** Native providers read their synced skill directories; the host prompt also covers custom ACP providers. */
export async function syncPaseoContext(repoRoot: string, dryRun: boolean, emit: (line: string) => void): Promise<void> {
  const managed = readPaseoManaged();
  if (!managed) return;
  const read = (file: string) => fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim() : "";
  const agentDirs = [path.join(repoRoot, "agents", "shared"), ...pluginAssetDirs("agents", os.homedir(), emit).map(entry => entry.dir)];
  const context = [
    read(path.join(repoRoot, "persona", "identity.txt")),
    read(path.join(repoRoot, "persona", "shared-persona.md")),
    `Shared skills are synced from DevHub and its enabled plugins to ${path.join(os.homedir(), ".agents", "skills")}. Read a relevant SKILL.md before using that skill.`,
    `Reusable agent definitions live in: ${agentDirs.join(", ")}. Read the relevant Markdown definition when the user selects or asks for that specialist; these definitions are instructions, not provider or model names.`,
  ].filter(Boolean).join("\n\n");
  if (dryRun) { emit("[paseo] WOULD sync shared persona and skill/agent locations"); return; }
  const file = path.join(managed.home, "config.json");
  let prompt = "";
  await withMutex(file, async () => {
    const current = JSON.parse(fs.readFileSync(file, "utf8"));
    prompt = mergePaseoContext(current.daemon?.appendSystemPrompt ?? "", context);
    if (current.daemon?.appendSystemPrompt === prompt) return;
    const next = { ...current, daemon: { ...current.daemon, appendSystemPrompt: prompt } };
    const temp = `${file}.devhub-next`;
    fs.writeFileSync(temp, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
    fs.renameSync(temp, file);
  });
  try {
    await withPaseo(({ daemon }) => daemon.reloadDaemonConfig());
    emit("[paseo] Shared persona and skill/agent locations synced");
  } catch {
    emit("[paseo] Context saved; start or restart Paseo to load it");
  }
}
