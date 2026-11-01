import { z } from "zod";
import { defineAction } from "./define.ts";
import { notesCreate, notesWrite, type NoteFile, type NotesReader, type NotesDeleter, notesDelete, type NotesWriteContext, type NotesWriteResult } from "./notes.ts";

export interface DiagramSummary {
  path: string;
  shapes: Array<{ id: string; type: string; text: string; x: number; y: number; w: number; h: number }>;
  bounds: { x: number; y: number; w: number; h: number } | null;
  overlaps: Array<[string, string]>;
}

export type DiagramReadContext =
  | { mode: "http"; storage: NotesReader }
  | { mode: "mcp"; storage: { read: (path: string) => Record<string, unknown> | null; summarize: (path: string) => DiagramSummary | null } };

export type DiagramReadResult =
  | { mode: "http"; file: NoteFile | null }
  | { mode: "mcp"; raw: true; path: string; data: Record<string, unknown> | null }
  | { mode: "mcp"; raw: false; path: string; summary: DiagramSummary | null };

const diagramReadInput = z.object({
  path: z.string().describe("Diagram path (e.g. 'diagrams/2026-05-13-diagram')"),
  raw: z.boolean().optional().describe("Return the full tldraw JSON instead of the summary"),
}).meta({ additionalProperties: false });

export const diagramRead = defineAction<typeof diagramReadInput, DiagramReadContext, DiagramReadResult>({
  input: diagramReadInput,
  http: { method: "GET", path: "/api/notes/[...path]", discriminator: "path starts with diagrams/" },
  mcp: { name: "diagrams_read", toolset: "diagrams", description: "Read a diagram. Returns a compact summary — each shape's id, type, text, position and size, plus overall bounds and any overlapping pairs. Pass raw:true only when you need the full tldraw JSON (it is large)." },
  handler: ({ path, raw }, context) => {
    if (context.mode === "http") return { mode: "http", file: context.storage.read(path) };
    if (raw) return { mode: "mcp", raw: true, path, data: context.storage.read(path) };
    return { mode: "mcp", raw: false, path, summary: context.storage.summarize(path) };
  },
});

export type DiagramUpdateContext =
  | { mode: "http"; notes: NotesWriteContext }
  | { mode: "mcp"; storage: { update: (path: string, data: unknown) => boolean } };

export type DiagramUpdateResult =
  | { mode: "http"; result: NotesWriteResult }
  | { mode: "mcp"; path: string; updated: boolean }
  | { mode: "invalid" };

const diagramUpdateInput = z.object({
  path: z.string().describe("Diagram path"),
  data: z.string().describe("tldraw JSON data as a string"),
}).meta({ additionalProperties: false });

export const diagramUpdate = defineAction<typeof diagramUpdateInput, DiagramUpdateContext, DiagramUpdateResult>({
  input: diagramUpdateInput,
  http: { method: "PUT", path: "/api/notes/[...path]", discriminator: "path starts with diagrams/" },
  mcp: { name: "diagrams_update", toolset: "diagrams", description: "Update a diagram with new tldraw JSON data." },
  handler: async ({ path, data }, context) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return { mode: "invalid" };
    }
    if (context.mode === "http") return { mode: "http", result: await notesWrite.handler({ path, content: data }, context.notes) };
    return { mode: "mcp", path, updated: context.storage.update(path, parsed) };
  },
});

const diagramDeleteInput = z.object({
  path: z.string().describe("Diagram path to delete"),
}).meta({ additionalProperties: false });

export const diagramDelete = defineAction<typeof diagramDeleteInput, NotesDeleter, { path: string; deleted: boolean }>({
  input: diagramDeleteInput,
  http: { method: "DELETE", path: "/api/notes/[...path]", discriminator: "path starts with diagrams/" },
  mcp: { name: "diagrams_delete", toolset: "diagrams", description: "Delete a diagram." },
  handler: (input, storage) => notesDelete.handler(input, storage),
});

const diagramGraphInput = z.object({
  path: z.string().describe("Diagram path"),
  title: z.string().optional().describe("Optional title rendered above the graph"),
  direction: z.enum(["right", "down"]).optional().describe("Flow direction, defaults to right"),
  nodes: z.array(z.object({
    id: z.string().describe("Stable id referenced by edges"),
    label: z.string().describe("Box text. Keep to a few short lines."),
    group: z.string().optional().describe("Optional group id; members get a labelled boundary"),
    color: z.string().optional().describe("tldraw colour"),
  })).describe("The boxes in the diagram"),
  edges: z.array(z.object({
    from: z.string().describe("Source node id"),
    to: z.string().describe("Target node id"),
    label: z.string().optional().describe("Optional edge label. Keep it to one or two short words — tldraw wraps arrow labels to a fraction of the arrow length and will break longer text mid-word."),
    dashed: z.boolean().optional().describe("Draw dashed, e.g. for async or optional paths"),
  })).optional().describe("Connections; these also determine the layering"),
  groups: z.array(z.object({
    id: z.string().describe("Group id referenced by nodes"),
    label: z.string().optional().describe("Boundary label"),
    color: z.string().optional().describe("tldraw colour"),
  })).optional().describe("Optional boundary boxes drawn behind their member nodes"),
}).meta({ additionalProperties: false });

type DiagramGraphSpec = Omit<z.output<typeof diagramGraphInput>, "path">;
interface DiagramGraphStorage {
  setGraph: (path: string, spec: DiagramGraphSpec) => { path: string; shapes: number } | null;
}

export const diagramSetGraph = defineAction<typeof diagramGraphInput, DiagramGraphStorage, { path: string; result: { path: string; shapes: number } | null }>({
  input: diagramGraphInput,
  http: { reason: "Graph layout is an MCP-only operation; the notes API saves the resulting snapshot." },
  mcp: { name: "diagrams_set_graph", toolset: "diagrams", description: "Replace a diagram with a laid-out graph. Describe the system as nodes and edges and the tool handles layout, text measurement and arrow binding. This is the right tool for architecture, flow and sequence diagrams — prefer it over placing notes by hand, which cannot account for rendered text size." },
  handler: ({ path, ...spec }, storage) => ({ path, result: storage.setGraph(path, spec) }),
});

const emptyInput = z.object({}).meta({ additionalProperties: false });
type DiagramEntry = { name: string; path: string; modified: number; size: number };

export const diagramList = defineAction<typeof emptyInput, { list: () => DiagramEntry[] }, DiagramEntry[]>({
  input: emptyInput,
  http: { reason: "The notes tree API lists diagram files alongside other notes." },
  mcp: { name: "diagrams_list", toolset: "diagrams", description: "List all diagrams. Returns names, paths, and last modified dates." },
  handler: (_input, storage) => storage.list(),
});

const diagramPreviewsInput = z.object({
  paths: z.array(z.string().min(1).max(500)).min(1).max(200),
}).meta({ additionalProperties: false });

export const diagramPreviews = defineAction<typeof diagramPreviewsInput, { previews: (paths: string[]) => Record<string, unknown> }, Record<string, unknown>>({
  input: diagramPreviewsInput,
  http: { method: "POST", path: "/api/diagrams/previews" },
  mcp: { reason: "Diagram thumbnail previews are an HTTP-only dashboard presentation detail." },
  handler: ({ paths }, context) => context.previews(paths),
});

const diagramCreateInput = z.object({
  name: z.string().optional().describe("Custom name for the diagram, auto-generated if omitted. May include a folder path, e.g. 'Acme/Reports/matching'."),
  content: z.string().optional().describe("JSON snapshot used by the HTTP notes API."),
}).meta({ additionalProperties: false });

export type DiagramCreateContext =
  | { mode: "http"; notes: NotesWriteContext }
  | { mode: "mcp"; storage: { create: (name?: string) => { path: string; data: Record<string, unknown> } } };
export type DiagramCreateResult =
  | { mode: "http"; result: NotesWriteResult }
  | { mode: "mcp"; path: string };

export const diagramCreate = defineAction<typeof diagramCreateInput, DiagramCreateContext, DiagramCreateResult>({
  input: diagramCreateInput,
  http: { method: "POST", path: "/api/notes/[...path]", discriminator: "path starts with diagrams/" },
  mcp: { name: "diagrams_create", toolset: "diagrams", description: "Create a new empty tldraw diagram. Use a slash in the name to place it in a folder (folders are created automatically)." },
  handler: async ({ name, content }, context) => {
    if (context.mode === "http") {
      if (content === undefined) throw new Error("Diagram content is required");
      return { mode: "http", result: await notesCreate.handler({ path: name ?? "", content }, context.notes) };
    }
    return { mode: "mcp", path: context.storage.create(name).path };
  },
});

export const diagramRepair = defineAction<typeof emptyInput, { repairAll: () => Array<{ path: string; repaired: number }> }, Array<{ path: string; repaired: number }>>({
  input: emptyInput,
  http: { reason: "Bulk repair is an MCP-only operation." },
  mcp: { name: "diagrams_repair", toolset: "diagrams", description: "Recompute note sizing across all diagrams. Notes written before the tool measured text carry growY:0 and render on top of their neighbours; this fixes them in place." },
  handler: (_input, storage) => storage.repairAll(),
});

const diagramRenameInput = z.object({
  path: z.string().describe("Current diagram path, e.g. 'diagrams/Acme/Reports/matching'"),
  newName: z.string().describe("New base name only (no folder path); the diagram stays in its current folder"),
}).meta({ additionalProperties: false });

export const diagramRename = defineAction<typeof diagramRenameInput, { rename: (path: string, name: string) => string | null }, { path: string; newPath: string | null }>({
  input: diagramRenameInput,
  http: { reason: "The notes API renames arbitrary vault paths and folders rather than diagram basenames." },
  mcp: { name: "diagrams_rename", toolset: "diagrams", description: "Rename a diagram in place, keeping it in its current folder." },
  handler: ({ path, newName }, storage) => ({ path, newPath: storage.rename(path, newName) }),
});

type AddedShape = { path: string; shapeId: string; x: number; y: number; w: number; h: number };
const diagramAddNoteInput = z.object({
  path: z.string().describe("Diagram path"),
  text: z.string().describe("Note text. Use newlines for separate note lines."),
  x: z.number().optional().describe("Optional x coordinate"),
  y: z.number().optional().describe("Optional y coordinate"),
  color: z.string().optional().describe("Optional tldraw note color, defaults to yellow"),
}).meta({ additionalProperties: false });
type DiagramNote = Omit<z.output<typeof diagramAddNoteInput>, "path">;
export const diagramAddNote = defineAction<typeof diagramAddNoteInput, { addNote: (path: string, note: DiagramNote) => AddedShape | null }, { path: string; result: AddedShape | null }>({
  input: diagramAddNoteInput,
  http: { reason: "Adding an individual shape is an MCP-only operation; HTTP saves the full snapshot." },
  mcp: { name: "diagrams_add_note", toolset: "diagrams", description: "Add a sticky note shape to a diagram. Use when the user asks to add a note, comment, TODO, or reminder to a diagram." },
  handler: ({ path, ...note }, storage) => ({ path, result: storage.addNote(path, note) }),
});

const diagramAddShapeInput = z.object({
  path: z.string().describe("Diagram path"),
  text: z.string().optional().describe("Label text. Use newlines for separate lines."),
  x: z.number().optional().describe("Optional x coordinate"),
  y: z.number().optional().describe("Optional y coordinate"),
  w: z.number().optional().describe("Width, defaults to 260"),
  h: z.number().optional().describe("Height, defaults to a measured fit around the text"),
  color: z.string().optional().describe("tldraw colour, defaults to blue"),
  fill: z.string().optional().describe("none | semi | solid | pattern, defaults to semi"),
  geo: z.string().optional().describe("rectangle | ellipse | diamond | hexagon | oval, defaults to rectangle"),
}).meta({ additionalProperties: false });
type DiagramShape = Omit<z.output<typeof diagramAddShapeInput>, "path">;
export const diagramAddShape = defineAction<typeof diagramAddShapeInput, { addShape: (path: string, shape: DiagramShape) => AddedShape | null }, { path: string; result: AddedShape | null }>({
  input: diagramAddShapeInput,
  http: { reason: "Adding an individual shape is an MCP-only operation; HTTP saves the full snapshot." },
  mcp: { name: "diagrams_add_shape", toolset: "diagrams", description: "Add a box (or other geo shape) with a text label. Height is measured from the text unless you pass one. Use for architecture boxes — unlike sticky notes these have explicit width and height and can be connected with arrows." },
  handler: ({ path, ...shape }, storage) => ({ path, result: storage.addShape(path, shape) }),
});

const diagramAddArrowInput = z.object({
  path: z.string().describe("Diagram path"),
  from: z.string().describe("Source shape id, e.g. 'shape:abc123'"),
  to: z.string().describe("Target shape id"),
  text: z.string().optional().describe("Optional label on the arrow"),
  dashed: z.boolean().optional().describe("Draw the arrow dashed"),
}).meta({ additionalProperties: false });
type DiagramArrow = Omit<z.output<typeof diagramAddArrowInput>, "path">;
export const diagramAddArrow = defineAction<typeof diagramAddArrowInput, { addArrow: (path: string, arrow: DiagramArrow) => { path: string; shapeId: string } | null }, { from: string; to: string; result: { path: string; shapeId: string } | null }>({
  input: diagramAddArrowInput,
  http: { reason: "Adding an individual arrow is an MCP-only operation; HTTP saves the full snapshot." },
  mcp: { name: "diagrams_add_arrow", toolset: "diagrams", description: "Connect two existing shapes with an arrow. Pass the shape ids returned by diagrams_add_shape / diagrams_add_note (or listed by diagrams_read). The arrow is bound to both shapes, so it follows them when they move." },
  handler: ({ path, ...arrow }, storage) => ({ from: arrow.from, to: arrow.to, result: storage.addArrow(path, arrow) }),
});
