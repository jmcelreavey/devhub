import path from "node:path";
import { getRepoRoot, getNotesDir, getTasksDir, getCollectionsDir, getRepsDir, getUpstartsDir, getAppDataDir } from "../content/dirs";
import { profileConfigDir, profileStateDir } from "../../../../../packages/shared/storage/profile-state";
import { noteMediaDir } from "../notes/media-store";
import { readPaseoManaged } from "../paseo/managed";
import { agentRunsDir } from "../agent-runs/store";
import type { BackupRoot } from "./bundle";
import { sqliteDatabasePath } from "../../domains/storage/sqlite";

export function recoveryStores(): BackupRoot[] {
  const content = getRepoRoot();
  const paseo = readPaseoManaged();
  const roots: BackupRoot[] = [
    { id: "notes", source: getNotesDir() },
    { id: "tasks", source: getTasksDir() },
    { id: "collections", source: getCollectionsDir() },
    { id: "reps", source: getRepsDir() },
    { id: "upstarts", source: getUpstartsDir() },
    { id: "persona", source: path.join(content, "persona") },
    { id: "config", source: profileConfigDir() },
    { id: "state", source: profileStateDir() },
    { id: "sqlite", source: path.dirname(sqliteDatabasePath()), include: ["devhub.db"] },
    { id: "media", source: noteMediaDir() },
    { id: "agent-runs", source: agentRunsDir() },
    { id: "environment", source: path.join(content, "apps/ui"), include: [".env.local"] },
    { id: "app-config", source: getAppDataDir(), include: ["db-connections.json", "repo-path.txt", "content-repo-path.txt"] },
    ...(paseo ? [{ id: "paseo", source: paseo.home, include: ["agents", "agent-requests", "creations", "projects", "uploads", "schedules", "config.json", "daemon-keypair.json", "server-id", "local-credential", "cli-client-id"] }] : []),
  ];
  return roots.filter((root, index) => !roots.some((parent, parentIndex) => parent !== root && !parent.include &&
    ((root.source === parent.source && parentIndex < index) || (path.relative(parent.source, root.source) !== "" && !path.relative(parent.source, root.source).startsWith("..") && !path.isAbsolute(path.relative(parent.source, root.source))))));
}
