/**
 * Shared context handed to every tool registrar. Holds the filesystem storage
 * layers (notes/docs/tasks/diagrams) and the dashboard HTTP client, so the
 * individual `tools/*.ts` modules stay free of wiring.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NotesStorage } from "./storage.ts";
import { TasksStorage, DiagramsStorage } from "./task-diagram-storage.ts";
import { VaultStorage, markdownVaultCodec, resolveContentDir } from "./shared.ts";
import { DashboardClient } from "./dashboard-client.ts";
import { resolveDashboard, type ResolvedDashboard } from "./discover-dashboard.ts";

export interface Context {
  notesDir: string;
  docsDir: string;
  tasksDir: string;
  storage: NotesStorage;
  docsStorage: VaultStorage;
  tasksStorage: TasksStorage;
  diagramsStorage: DiagramsStorage;
  dashboard: DashboardClient;
  /** How the dashboard was found, and what that instance says it can serve. */
  dashboardInfo: ResolvedDashboard;
}

export function createContext(): Context {
  const sourceDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = process.env.REPO_ROOT || path.resolve(sourceDir, "../../..");
  const notesDir = resolveContentDir("NOTES_DIR", repoRoot, "notes");
  const tasksDir = resolveContentDir("TASKS_DIR", repoRoot, "tasks");
  const docsDir = resolveContentDir("DOCS_DIR", repoRoot, "docs");
  // Discovered rather than assumed: the dashboard advertises its port, so a
  // checkout on a free port is reachable and a stale packaged build on 1337
  // can be recognised instead of silently 404-ing every newer tool.
  const dashboardInfo = resolveDashboard();

  const storage = new NotesStorage(notesDir);
  return {
    notesDir,
    docsDir,
    tasksDir,
    storage,
    docsStorage: new VaultStorage(docsDir, markdownVaultCodec),
    tasksStorage: new TasksStorage(tasksDir),
    diagramsStorage: new DiagramsStorage(storage),
    dashboard: new DashboardClient(dashboardInfo.baseUrl),
    dashboardInfo,
  };
}
