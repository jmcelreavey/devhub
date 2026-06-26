/**
 * Shared context handed to every tool registrar. Holds the filesystem storage
 * layers (notes/docs/tasks/diagrams) and the dashboard HTTP client, so the
 * individual `tools/*.ts` modules stay free of wiring.
 */
import path from "node:path";
import { NotesStorage } from "./storage.ts";
import { TasksStorage, DiagramsStorage } from "./task-diagram-storage.ts";
import { VaultStorage, markdownVaultCodec, resolveContentDir } from "./shared.ts";
import { DashboardClient } from "./dashboard-client.ts";

export interface Context {
  notesDir: string;
  docsDir: string;
  tasksDir: string;
  storage: NotesStorage;
  docsStorage: VaultStorage;
  tasksStorage: TasksStorage;
  diagramsStorage: DiagramsStorage;
  dashboard: DashboardClient;
}

export function createContext(): Context {
  const repoRoot = process.env.REPO_ROOT || path.resolve(process.cwd(), "../..");
  const notesDir = process.env.NOTES_DIR || path.resolve(process.cwd(), "notes");
  const tasksDir = process.env.TASKS_DIR || path.resolve(process.cwd(), "tasks");
  const docsDir = resolveContentDir("DOCS_DIR", repoRoot, "docs");
  const baseUrl = process.env.DEVHUB_BASE_URL || "http://localhost:1337";

  const storage = new NotesStorage(notesDir);
  return {
    notesDir,
    docsDir,
    tasksDir,
    storage,
    docsStorage: new VaultStorage(docsDir, markdownVaultCodec),
    tasksStorage: new TasksStorage(tasksDir),
    diagramsStorage: new DiagramsStorage(storage),
    dashboard: new DashboardClient(baseUrl),
  };
}
