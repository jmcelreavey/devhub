import { resolveCursorAgentBin } from "@/lib/agent/cli-env";
import { execExternal } from "@/lib/exec-external";

const CURSOR_MODEL_CACHE_TTL_MS = 5 * 60_000;

let snapshot: { at: number; models: string[] } | undefined;
let inflight: Promise<string[]> | undefined;

export function parseCursorModelList(output: string): string[] {
  const models: string[] = [];
  for (const line of output.split("\n")) {
    const match = /^([A-Za-z0-9][A-Za-z0-9._/-]*)\s+-\s+/.exec(line.trim());
    if (match && !models.includes(match[1])) models.push(match[1]);
  }
  return models;
}

async function loadCursorAgentModels(): Promise<string[]> {
  const bin = resolveCursorAgentBin();
  if (!bin) return [];
  const { stdout } = await execExternal(bin, ["--list-models"], {
    timeoutMs: 15_000,
    label: "cursor-agent:list-models",
  });
  const models = parseCursorModelList(stdout);
  snapshot = { at: Date.now(), models };
  return models;
}

/** Cached live model ids accepted by the installed Cursor CLI. */
export async function listCursorAgentModels(): Promise<string[]> {
  if (snapshot && Date.now() - snapshot.at < CURSOR_MODEL_CACHE_TTL_MS) return snapshot.models;
  inflight ??= loadCursorAgentModels().finally(() => {
    inflight = undefined;
  });
  return inflight;
}

export function clearCursorAgentModelCache(): void {
  snapshot = undefined;
  inflight = undefined;
}
