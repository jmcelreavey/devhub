import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NotesStorage } from "./storage.ts";

// keep in sync with dashboard/lib/tasks-storage.ts Task
export interface Task {
  id: string;
  text: string;
  done: boolean;
  jiraKey?: string;
  due?: string;
  createdAt: string;
  completedAt?: string;
  abandonedAt?: string;
  abandonReason?: string;
  movedAt?: string;
  movedToDate?: string;
  timeSpentMs?: number;
  timerStartedAt?: string;
}

export interface TaskDaySummary {
  date: string;
  total: number;
  completed: number;
  abandoned: number;
  moved: number;
}

export interface TaskDay extends TaskDaySummary {
  tasks: Task[];
}

export class TasksStorage {
  private dir: string;

  constructor(tasksDir: string) {
    this.dir = path.resolve(tasksDir);
  }

  private file(date: string): string {
    return path.join(this.dir, `${date}.json`);
  }

  private read(date: string): Task[] {
    const fp = this.file(date);
    if (!fs.existsSync(fp)) return [];
    try {
      return JSON.parse(fs.readFileSync(fp, "utf-8"));
    } catch {
      return [];
    }
  }

  private write(date: string, tasks: Task[]): void {
    if (!fs.existsSync(this.dir)) {
      fs.mkdirSync(this.dir, { recursive: true });
    }
    const tmp = `${this.file(date)}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(tasks, null, 2));
    fs.renameSync(tmp, this.file(date));
  }

  list(): TaskDaySummary[] {
    if (!fs.existsSync(this.dir)) return [];
    return fs
      .readdirSync(this.dir)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .reverse()
      .map((f) => {
        const date = f.replace(".json", "");
        const tasks = this.read(date);
        return {
          date,
          total: tasks.length,
          completed: tasks.filter((t) => t.done).length,
          abandoned: tasks.filter((t) => !!t.abandonedAt).length,
          moved: tasks.filter((t) => !!t.movedAt).length,
        };
      });
  }

  getDay(date: string): TaskDay {
    const tasks = this.read(date);
    return {
      date,
      total: tasks.length,
      completed: tasks.filter((t) => t.done).length,
      abandoned: tasks.filter((t) => !!t.abandonedAt).length,
      moved: tasks.filter((t) => !!t.movedAt).length,
      tasks,
    };
  }

  getToday(): Task[] {
    return this.read(this.todayISO());
  }

  add(text: string, date?: string, due?: string): Task {
    const target = date || this.todayISO();
    const tasks = this.read(target);
    const jiraKey = text.match(/\b([A-Z][A-Z0-9]+-\d+)\b/)?.[1];
    const task: Task = {
      id: randomUUID(),
      text,
      done: false,
      jiraKey,
      due,
      createdAt: new Date().toISOString(),
    };
    tasks.push(task);
    this.write(target, tasks);
    return task;
  }

  update(
    taskId: string,
    patch: {
      text?: string;
      done?: boolean;
      due?: string | null;
      status?: "complete" | "abandon" | "reactivate";
      abandonReason?: string;
    },
    date?: string,
  ): Task | null {
    const target = date || this.todayISO();
    const tasks = this.read(target);
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return null;

    if (typeof patch.text === "string") {
      task.text = patch.text;
      task.jiraKey = patch.text.match(/\b([A-Z][A-Z0-9]+-\d+)\b/)?.[1];
    }
    if (typeof patch.done === "boolean") {
      task.done = patch.done;
      task.completedAt = patch.done ? new Date().toISOString() : undefined;
      if (patch.done) {
        task.abandonedAt = undefined;
        task.abandonReason = undefined;
      }
    }
    if (patch.due === null) {
      task.due = undefined;
    } else if (typeof patch.due === "string") {
      task.due = patch.due;
    }
    if (patch.status === "complete") {
      task.done = true;
      task.completedAt = new Date().toISOString();
      task.abandonedAt = undefined;
      task.abandonReason = undefined;
    }
    if (patch.status === "abandon") {
      task.done = false;
      task.completedAt = undefined;
      task.abandonedAt = new Date().toISOString();
      task.abandonReason = patch.abandonReason || undefined;
    }
    if (patch.status === "reactivate") {
      task.done = false;
      task.completedAt = undefined;
      task.abandonedAt = undefined;
      task.abandonReason = undefined;
    }

    this.write(target, tasks);
    return task;
  }

  delete(taskId: string, date?: string): boolean {
    const target = date || this.todayISO();
    const tasks = this.read(target);
    const idx = tasks.findIndex((t) => t.id === taskId);
    if (idx === -1) return false;
    tasks.splice(idx, 1);
    this.write(target, tasks);
    return true;
  }

  private todayISO(): string {
    return new Date().toISOString().split("T")[0];
  }
}

export interface DiagramEntry {
  name: string;
  path: string;
  modified: number;
  size: number;
}

export class DiagramsStorage {
  private notesStorage: NotesStorage;

  constructor(notesStorage: NotesStorage) {
    this.notesStorage = notesStorage;
  }

  list(): DiagramEntry[] {
    const tree = this.notesStorage.list("diagrams");
    const entries: DiagramEntry[] = [];

    const flatten = (items: typeof tree): void => {
      for (const item of items) {
        if (item.type === "file" && item.name.endsWith(".json")) {
          entries.push({
            name: item.name.replace(/\.json$/, ""),
            path: item.path,
            modified: item.modified ?? 0,
            size: item.size ?? 0,
          });
        }
        if (item.children) flatten(item.children);
      }
    };

    flatten(tree);
    return entries.sort((a, b) => b.modified - a.modified);
  }

  read(diagramPath: string): Record<string, unknown> | null {
    const fullPath = diagramPath.startsWith("diagrams/")
      ? diagramPath
      : `diagrams/${diagramPath}`;
    const result = this.notesStorage.readRaw(fullPath);
    if (!result) return null;
    try {
      return JSON.parse(result);
    } catch {
      return null;
    }
  }

  create(name?: string): { path: string; data: Record<string, unknown> } {
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    const time = now.toTimeString().slice(0, 8).replace(/:/g, "");
    const storagePath = name
      ? `diagrams/${name}`
      : `diagrams/${day}-${time}-diagram`;

    const data = {
      type: "tldraw",
      version: 1,
      store: {},
    };

    this.notesStorage.write(storagePath, data);
    return { path: storagePath, data };
  }

  update(diagramPath: string, data: unknown): boolean {
    const fullPath = diagramPath.startsWith("diagrams/")
      ? diagramPath
      : `diagrams/${diagramPath}`;
    const existing = this.notesStorage.read(fullPath);
    if (!existing) return false;
    this.notesStorage.write(fullPath, data);
    return true;
  }

  delete(diagramPath: string): boolean {
    const fullPath = diagramPath.startsWith("diagrams/")
      ? diagramPath
      : `diagrams/${diagramPath}`;
    return this.notesStorage.delete(fullPath);
  }

  rename(oldPath: string, newName: string): string | null {
    const fullPath = oldPath.startsWith("diagrams/") ? oldPath : `diagrams/${oldPath}`;
    const existing = this.notesStorage.read(fullPath);
    if (!existing) return null;

    const cleanName = newName.replace(/\.json$/, "");
    const newPath = `diagrams/${cleanName}`;

    if (fullPath === newPath) return fullPath;

    this.notesStorage.write(newPath, existing.content);
    this.notesStorage.delete(fullPath);
    return newPath;
  }
}
