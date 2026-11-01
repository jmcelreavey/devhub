import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Context } from "../context.ts";
import { diagramAddArrow, diagramAddNote, diagramAddShape, diagramCreate, diagramDelete, diagramList, diagramRead, diagramRename, diagramRepair, diagramSetGraph, diagramUpdate } from "../../../../packages/shared/actions/diagrams.ts";
import { registerAction } from "../actions/register.ts";
import type { DiagramsStorage } from "../task-diagram-storage.ts";
import { z } from "zod";
import { ContentConflictError } from "../../../../packages/shared/storage/content.ts";
import { readNote } from "../content-storage.ts";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

async function withContentErrors(operation: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try { return await operation(); }
  catch (error) {
    if (!(error instanceof ContentConflictError)) throw error;
    return { content: [{ type: "text", text: "Conflict: diagram changed. Read it again before writing." }], isError: true };
  }
}

export function registerDiagramsTools(server: McpServer, ctx: Context): void {
  const { diagramsStorage } = ctx;

  registerAction(server, diagramList, diagramsStorage, (diagrams) => {
      if (diagrams.length === 0) {
        return { content: [{ type: "text", text: "No diagrams found" }] };
      }
      const lines = diagrams.map(
        (d) => `${d.path} (modified: ${new Date(d.modified).toISOString().split("T")[0]})`,
      );
      return { content: [{ type: "text", text: `Diagrams:\n${lines.join("\n")}` }] };
  });

  registerAction(server, { ...diagramRead, handler: async ({ path, raw }: Parameters<typeof diagramRead.handler>[0], storage: DiagramsStorage) => {
    const fullPath = path.startsWith("diagrams/") ? path : `diagrams/${path}`;
    const file = await readNote(ctx.noteContent, fullPath);
    const data = file?.content && typeof file.content === "object" && !Array.isArray(file.content)
      ? file.content as Record<string, unknown> : null;
    return { path, raw: Boolean(raw), data, summary: data ? storage.summarize(path, data) : null, revision: file?.revision ?? null };
  } }, diagramsStorage, (result) => {
      if (result.raw) {
        if (!result.data) return { content: [{ type: "text", text: `Diagram not found: ${result.path}` }] };
        return { content: [{ type: "text", text: `Revision: ${result.revision}\n${JSON.stringify(result.data)}` }] };
      }

      const { summary } = result;
      if (!summary) {
        return { content: [{ type: "text", text: `Diagram not found: ${result.path}` }] };
      }

      const lines = summary.shapes.map((shape) => {
        const label = shape.text.replace(/\n/g, " / ").slice(0, 80);
        return `${shape.id} ${shape.type} at (${Math.round(shape.x)}, ${Math.round(shape.y)}) ${Math.round(shape.w)}x${Math.round(shape.h)}${label ? ` — ${label}` : ""}`;
      });
      const bounds = summary.bounds
        ? `bounds: (${Math.round(summary.bounds.x)}, ${Math.round(summary.bounds.y)}) ${Math.round(summary.bounds.w)}x${Math.round(summary.bounds.h)}`
        : "bounds: empty";
      const overlaps =
        summary.overlaps.length === 0
          ? "overlaps: none"
          : `overlaps (${summary.overlaps.length}): ${summary.overlaps.map(([a, b]) => `${a}/${b}`).join(", ")}`;

      return {
        content: [
          {
            type: "text",
            text: `${summary.path}\nRevision: ${result.revision}\n${bounds}\n${overlaps}\n\n${lines.join("\n") || "(no shapes)"}`,
          },
        ],
      };
  });

  registerAction(server, { ...diagramCreate, handler: async ({ name }: Parameters<typeof diagramCreate.handler>[0], storage: DiagramsStorage) => ({ mode: "mcp" as const, path: (await storage.create(name)).path }) }, diagramsStorage, (result) => {
    if (result.mode !== "mcp") throw new Error("Unexpected diagram create result");
    return { content: [{ type: "text", text: `Created diagram: ${result.path}` }] };
  });

  registerAction(server, { ...diagramUpdate, input: diagramUpdate.input.extend({ expectedRevision: z.string().describe("Revision from diagrams_read") }), handler: async ({ path, data, expectedRevision }: Parameters<typeof diagramUpdate.handler>[0] & { expectedRevision: string }, storage: DiagramsStorage) => {
    let parsed: unknown;
    try { parsed = JSON.parse(data); } catch { return { mode: "invalid" as const }; }
    return { mode: "mcp" as const, path, updated: await storage.update(path, parsed, expectedRevision) };
  } }, diagramsStorage, (result) => {
    if (result.mode === "invalid") return { content: [{ type: "text", text: "Invalid JSON data" }] };
    if (result.mode !== "mcp") throw new Error("Unexpected diagram update result");
    return { content: [{ type: "text", text: result.updated ? `Updated: ${result.path}` : `Diagram not found: ${result.path}` }] };
  }, withContentErrors);

  registerAction(server, { ...diagramAddNote, handler: async ({ path, ...note }: Parameters<typeof diagramAddNote.handler>[0], storage: DiagramsStorage) => ({ path, result: await storage.addNote(path, note) }) }, diagramsStorage, ({ path: diagramPath, result }) => {
      if (!result) {
        return { content: [{ type: "text", text: `Diagram not found: ${diagramPath}` }] };
      }
      return {
        content: [
          {
            type: "text",
            text: `Added note ${result.shapeId} to ${result.path} at (${result.x}, ${result.y}), ${result.w}x${result.h}`,
          },
        ],
      };
  });

  registerAction(server, { ...diagramAddShape, handler: async ({ path, ...shape }: Parameters<typeof diagramAddShape.handler>[0], storage: DiagramsStorage) => ({ path, result: await storage.addShape(path, shape) }) }, diagramsStorage, ({ path: diagramPath, result }) => {
      if (!result) {
        return { content: [{ type: "text", text: `Diagram not found: ${diagramPath}` }] };
      }
      return {
        content: [
          {
            type: "text",
            text: `Added shape ${result.shapeId} to ${result.path} at (${result.x}, ${result.y}), ${result.w}x${result.h}`,
          },
        ],
      };
  });

  registerAction(server, { ...diagramAddArrow, handler: async ({ path, ...arrow }: Parameters<typeof diagramAddArrow.handler>[0], storage: DiagramsStorage) => ({ from: arrow.from, to: arrow.to, result: await storage.addArrow(path, arrow) }) }, diagramsStorage, ({ from, to, result }) => {
      if (!result) {
        return {
          content: [
            { type: "text", text: `Diagram not found, or one of the shapes does not exist: ${from} -> ${to}` },
          ],
        };
      }
      return { content: [{ type: "text", text: `Added arrow ${result.shapeId} to ${result.path}` }] };
  });

  registerAction(server, { ...diagramSetGraph, input: diagramSetGraph.input.extend({ expectedRevision: z.string().describe("Revision from diagrams_read") }), handler: async ({ path, expectedRevision, ...spec }: Parameters<typeof diagramSetGraph.handler>[0] & { expectedRevision: string }, storage: DiagramsStorage) => ({ path, result: await storage.setGraph(path, spec, expectedRevision) }) }, diagramsStorage, ({ path: diagramPath, result }) => {
      if (!result) {
        return { content: [{ type: "text", text: `Diagram not found: ${diagramPath}` }] };
      }
      return { content: [{ type: "text", text: `Wrote ${result.shapes} shapes to ${result.path}` }] };
  }, withContentErrors);

  registerAction(server, { ...diagramRepair, handler: async (_input: Parameters<typeof diagramRepair.handler>[0], storage: DiagramsStorage) => storage.repairAll() }, diagramsStorage, (results) => {
      if (results.length === 0) {
        return { content: [{ type: "text", text: "All diagrams already sized correctly" }] };
      }
      const lines = results.map((r) => `${r.path}: ${r.repaired} note(s)`);
      return { content: [{ type: "text", text: `Repaired:\n${lines.join("\n")}` }] };
  });

  registerAction(server, { ...diagramDelete, input: diagramDelete.input.extend({ expectedRevision: z.string().describe("Revision from diagrams_read") }), handler: async ({ path, expectedRevision }: Parameters<typeof diagramDelete.handler>[0] & { expectedRevision: string }, storage: DiagramsStorage) => ({ path, deleted: await storage.delete(path, expectedRevision) }) }, diagramsStorage, ({ path: diagramPath, deleted }) => ({
    content: [{ type: "text", text: deleted ? `Deleted: ${diagramPath}` : `Diagram not found: ${diagramPath}` }],
  }), withContentErrors);

  registerAction(server, { ...diagramRename, input: diagramRename.input.extend({ expectedRevision: z.string().describe("Revision from diagrams_read") }), handler: async ({ path, newName, expectedRevision }: Parameters<typeof diagramRename.handler>[0] & { expectedRevision: string }, storage: DiagramsStorage) => ({ path, newPath: await storage.rename(path, newName, expectedRevision) }) }, diagramsStorage, ({ path: diagramPath, newPath }) => {
      if (!newPath) {
        return { content: [{ type: "text", text: `Diagram not found: ${diagramPath}` }] };
      }
      return { content: [{ type: "text", text: `Renamed to: ${newPath}` }] };
  }, withContentErrors);
}
