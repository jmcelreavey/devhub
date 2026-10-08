import fs from "node:fs";
import path from "node:path";
import type { RebuildStatus } from "@/lib/desktop/checkout-rebuild";

export function payloadRestartStatus(
  appData: string,
  runningCommit: string | null,
  status: RebuildStatus | null,
): RebuildStatus | null {
  let completedCommit: string | null = null;
  try {
    const record: unknown = JSON.parse(fs.readFileSync(path.join(appData, "config/local-payload.json"), "utf8"));
    if (record && typeof record === "object" && "commit" in record && "dir" in record
      && typeof record.commit === "string" && record.commit.trim()
      && typeof record.dir === "string" && path.isAbsolute(record.dir)
      && fs.existsSync(path.join(record.dir, ".complete"))) {
      completedCommit = record.commit.trim();
    }
  } catch {
    completedCommit = null;
  }
  if (!completedCommit) {
    if (!status) return null;
    return { ...status, restartRequired: status.state === "succeeded" && status.restartRequired && status.commit !== runningCommit };
  }
  const restartRequired = completedCommit !== runningCommit;
  if (status) return { ...status, restartRequired };
  return {
    state: "succeeded",
    mode: "payload",
    phase: null,
    phases: [],
    error: null,
    rolledBack: false,
    restartRequired,
    commit: completedCommit,
  };
}
