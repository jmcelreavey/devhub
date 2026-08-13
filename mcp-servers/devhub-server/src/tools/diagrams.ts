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
      description:
        "Read a diagram. Returns a compact summary — each shape's id, type, text, position and size, plus overall bounds and any overlapping pairs. Pass raw:true only when you need the full tldraw JSON (it is large).",
      inputSchema: {
        path: z.string().describe("Diagram path (e.g. 'diagrams/2026-05-13-diagram')"),
        raw: z.boolean().optional().describe("Return the full tldraw JSON instead of the summary"),
      },
    },
    async ({ path: diagramPath, raw }) => {
      if (raw) {
        const data = diagramsStorage.read(diagramPath);
        if (!data) return { content: [{ type: "text", text: `Diagram not found: ${diagramPath}` }] };
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }

      const summary = diagramsStorage.summarize(diagramPath);
      if (!summary) {
        return { content: [{ type: "text", text: `Diagram not found: ${diagramPath}` }] };
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
            text: `${summary.path}\n${bounds}\n${overlaps}\n\n${lines.join("\n") || "(no shapes)"}`,
          },
        ],
      };
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
      return {
        content: [
          {
            type: "text",
            text: `Added note ${result.shapeId} to ${result.path} at (${result.x}, ${result.y}), ${result.w}x${result.h}`,
          },
        ],
      };
    },
  );

  server.registerTool(
    "diagrams_add_shape",
    {
      description:
        "Add a box (or other geo shape) with a text label. Height is measured from the text unless you pass one. Use for architecture boxes — unlike sticky notes these have explicit width and height and can be connected with arrows.",
      inputSchema: {
        path: z.string().describe("Diagram path"),
        text: z.string().optional().describe("Label text. Use newlines for separate lines."),
        x: z.number().optional().describe("Optional x coordinate"),
        y: z.number().optional().describe("Optional y coordinate"),
        w: z.number().optional().describe("Width, defaults to 260"),
        h: z.number().optional().describe("Height, defaults to a measured fit around the text"),
        color: z.string().optional().describe("tldraw colour, defaults to blue"),
        fill: z.string().optional().describe("none | semi | solid | pattern, defaults to semi"),
        geo: z.string().optional().describe("rectangle | ellipse | diamond | hexagon | oval, defaults to rectangle"),
      },
    },
    async ({ path: diagramPath, text, x, y, w, h, color, fill, geo }) => {
      const result = diagramsStorage.addShape(diagramPath, { text, x, y, w, h, color, fill, geo });
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
    },
  );

  server.registerTool(
    "diagrams_add_arrow",
    {
      description:
        "Connect two existing shapes with an arrow. Pass the shape ids returned by diagrams_add_shape / diagrams_add_note (or listed by diagrams_read). The arrow is bound to both shapes, so it follows them when they move.",
      inputSchema: {
        path: z.string().describe("Diagram path"),
        from: z.string().describe("Source shape id, e.g. 'shape:abc123'"),
        to: z.string().describe("Target shape id"),
        text: z.string().optional().describe("Optional label on the arrow"),
        dashed: z.boolean().optional().describe("Draw the arrow dashed"),
      },
    },
    async ({ path: diagramPath, from, to, text, dashed }) => {
      const result = diagramsStorage.addArrow(diagramPath, { from, to, text, dashed });
      if (!result) {
        return {
          content: [
            { type: "text", text: `Diagram not found, or one of the shapes does not exist: ${from} -> ${to}` },
          ],
        };
      }
      return { content: [{ type: "text", text: `Added arrow ${result.shapeId} to ${result.path}` }] };
    },
  );

  server.registerTool(
    "diagrams_set_graph",
    {
      description:
        "Replace a diagram with a laid-out graph. Describe the system as nodes and edges and the tool handles layout, text measurement and arrow binding. This is the right tool for architecture, flow and sequence diagrams — prefer it over placing notes by hand, which cannot account for rendered text size.",
      inputSchema: {
        path: z.string().describe("Diagram path"),
        title: z.string().optional().describe("Optional title rendered above the graph"),
        direction: z
          .enum(["right", "down"])
          .optional()
          .describe("Flow direction, defaults to right"),
        nodes: z
          .array(
            z.object({
              id: z.string().describe("Stable id referenced by edges"),
              label: z.string().describe("Box text. Keep to a few short lines."),
              group: z.string().optional().describe("Optional group id; members get a labelled boundary"),
              color: z.string().optional().describe("tldraw colour"),
            }),
          )
          .describe("The boxes in the diagram"),
        edges: z
          .array(
            z.object({
              from: z.string().describe("Source node id"),
              to: z.string().describe("Target node id"),
              label: z
                .string()
                .optional()
                .describe(
                  "Optional edge label. Keep it to one or two short words — tldraw wraps arrow labels to a fraction of the arrow length and will break longer text mid-word.",
                ),
              dashed: z.boolean().optional().describe("Draw dashed, e.g. for async or optional paths"),
            }),
          )
          .optional()
          .describe("Connections; these also determine the layering"),
        groups: z
          .array(
            z.object({
              id: z.string().describe("Group id referenced by nodes"),
              label: z.string().optional().describe("Boundary label"),
              color: z.string().optional().describe("tldraw colour"),
            }),
          )
          .optional()
          .describe("Optional boundary boxes drawn behind their member nodes"),
      },
    },
    async ({ path: diagramPath, title, direction, nodes, edges, groups }) => {
      const result = diagramsStorage.setGraph(diagramPath, { title, direction, nodes, edges, groups });
      if (!result) {
        return { content: [{ type: "text", text: `Diagram not found: ${diagramPath}` }] };
      }
      return { content: [{ type: "text", text: `Wrote ${result.shapes} shapes to ${result.path}` }] };
    },
  );

  server.registerTool(
    "diagrams_repair",
    {
      description:
        "Recompute note sizing across all diagrams. Notes written before the tool measured text carry growY:0 and render on top of their neighbours; this fixes them in place.",
    },
    async () => {
      const results = diagramsStorage.repairAll();
      if (results.length === 0) {
        return { content: [{ type: "text", text: "All diagrams already sized correctly" }] };
      }
      const lines = results.map((r) => `${r.path}: ${r.repaired} note(s)`);
      return { content: [{ type: "text", text: `Repaired:\n${lines.join("\n")}` }] };
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
