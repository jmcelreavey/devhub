import fs from "node:fs";
import path from "node:path";
import type { Json } from "@/lib/json-file";

interface TomlTable {
  end: number;
  path: string[];
  removeEnd: number;
  start: number;
}

function parseDottedKey(value: string): string[] | null {
  const parts: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let escaped = false;

  const push = (): boolean => {
    const raw = current.trim();
    current = "";
    if (!raw) return false;
    if (raw.startsWith('"')) {
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed !== "string") return false;
        parts.push(parsed);
        return true;
      } catch {
        return false;
      }
    }
    if (raw.startsWith("'")) {
      if (!raw.endsWith("'")) return false;
      parts.push(raw.slice(1, -1));
      return true;
    }
    parts.push(raw);
    return true;
  };

  for (const character of value) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (quote === '"' && character === "\\") {
      current += character;
      escaped = true;
      continue;
    }
    if (quote) {
      current += character;
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      current += character;
      continue;
    }
    if (character === ".") {
      if (!push()) return null;
      continue;
    }
    current += character;
  }

  if (quote || !push()) return null;
  return parts;
}

function tablePath(line: string): string[] | null {
  const match = line.match(/^\s*\[([^\]]+)]\s*(?:#.*)?(?:\r?\n)?$/);
  return match ? parseDottedKey(match[1]) : null;
}

function tablesIn(lines: string[]): TomlTable[] {
  const headers = lines
    .map((line, index) => ({ index, path: tablePath(line) }))
    .filter((entry): entry is { index: number; path: string[] } => entry.path !== null);

  return headers.map((header, index) => {
    const end = headers[index + 1]?.index ?? lines.length;
    let removeEnd = header.index;
    for (let lineIndex = header.index + 1; lineIndex < end; lineIndex++) {
      const trimmed = lines[lineIndex].trim();
      if (trimmed && !trimmed.startsWith("#")) removeEnd = lineIndex;
    }
    return { start: header.index, end, removeEnd, path: header.path };
  });
}

function stripComment(value: string): string {
  let quote: '"' | "'" | null = null;
  let escaped = false;
  let arrayDepth = 0;
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote === '"' && character === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "[") arrayDepth++;
    if (character === "]") arrayDepth--;
    if (character === "#" && arrayDepth === 0) return value.slice(0, index).trim();
  }
  return value.trim();
}

function splitArray(value: string): string[] | null {
  const inner = value.slice(1, -1);
  const parts: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let escaped = false;
  for (const character of inner) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (quote === '"' && character === "\\") {
      current += character;
      escaped = true;
      continue;
    }
    if (quote) {
      current += character;
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      current += character;
      continue;
    }
    if (character === ",") {
      if (current.trim()) parts.push(current.trim());
      current = "";
      continue;
    }
    current += character;
  }
  if (quote) return null;
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function parseValue(raw: string): Json | undefined {
  const value = stripComment(raw);
  if (value.startsWith('"')) {
    try {
      return JSON.parse(value) as Json;
    } catch {
      return undefined;
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^[+-]?\d+$/.test(value)) return Number(value);
  if (value.startsWith("[") && value.endsWith("]")) {
    const parts = splitArray(value);
    if (!parts) return undefined;
    const parsed = parts.map(parseValue);
    return parsed.every((entry): entry is Json => entry !== undefined) ? parsed : undefined;
  }
  return undefined;
}

function assignment(line: string): { key: string; value: Json } | null {
  let quote: '"' | "'" | null = null;
  let escaped = false;
  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote === '"' && character === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character !== "=") continue;
    const keyParts = parseDottedKey(line.slice(0, index).trim());
    const value = parseValue(line.slice(index + 1));
    if (!keyParts || keyParts.length !== 1 || value === undefined) return null;
    return { key: keyParts[0], value };
  }
  return null;
}

/** Read only Codex MCP tables; the rest of config.toml remains opaque and user-owned. */
export function readCodexMcpServers(configPath: string): Record<string, Json> {
  if (!fs.existsSync(configPath)) return {};
  const lines = fs.readFileSync(configPath, "utf-8").match(/.*(?:\r?\n|$)/g)?.filter(Boolean) ?? [];
  const servers: Record<string, Record<string, Json>> = {};

  for (const table of tablesIn(lines)) {
    if (table.path[0] !== "mcp_servers" || table.path.length < 2) continue;
    const [, name, ...subtable] = table.path;
    const entry = (servers[name] ??= {});
    const targetKey = subtable.join(".");
    const nested: Record<string, Json> = {};
    for (let index = table.start + 1; index < table.end; index++) {
      const parsed = assignment(lines[index]);
      if (!parsed) continue;
      if (!targetKey) entry[parsed.key] = parsed.value;
      else nested[parsed.key] = parsed.value;
    }
    if (targetKey && Object.keys(nested).length > 0) entry[targetKey] = nested;
  }

  return servers;
}

function key(value: string): string {
  return /^[A-Za-z0-9_-]+$/.test(value) ? value : JSON.stringify(value);
}

function renderValue(value: Json): string | null {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    const rendered = value.map(renderValue);
    return rendered.every((entry): entry is string => entry !== null) ? `[${rendered.join(", ")}]` : null;
  }
  return null;
}

function renderMap(header: string, value: Json | undefined): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const assignments = Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([name, entry]) => {
      const rendered = renderValue(entry);
      return rendered === null ? [] : [`${key(name)} = ${rendered}`];
    });
  return assignments.length > 0 ? [`[${header}]`, ...assignments] : [];
}

function renderServer(name: string, entry: Json): string {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return "";
  const server = entry as Record<string, Json>;
  const serverPath = `mcp_servers.${key(name)}`;
  const scalarOrder = [
    "command",
    "args",
    "url",
    "enabled",
    "startup_timeout_sec",
    "tool_timeout_sec",
  ];
  const lines = [`# Managed by DevHub MCP sync: ${name}`, `[${serverPath}]`];
  for (const field of scalarOrder) {
    const rendered = renderValue(server[field]);
    if (rendered !== null) lines.push(`${field} = ${rendered}`);
  }
  for (const [field, suffix] of [
    ["env", "env"],
    ["http_headers", "http_headers"],
    ["oauth", "oauth"],
  ] as const) {
    const rendered = renderMap(`${serverPath}.${suffix}`, server[field]);
    if (rendered.length > 0) lines.push("", ...rendered);
  }
  return lines.join("\n");
}

/**
 * Replace only the named MCP tables. Parsing and serialising the whole TOML file would destroy
 * comments and reorder settings owned by Codex or the user.
 */
export function writeCodexMcpServers(
  configPath: string,
  upserts: Record<string, Json>,
  removals: ReadonlySet<string>,
): void {
  const names = new Set([...Object.keys(upserts), ...removals]);
  if (names.size === 0) return;

  const original = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf-8") : "";
  const lines = original.match(/.*(?:\r?\n|$)/g)?.filter(Boolean) ?? [];
  const tables = tablesIn(lines);
  const removedLines = new Set<number>();

  // Blocks emitted by DevHub have a marker, so remove the whole generated group including the
  // blank lines between its main table and subtables. This keeps repeated syncs byte-stable.
  for (let markerIndex = 0; markerIndex < lines.length; markerIndex++) {
    const match = lines[markerIndex]
      .trim()
      .match(/^# Managed by DevHub MCP sync: (.+)$/);
    const name = match?.[1];
    if (!name || !names.has(name)) continue;

    const firstTableIndex = tables.findIndex(
      (table) => table.start > markerIndex,
    );
    if (
      firstTableIndex < 0 ||
      tables[firstTableIndex].path[0] !== "mcp_servers" ||
      tables[firstTableIndex].path[1] !== name
    ) {
      continue;
    }

    let removeEnd = tables[firstTableIndex].removeEnd;
    for (
      let tableIndex = firstTableIndex + 1;
      tableIndex < tables.length;
      tableIndex++
    ) {
      const table = tables[tableIndex];
      if (table.path[0] !== "mcp_servers" || table.path[1] !== name) break;
      removeEnd = table.removeEnd;
    }

    for (let index = markerIndex; index <= removeEnd; index++) {
      removedLines.add(index);
    }
  }

  for (const table of tables) {
    if (table.path[0] !== "mcp_servers" || !names.has(table.path[1])) continue;
    if (removedLines.has(table.start)) continue;
    let start = table.start;
    const marker = `# Managed by DevHub MCP sync: ${table.path[1]}`;
    if (start > 0 && lines[start - 1].trim() === marker) start--;
    for (let index = start; index <= table.removeEnd; index++) removedLines.add(index);
  }

  let output = lines.filter((_, index) => !removedLines.has(index)).join("");
  const rendered = Object.entries(upserts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, entry]) => renderServer(name, entry))
    .filter(Boolean);
  if (rendered.length > 0) {
    if (output && !output.endsWith("\n")) output += "\n";
    if (output && !output.endsWith("\n\n")) output += "\n";
    output += `${rendered.join("\n\n")}\n`;
  }

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, output, "utf-8");
}
