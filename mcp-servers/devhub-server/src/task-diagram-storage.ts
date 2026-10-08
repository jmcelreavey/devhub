import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NotesStorage } from "./storage.ts";
import { NOTE_SIZE, geoHeight, indexKeyAt, noteGrowY } from "./diagram-geometry.ts";
import { buildGraphRecords, type GraphSpec } from "./diagram-graph.ts";
import { normalizeTaskLinkState, taskNotePath } from "../../../shared/task-note/index.ts";
import { resolveStoredTaskNotes } from "../../../shared/task-note/resolve.ts";
// The shared type, not a hand-copied one. The local duplicate was missing the
// "tag" kind, so refs coming back from `normalizeTaskLinkState` no longer fit
// the field they were being written into.
import type { EntityRef } from "../../../shared/entity-note/index.ts";

export type { EntityRef };

import type { Task } from "../../../shared/tasks/types.ts";
import { todayISO } from "../../../shared/tasks/dates.ts";
import { migrateDirectory } from "../../../shared/tasks/migrate.ts";
import { createTask, deleteTask, listDays, patchTask, readItems, tasksOnDay } from "../../../shared/tasks/store.ts";
export type { Task } from "../../../shared/tasks/types.ts";

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

  constructor(tasksDir: string, private notesDir = path.join(path.dirname(tasksDir), "notes")) {
    this.dir = path.resolve(tasksDir);
  }

  /** Import legacy day files. Concurrent callers share one in-flight run. */
  ready(): Promise<void> {
    return migrateDirectory(this.dir, { runsDir: path.join(this.notesDir, ".config", "task-agent-runs") }).then(() => undefined);
  }

  resolveNotePath(task: Task, date: string): string {
    return resolveStoredTaskNotes(task, date, {
      readTask: (_sourceDate, id) => readItems(this.dir).find((item) => item.id === id || item.legacyIds?.includes(id)),
      noteExists: (notePath) => fs.existsSync(path.join(this.notesDir, `${notePath}.json`)),
    }).notePath;
  }

  private withNotePath(task: Task, date: string): Task {
    return { ...task, notePath: this.resolveNotePath(task, date) };
  }

  private summarize(date: string, tasks: Task[]): TaskDaySummary {
    return {
      date,
      total: tasks.length,
      completed: tasks.filter((task) => task.done).length,
      abandoned: tasks.filter((task) => !!task.abandonedAt).length,
      moved: tasks.filter((task) => task.endReason === "legacy-moved" && task.endDate === date).length,
    };
  }

  private canonical(id: string): Task | undefined {
    return readItems(this.dir).find((task) => task.id === id || task.legacyIds?.includes(id));
  }

  list(): TaskDaySummary[] {
    return listDays(this.dir, todayISO()).map(({ date, tasks }) => this.summarize(date, tasks));
  }

  getDay(date: string): TaskDay {
    const tasks = tasksOnDay(this.dir, date, todayISO()).map((task) => this.withNotePath(task, date));
    return { ...this.summarize(date, tasks), tasks };
  }

  getToday(): Task[] {
    return this.getDay(todayISO()).tasks;
  }

  add(text: string, date?: string, due?: string, stage?: "draft"): Task {
    const startDate = date || todayISO();
    const task = createTask(this.dir, { text, startDate, due, stage });
    return this.withNotePath(task, startDate);
  }

  update(
    taskId: string,
    patch: {
      text?: string;
      done?: boolean;
      due?: string | null;
      status?: "complete" | "abandon" | "reactivate";
      abandonReason?: string;
      links?: EntityRef[];
      stage?: "draft" | "ready";
    },
    date?: string,
  ): Task | null {
    const target = date || todayISO();
    const existing = this.canonical(taskId);
    if (!existing || !tasksOnDay(this.dir, target, todayISO()).some((task) => task.id === existing.id)) return null;
    const next: Parameters<typeof patchTask>[2] = {};
    if (typeof patch.text === "string") next.text = patch.text;
    if (patch.due !== undefined) next.due = patch.due;
    if (patch.stage) next.stage = patch.stage;
    if (patch.links !== undefined) {
      const normalized = normalizeTaskLinkState(next.text ?? existing.text, existing.jiraKey, patch.links);
      next.text = normalized.text;
      next.links = normalized.links?.length ? normalized.links : [];
      if (normalized.jiraKey) next.jiraKey = normalized.jiraKey;
    }
    if (patch.status === "complete" || patch.done === true) next.status = "complete";
    else if (patch.status === "abandon") {
      next.status = "abandon";
      next.abandonReason = patch.abandonReason;
    } else if (patch.status === "reactivate" || patch.done === false) next.status = "reactivate";
    const task = patchTask(this.dir, existing.id, next);
    return task ? this.withNotePath(task, target) : null;
  }

  delete(taskId: string, date?: string): boolean {
    const target = date || todayISO();
    const existing = tasksOnDay(this.dir, target, todayISO()).find((task) => task.id === taskId || task.legacyIds?.includes(taskId));
    if (!existing) return false;
    return deleteTask(this.dir, existing.id);
  }
}

export interface DiagramEntry {
  name: string;
  path: string;
  modified: number;
  size: number;
}

export interface AddDiagramNoteOptions {
  text: string;
  x?: number;
  y?: number;
  color?: string;
}

export interface AddedDiagramNote {
  path: string;
  shapeId: string;
  /** Placed geometry, so callers can lay out the next shape without guessing. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AddDiagramShapeOptions {
  text?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  color?: string;
  fill?: string;
  geo?: string;
}

export interface AddDiagramArrowOptions {
  from: string;
  to: string;
  text?: string;
  dashed?: boolean;
}

export interface DiagramShapeSummary {
  id: string;
  type: string;
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DiagramSummary {
  path: string;
  shapes: DiagramShapeSummary[];
  bounds: { x: number; y: number; w: number; h: number } | null;
  overlaps: Array<[string, string]>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const richTextFromText = (text: string): Record<string, unknown> => ({
  type: "doc",
  attrs: { dir: "auto" },
  content: text.split("\n").map((line) => ({
    type: "paragraph",
    attrs: { dir: "auto" },
    content: line ? [{ type: "text", text: line }] : [],
  })),
});

/** Inverse of `richTextFromText` — flattens a ProseMirror doc back to plain text. */
const textFromRichText = (richText: unknown): string => {
  if (!isRecord(richText) || !Array.isArray(richText.content)) return "";
  return richText.content
    .map((block) => {
      if (!isRecord(block) || !Array.isArray(block.content)) return "";
      return block.content
        .map((span) => (isRecord(span) && typeof span.text === "string" ? span.text : ""))
        .join("");
    })
    .join("\n");
};

const TLDRAW_SCHEMA = {
  schemaVersion: 2,
  sequences: {
    "com.tldraw.store": 5,
    "com.tldraw.asset": 1,
    "com.tldraw.camera": 1,
    "com.tldraw.document": 2,
    "com.tldraw.instance": 26,
    "com.tldraw.instance_page_state": 5,
    "com.tldraw.page": 1,
    "com.tldraw.instance_presence": 6,
    "com.tldraw.pointer": 1,
    "com.tldraw.shape": 4,
    "com.tldraw.user": 1,
    "com.tldraw.asset.image": 6,
    "com.tldraw.asset.video": 5,
    "com.tldraw.asset.bookmark": 2,
    "com.tldraw.shape.group": 0,
    "com.tldraw.shape.text": 4,
    "com.tldraw.shape.bookmark": 2,
    "com.tldraw.shape.draw": 4,
    "com.tldraw.shape.geo": 11,
    "com.tldraw.shape.note": 12,
    "com.tldraw.shape.line": 5,
    "com.tldraw.shape.frame": 1,
    "com.tldraw.shape.arrow": 8,
    "com.tldraw.shape.highlight": 3,
    "com.tldraw.shape.embed": 4,
    "com.tldraw.shape.image": 5,
    "com.tldraw.shape.video": 4,
    "com.tldraw.binding.arrow": 1,
  },
};

const createTldrawSnapshot = (store: Record<string, unknown> = {}): Record<string, unknown> => ({
  store,
  schema: TLDRAW_SCHEMA,
});

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
    this.notesStorage.write(fullPath, this.normalizeDiagramData(data));
    return true;
  }

  addNote(diagramPath: string, note: AddDiagramNoteOptions): AddedDiagramNote | null {
    const fullPath = this.resolve(diagramPath);
    const data = this.read(fullPath);
    if (!data) return null;

    const records = this.prepare(data);

    const shapeId = `shape:${randomUUID().replaceAll("-", "").slice(0, 20)}`;
    // tldraw never recomputes growY for a snapshot loaded from disk, so measure it here
    // or the text renders outside the 200px box and collides with the next note.
    const growY = noteGrowY(note.text);
    const height = NOTE_SIZE + growY;
    const { x, y } = this.nextShapePosition(records, NOTE_SIZE, height, note.x, note.y);
    const userId = Object.keys(records).find((key) => key.startsWith("user:"))?.slice("user:".length);

    records[shapeId] = {
      x,
      y,
      rotation: 0,
      isLocked: false,
      opacity: 1,
      meta: {},
      id: shapeId,
      type: "note",
      props: {
        color: note.color ?? "yellow",
        richText: richTextFromText(note.text),
        size: "m",
        font: "draw",
        align: "middle",
        verticalAlign: "middle",
        labelColor: "black",
        growY,
        fontSizeAdjustment: 1,
        url: "",
        scale: 1,
        textFirstEditedBy: userId ?? null,
      },
      parentId: "page:page",
      index: this.nextIndex(records),
      typeName: "shape",
    };

    this.notesStorage.write(fullPath, data);
    return { path: fullPath, shapeId, x, y, w: NOTE_SIZE, h: height };
  }

  addShape(diagramPath: string, shape: AddDiagramShapeOptions): AddedDiagramNote | null {
    const fullPath = this.resolve(diagramPath);
    const data = this.read(fullPath);
    if (!data) return null;

    const records = this.prepare(data);
    const text = shape.text ?? "";
    const w = shape.w ?? 260;
    const h = shape.h ?? geoHeight(text, w);
    const { x, y } = this.nextShapePosition(records, w, h, shape.x, shape.y);
    const shapeId = `shape:${randomUUID().replaceAll("-", "").slice(0, 20)}`;

    records[shapeId] = {
      x,
      y,
      rotation: 0,
      isLocked: false,
      opacity: 1,
      meta: {},
      id: shapeId,
      type: "geo",
      props: {
        geo: shape.geo ?? "rectangle",
        dash: "solid",
        url: "",
        w,
        h,
        growY: 0,
        scale: 1,
        labelColor: "black",
        color: shape.color ?? "blue",
        fill: shape.fill ?? "semi",
        size: "m",
        font: "draw",
        align: "middle",
        verticalAlign: "middle",
        richText: richTextFromText(text),
      },
      parentId: "page:page",
      index: this.nextIndex(records),
      typeName: "shape",
    };

    this.notesStorage.write(fullPath, data);
    return { path: fullPath, shapeId, x, y, w, h };
  }

  addArrow(diagramPath: string, arrow: AddDiagramArrowOptions): { path: string; shapeId: string } | null {
    const fullPath = this.resolve(diagramPath);
    const data = this.read(fullPath);
    if (!data) return null;

    const records = this.prepare(data);
    const from = records[arrow.from];
    const to = records[arrow.to];
    if (!isRecord(from) || !isRecord(to)) return null;

    const bounds = (shape: Record<string, unknown>) => {
      const props = isRecord(shape.props) ? shape.props : {};
      const isNote = shape.type === "note";
      const w = typeof props.w === "number" ? props.w : isNote ? NOTE_SIZE : 260;
      const growY = typeof props.growY === "number" ? props.growY : 0;
      const h = typeof props.h === "number" ? props.h : isNote ? NOTE_SIZE + growY : 100;
      const x = typeof shape.x === "number" ? shape.x : 0;
      const y = typeof shape.y === "number" ? shape.y : 0;
      return { x, y, w, h };
    };

    const a = bounds(from);
    const b = bounds(to);
    const shapeId = `shape:${randomUUID().replaceAll("-", "").slice(0, 20)}`;

    records[shapeId] = {
      x: a.x + a.w / 2,
      y: a.y + a.h / 2,
      rotation: 0,
      isLocked: false,
      opacity: 1,
      meta: {},
      id: shapeId,
      type: "arrow",
      props: {
        kind: "arc",
        labelColor: "black",
        color: "black",
        fill: "none",
        dash: arrow.dashed ? "dashed" : "draw",
        size: "s",
        arrowheadStart: "none",
        arrowheadEnd: "arrow",
        font: "draw",
        start: { x: 0, y: 0 },
        end: { x: b.x + b.w / 2 - (a.x + a.w / 2), y: b.y + b.h / 2 - (a.y + a.h / 2) },
        bend: 0,
        richText: richTextFromText(arrow.text ?? ""),
        labelPosition: 0.5,
        scale: 1,
        elbowMidPoint: 0.5,
      },
      parentId: "page:page",
      index: this.nextIndex(records),
      typeName: "shape",
    };

    // Bindings are what keep the arrow attached; start/end above are only a seed.
    for (const [terminal, target] of [
      ["start", arrow.from],
      ["end", arrow.to],
    ] as const) {
      const bindingId = `binding:${randomUUID().replaceAll("-", "").slice(0, 20)}`;
      records[bindingId] = {
        id: bindingId,
        typeName: "binding",
        type: "arrow",
        fromId: shapeId,
        toId: target,
        meta: {},
        props: {
          terminal,
          normalizedAnchor: { x: 0.5, y: 0.5 },
          isExact: false,
          isPrecise: false,
          snap: "none",
        },
      };
    }

    this.notesStorage.write(fullPath, data);
    return { path: fullPath, shapeId };
  }

  /**
   * Replace a diagram's contents with a laid-out graph. The caller supplies meaning
   * (nodes/edges/groups); layout and measurement stay here.
   */
  setGraph(diagramPath: string, spec: GraphSpec): { path: string; shapes: number } | null {
    const fullPath = this.resolve(diagramPath);
    const existing = this.read(fullPath);
    if (!existing) return null;

    const records: Record<string, unknown> = {};
    this.ensurePageRecords(records);
    Object.assign(records, buildGraphRecords(spec));

    const data = { type: "tldraw", version: 1, store: { store: records, schema: TLDRAW_SCHEMA } };
    this.notesStorage.write(fullPath, data);
    const shapes = Object.values(records).filter(
      (record) => isRecord(record) && record.typeName === "shape",
    ).length;
    return { path: fullPath, shapes };
  }

  /** Compact view of a diagram: shapes, text, bounds, and anything overlapping. */
  summarize(diagramPath: string): DiagramSummary | null {
    const fullPath = this.resolve(diagramPath);
    const data = this.read(fullPath);
    if (!data) return null;

    const records = this.storeRecords(data);
    const shapes: DiagramShapeSummary[] = [];

    for (const record of Object.values(records)) {
      if (!isRecord(record) || record.typeName !== "shape") continue;
      const props = isRecord(record.props) ? record.props : {};
      const isNote = record.type === "note";
      const growY = typeof props.growY === "number" ? props.growY : 0;
      shapes.push({
        id: typeof record.id === "string" ? record.id : "",
        type: typeof record.type === "string" ? record.type : "unknown",
        text: textFromRichText(props.richText),
        x: typeof record.x === "number" ? record.x : 0,
        y: typeof record.y === "number" ? record.y : 0,
        w: typeof props.w === "number" ? props.w : isNote ? NOTE_SIZE : 0,
        h: typeof props.h === "number" ? props.h + growY : isNote ? NOTE_SIZE + growY : 0,
      });
    }

    const boxes = shapes.filter((shape) => shape.w > 0 && shape.h > 0);
    const contains = (outer: DiagramShapeSummary, inner: DiagramShapeSummary): boolean =>
      outer.x <= inner.x &&
      outer.y <= inner.y &&
      outer.x + outer.w >= inner.x + inner.w &&
      outer.y + outer.h >= inner.y + inner.h;

    const overlaps: Array<[string, string]> = [];
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i];
        const b = boxes[j];
        const hit = a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
        // Containment is intentional — a lane band or boundary wraps its members.
        if (hit && !contains(a, b) && !contains(b, a)) overlaps.push([a.id, b.id]);
      }
    }

    const bounds =
      boxes.length === 0
        ? null
        : {
            x: Math.min(...boxes.map((s) => s.x)),
            y: Math.min(...boxes.map((s) => s.y)),
            w: Math.max(...boxes.map((s) => s.x + s.w)) - Math.min(...boxes.map((s) => s.x)),
            h: Math.max(...boxes.map((s) => s.y + s.h)) - Math.min(...boxes.map((s) => s.y)),
          };

    return { path: fullPath, shapes, bounds, overlaps };
  }

  /**
   * Recompute `growY` on every note in every diagram. Notes written before the tool
   * measured text carry `growY: 0` and render on top of their neighbours.
   */
  repairAll(): Array<{ path: string; repaired: number }> {
    const results: Array<{ path: string; repaired: number }> = [];
    for (const entry of this.list()) {
      const data = this.read(entry.path);
      if (!data) continue;
      const records = this.storeRecords(data);
      let repaired = 0;

      for (const record of Object.values(records)) {
        if (!isRecord(record) || record.typeName !== "shape" || record.type !== "note") continue;
        const props = this.ensureRecord(record, "props");
        const text = textFromRichText(props.richText);
        const size = props.size === "s" || props.size === "l" || props.size === "xl" ? props.size : "m";
        const growY = noteGrowY(text, size);
        if (props.growY !== growY) {
          props.growY = growY;
          repaired += 1;
        }
      }

      if (repaired > 0) {
        this.notesStorage.write(entry.path, this.normalizeDiagramData(data));
        results.push({ path: entry.path, repaired });
      }
    }
    return results;
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
    // Preserve the diagram's folder — rename in place rather than yanking it to
    // the diagrams root (keeps the MCP consistent with the dashboard).
    const slashIndex = fullPath.lastIndexOf("/");
    const parent = slashIndex === -1 ? "diagrams" : fullPath.slice(0, slashIndex);
    const newPath = `${parent}/${cleanName}`;

    if (fullPath === newPath) return fullPath;

    this.notesStorage.write(newPath, existing.content);
    this.notesStorage.delete(fullPath);
    return newPath;
  }

  private ensureRecord(parent: Record<string, unknown>, key: string): Record<string, unknown> {
    const value = parent[key];
    if (isRecord(value)) return value;
    const created: Record<string, unknown> = {};
    parent[key] = created;
    return created;
  }

  private normalizeDiagramData(data: unknown): unknown {
    if (!isRecord(data) || data.type !== "tldraw") return data;
    const outerStore = this.ensureRecord(data, "store");
    const records = this.ensureRecord(outerStore, "store");
    outerStore.schema ??= TLDRAW_SCHEMA;
    this.ensurePageRecords(records);
    this.ensureNoteShapeProps(records);
    return data;
  }

  private ensureNoteShapeProps(records: Record<string, unknown>): void {
    for (const record of Object.values(records)) {
      if (!isRecord(record) || record.typeName !== "shape" || record.type !== "note") continue;
      const props = this.ensureRecord(record, "props");
      if (typeof props.textFirstEditedBy !== "string" && props.textFirstEditedBy !== null) {
        props.textFirstEditedBy = null;
      }
    }
  }

  private ensurePageRecords(records: Record<string, unknown>): void {
    records["page:page"] ??= { meta: {}, id: "page:page", name: "Page 1", index: "a1", typeName: "page" };
    records["document:document"] ??= {
      gridSize: 10,
      name: "",
      meta: {},
      id: "document:document",
      typeName: "document",
    };
  }

  private resolve(diagramPath: string): string {
    return diagramPath.startsWith("diagrams/") ? diagramPath : `diagrams/${diagramPath}`;
  }

  /** Ensure the snapshot has the records tldraw needs, and hand back the record map. */
  private prepare(data: Record<string, unknown>): Record<string, unknown> {
    const outerStore = this.ensureRecord(data, "store");
    const records = this.ensureRecord(outerStore, "store");
    outerStore.schema ??= TLDRAW_SCHEMA;
    this.ensurePageRecords(records);
    this.ensureNoteShapeProps(records);
    return records;
  }

  private storeRecords(data: Record<string, unknown>): Record<string, unknown> {
    const outerStore = isRecord(data.store) ? data.store : {};
    return isRecord(outerStore.store) ? outerStore.store : {};
  }

  private shapeBox(shape: Record<string, unknown>): { x: number; y: number; w: number; h: number } | null {
    const props = isRecord(shape.props) ? shape.props : {};
    const isNote = shape.type === "note";
    const growY = typeof props.growY === "number" ? props.growY : 0;
    const w = typeof props.w === "number" ? props.w : isNote ? NOTE_SIZE : 0;
    const h = typeof props.h === "number" ? props.h + growY : isNote ? NOTE_SIZE + growY : 0;
    if (w <= 0 || h <= 0) return null;
    return { x: typeof shape.x === "number" ? shape.x : 0, y: typeof shape.y === "number" ? shape.y : 0, w, h };
  }

  /**
   * Column packing against the boxes already on the page, using each shape's real
   * height. Explicit coordinates always win; otherwise we fill a column downwards and
   * start a new one once it passes `COLUMN_HEIGHT`, so adding N shapes yields a grid
   * rather than one endless row.
   */
  private nextShapePosition(
    records: Record<string, unknown>,
    w: number,
    h: number,
    x?: number,
    y?: number,
  ): { x: number; y: number } {
    if (x !== undefined && y !== undefined) return { x, y };

    const COLUMN_HEIGHT = 900;
    const GUTTER = 48;
    const boxes = Object.values(records)
      .filter((record): record is Record<string, unknown> => isRecord(record) && record.typeName === "shape")
      .map((shape) => this.shapeBox(shape))
      .filter((box): box is { x: number; y: number; w: number; h: number } => box !== null);

    if (boxes.length === 0) return { x: x ?? 0, y: y ?? 0 };

    const top = Math.min(...boxes.map((box) => box.y));
    const columnX = Math.max(...boxes.map((box) => box.x));
    const column = boxes.filter((box) => box.x === columnX);
    const columnBottom = Math.max(...column.map((box) => box.y + box.h));

    // Room left in the current column?
    if (columnBottom + GUTTER + h <= top + COLUMN_HEIGHT) {
      return { x: x ?? columnX, y: y ?? columnBottom + GUTTER };
    }

    const rightEdge = Math.max(...boxes.map((box) => box.x + box.w));
    return { x: x ?? rightEdge + GUTTER, y: y ?? top };
  }

  private nextIndex(records: Record<string, unknown>): string {
    const shapeCount = Object.values(records).filter(
      (record) => isRecord(record) && record.typeName === "shape",
    ).length;
    return indexKeyAt(shapeCount);
  }
}
