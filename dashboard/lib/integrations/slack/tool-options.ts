import type { SlackTool } from "./mcp-catalog";
import type { JevOption } from "./jev-choice";
import { slackReadOnly } from "./tool-risk";

export interface ToolSubcall { label: string; args: Record<string, unknown> }
export interface SlackToolCall extends SlackTool { presetArgs?: Record<string, unknown> }
export interface ToolOption extends JevOption { tool: SlackToolCall }

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Include discriminators inside objects and union branches, including local schema references. */
export function toolSubcalls(tool: SlackTool): ToolSubcall[] {
  const calls = new Map<string, ToolSubcall>();
  function visit(schema: unknown, path: string[], ancestors: Set<unknown>): void {
    if (!object(schema) || ancestors.has(schema)) return;
    const seen = new Set(ancestors).add(schema);
    if (typeof schema.$ref === "string" && schema.$ref.startsWith("#/")) {
      let target: unknown = tool.inputSchema;
      for (const key of schema.$ref.slice(2).split("/")) target = object(target) ? target[key.replace(/~1/g, "/").replace(/~0/g, "~")] : undefined;
      visit(target, path, seen);
    }
    if (["action", "op", "kind"].includes(path.at(-1) ?? "")) {
      const values = Array.isArray(schema.enum) ? schema.enum : schema.const !== undefined ? [schema.const] : [];
      for (const value of values) {
        if (!["string", "number", "boolean"].includes(typeof value)) continue;
        const label = path.join(".") + "=" + JSON.stringify(value);
        const args = path.reduceRight<Record<string, unknown>>((nested, key, index) => ({ [key]: index === path.length - 1 ? value : nested }), {});
        calls.set(label, { label, args });
      }
    }
    if (object(schema.properties)) for (const [key, child] of Object.entries(schema.properties)) visit(child, [...path, key], seen);
    for (const key of ["allOf", "anyOf", "oneOf"]) if (Array.isArray(schema[key])) for (const child of schema[key]) visit(child, path, seen);
  }
  visit(tool.inputSchema, [], new Set());
  return [...calls.values()];
}

export function describeTool(tool: SlackTool): string {
  return `${tool.name}: ${tool.description.slice(0, 120)}${slackReadOnly(tool) ? "" : " (asks Confirm)"}`;
}

const cache = new WeakMap<readonly SlackTool[], ToolOption[]>();
/** Catalog arrays are stable until refresh; each enum value gets its own short, selectable option. */
export function toolOptions(tools: readonly SlackTool[]): ToolOption[] {
  const cached = cache.get(tools);
  if (cached) return cached;
  const options = tools.flatMap((tool) => [
    { id: `tool:${tool.name}`, description: describeTool(tool), tool },
    ...toolSubcalls(tool).map((call, index) => ({
      id: `call:${tool.name}:${index}`, description: `${tool.name} · ${call.label}: ${tool.description.slice(0, 80)}`,
      tool: { ...tool, presetArgs: call.args },
    })),
  ]);
  cache.set(tools, options);
  return options;
}
