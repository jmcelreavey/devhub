import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Context } from "../context.ts";

export function registerDiagramsTools(server: McpServer, ctx: Context): void {
  const { diagramsStorage } = ctx;

  server.registerTool(
    "diagrams_list",
    { description: "List all diagrams. Returns names, paths, and last modified dates." },
    async () => {
      const diagrams = diagramsStorage.list();
      if (diagrams.length === 0) {
        return { content: [{ type: "text", text: "No diagrams found" }] };
      }
      const lines = diagrams.map(
        (d) => `${d.path} (modified: ${new Date(d.modified).toISOString().split("T")[0]})`,
      );
      return { content: [{ type: "text", text: `Diagrams:\n${lines.join("\n")}` }] };
    },
  );

  server.registerTool(
    "diagrams_read",
    {
      description: "Read a diagram's raw tldraw JSON data. Returns the full JSON content.",
      inputSchema: { path: z.string().describe("Diagram path (e.g. 'diagrams/2026-05-13-diagram')") },
    },
    async ({ path: diagramPath }) => {
      const data = diagramsStorage.read(diagramPath);
      if (!data) {
        return { content: [{ type: "text", text: `Diagram not found: ${diagramPath}` }] };
      }
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.registerTool(
    "diagrams_create",
    {
      description:
        "Create a new empty tldraw diagram. Use a slash in the name to place it in a folder (folders are created automatically).",
      inputSchema: {
        name: z
          .string()
          .optional()
          .describe(
            "Custom name for the diagram, auto-generated if omitted. May include a folder path, e.g. 'Acme/Reports/matching'.",
          ),
      },
    },
    async ({ name }) => {
      const result = diagramsStorage.create(name);
      return { content: [{ type: "text", text: `Created diagram: ${result.path}` }] };
    },
  );

  server.registerTool(
    "diagrams_update",
    {
      description: "Update a diagram with new tldraw JSON data.",
      inputSchema: {
        path: z.string().describe("Diagram path"),
        data: z.string().describe("tldraw JSON data as a string"),
      },
    },
    async ({ path: diagramPath, data }) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        return { content: [{ type: "text", text: "Invalid JSON data" }] };
      }
      const ok = diagramsStorage.update(diagramPath, parsed);
      return { content: [{ type: "text", text: ok ? `Updated: ${diagramPath}` : `Diagram not found: ${diagramPath}` }] };
    },
  );

  server.registerTool(
    "diagrams_add_note",
    {
      description:
        "Add a sticky note shape to a diagram. Use when the user asks to add a note, comment, TODO, or reminder to a diagram.",
      inputSchema: {
        path: z.string().describe("Diagram path"),
        text: z.string().describe("Note text. Use newlines for separate note lines."),
        x: z.number().optional().describe("Optional x coordinate"),
        y: z.number().optional().describe("Optional y coordinate"),
        color: z.string().optional().describe("Optional tldraw note color, defaults to yellow"),
      },
    },
    async ({ path: diagramPath, text, x, y, color }) => {
      const result = diagramsStorage.addNote(diagramPath, { text, x, y, color });
      if (!result) {
        return { content: [{ type: "text", text: `Diagram not found: ${diagramPath}` }] };
      }
      return { content: [{ type: "text", text: `Added note ${result.shapeId} to ${result.path}` }] };
    },
  );

  server.registerTool(
    "diagrams_delete",
    {
      description: "Delete a diagram.",
      inputSchema: { path: z.string().describe("Diagram path to delete") },
    },
    async ({ path: diagramPath }) => {
      const ok = diagramsStorage.delete(diagramPath);
      return { content: [{ type: "text", text: ok ? `Deleted: ${diagramPath}` : `Diagram not found: ${diagramPath}` }] };
    },
  );

  server.registerTool(
    "diagrams_rename",
    {
      description: "Rename a diagram in place, keeping it in its current folder.",
      inputSchema: {
        path: z.string().describe("Current diagram path, e.g. 'diagrams/Acme/Reports/matching'"),
        newName: z.string().describe("New base name only (no folder path); the diagram stays in its current folder"),
      },
    },
    async ({ path: diagramPath, newName }) => {
      const newPath = diagramsStorage.rename(diagramPath, newName);
      if (!newPath) {
        return { content: [{ type: "text", text: `Diagram not found: ${diagramPath}` }] };
      }
      return { content: [{ type: "text", text: `Renamed to: ${newPath}` }] };
    },
  );
}
