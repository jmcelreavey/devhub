import fs from "node:fs";
import path from "node:path";
import { getAppDataDir } from "@/lib/desktop/runtime-paths";
import { SetupProgressSchema, type SetupProgress } from "./progress";

function stateFile(): string {
  return path.join(getAppDataDir(), "config", "first-run.json");
}

export function readSetupProgress(): SetupProgress {
  try {
    return SetupProgressSchema.parse(JSON.parse(fs.readFileSync(stateFile(), "utf8")));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code !== "ENOENT") throw error;
    return SetupProgressSchema.parse({});
  }
}

export function saveSetupProgress(patch: Partial<Omit<SetupProgress, "completedAt">>): SetupProgress {
  const current = readSetupProgress();
  const next = SetupProgressSchema.parse({
    ...current,
    ...patch,
    completedAt: patch.completed && !current.completed ? new Date().toISOString() : current.completedAt,
  });
  const file = stateFile();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
  return next;
}
