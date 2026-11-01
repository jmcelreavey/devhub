#!/usr/bin/env node
// Static W09 inventory. It reads source files only; it never loads application modules.
import fs from "node:fs";
import path from "node:path";
import { builtinModules } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const aliases = { "@/": "apps/ui/", "@shared/": "packages/shared/", "@contracts/": "packages/shared/", "@devhub/core/events/": "apps/core/src/domains/events/", "@devhub/core/tasks/": "apps/core/src/domains/tasks/", "@devhub/core/storage/": "apps/core/src/domains/storage/", "@devhub/core/scheduler/": "apps/core/src/domains/scheduler/", "@devhub/core/calendar/": "apps/core/src/domains/calendar/", "@devhub/core/lib/": "apps/core/src/lib/", "@devhub/core/local/": "apps/core/src/local/" };
const extensions = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".json"];
const builtins = new Set(builtinModules.map((name) => name.replace(/^node:/, "")));
const ignored = /(?:\.test|\.spec|\.stories|\.d)\.[cm]?[jt]sx?$/;
const groups = {
  tasks: ["apps/core/src/domains/tasks", "apps/ui/lib/tasks"],
  events: ["apps/core/src/domains/events", "apps/ui/lib/events/task-subscription.ts"],
  "scheduler/jobs": ["apps/core/src/lib/scheduler.ts", "apps/core/src/domains/scheduler"],
  storage: ["apps/core/src/lib/storage-server.ts", "packages/shared/storage", "apps/core/src/domains/storage"],
  calendar: ["apps/core/src/domains/calendar", "apps/core/src/lib/calendar-selection.ts", "apps/core/src/lib/google-calendar.ts"],
};

function filesUnder(relative) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) throw new Error(`Missing seed: ${relative}`);
  if (fs.statSync(absolute).isFile()) return ignored.test(relative) ? [] : [relative];
  return fs.readdirSync(absolute, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((entry) => {
    const name = `${relative}/${entry.name}`;
    if (entry.isDirectory()) return filesUnder(name);
    return entry.isFile() && extensions.some((ext) => name.endsWith(ext)) && !ignored.test(name) ? [name] : [];
  });
}

// Tokenise enough of TS/TSX to ignore comments and strings while finding module
// declarations. Template literals are opaque: computed imports are reported.
function tokensOf(source) {
  const tokens = [];
  let i = 0;
  while (i < source.length) {
    const start = i;
    const ch = source[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === "/" && source[i + 1] === "/") { i = source.indexOf("\n", i + 2); if (i < 0) break; continue; }
    if (ch === "/" && source[i + 1] === "*") { const end = source.indexOf("*/", i + 2); i = end < 0 ? source.length : end + 2; continue; }
    if (ch === "'" || ch === '"' || ch === "`") {
      const quote = ch;
      i++;
      let value = "";
      while (i < source.length && source[i] !== quote) {
        if (source[i] === "\\") { value += source.slice(i, i + 2); i += 2; } else { value += source[i++]; }
      }
      if (i < source.length) i++;
      tokens.push({ kind: quote === "`" ? "template" : "string", value, start });
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      i++;
      while (i < source.length && /[\w$]/.test(source[i])) i++;
      tokens.push({ kind: "word", value: source.slice(start, i), start });
      continue;
    }
    tokens.push({ kind: "punct", value: ch, start });
    i++;
  }
  return tokens;
}

function importsOf(tokens) {
  const imports = [];
  const computed = [];
  for (let i = 0; i < tokens.length; i++) {
    const current = tokens[i];
    if (current.value !== "import" && current.value !== "export") continue;
    if (tokens[i - 1]?.value === ".") continue;
    if (current.value === "import" && tokens[i + 1]?.value === "(") {
      const arg = tokens[i + 2];
      // TS import types use import("...").Type or typeof import("...").
      const qualifiedType = tokens[i + 3]?.value === ")" && tokens[i + 4]?.value === "." && !["then", "catch", "finally"].includes(tokens[i + 5]?.value);
      const typeOnly = tokens[i - 1]?.value === "typeof" || qualifiedType;
      if (arg?.kind === "string" && (tokens[i + 3]?.value === ")" || tokens[i + 3]?.value === ",")) imports.push({ specifier: arg.value, typeOnly, kind: typeOnly ? "import-type" : "dynamic" });
      else computed.push(current.start);
      continue;
    }
    if (current.value === "import" && tokens[i + 1]?.kind === "string") {
      imports.push({ specifier: tokens[i + 1].value, typeOnly: false, kind: "import" });
      continue;
    }
    const initial = tokens[i + 1]?.value;
    if (current.value === "export" && !["type", "{", "*"].includes(initial)) continue;
    if (current.value === "import" && (!initial || [".", ":"].includes(initial))) continue;
    let depth = 0;
    for (let j = i + 1; j < tokens.length; j++) {
      const value = tokens[j].value;
      if (value === "{" || value === "(") depth++;
      if (value === "}" || value === ")") depth--;
      if (depth < 0 || (depth === 0 && value === ";")) break;
      if (depth === 0 && value === "from" && tokens[j + 1]?.kind === "string") {
        const clause = tokens.slice(i + 1, j);
        const members = clause.slice(1, -1).reduce((parts, token) => {
          if (token.value === ",") parts.push([]);
          else parts.at(-1).push(token);
          return parts;
        }, [[]]).filter((part) => part.length);
        const onlyNamedTypes = clause[0]?.value === "{" && clause.at(-1)?.value === "}" && members.length > 0 && members.every((part) => part[0]?.value === "type");
        imports.push({ specifier: tokens[j + 1].value, typeOnly: initial === "type" || onlyNamedTypes, kind: current.value });
        break;
      }
      if (depth === 0 && j > i + 1 && ["import", "export"].includes(value)) break;
    }
  }
  return { imports, computed };
}

function resolve(from, specifier) {
  let base;
  if (specifier.startsWith(".")) base = path.resolve(root, path.dirname(from), specifier);
  else {
    const alias = Object.keys(aliases).find((prefix) => specifier.startsWith(prefix));
    if (!alias) return null;
    base = path.resolve(root, aliases[alias], specifier.slice(alias.length));
  }
  const bases = /\.[cm]?jsx?$/.test(base) ? [base.replace(/\.[cm]?jsx?$/, ""), base] : [base];
  for (const candidate of bases.flatMap((name) => [name, ...extensions.map((ext) => name + ext), ...extensions.map((ext) => path.join(name, `index${ext}`))])) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return path.relative(root, candidate).split(path.sep).join("/");
  }
  return undefined;
}

const seeds = Object.fromEntries(Object.entries(groups).map(([name, paths]) => [name, [...new Set(paths.flatMap(filesUnder))].sort()]));
const nodes = new Map();
function visit(file) {
  if (nodes.has(file)) return;
  const source = fs.readFileSync(path.join(root, file), "utf8");
  const tokens = tokensOf(source);
  const { imports, computed } = importsOf(tokens);
  const direct = new Set();
  const browserGlobals = ["window", "document", "localStorage"].filter((name) => !tokens.some((t, i) => t.value === name && ["const", "let", "var", "function", "class"].includes(tokens[i - 1]?.value)));
  if ((tokens[0]?.kind === "string" && tokens[0].value === "use client") || tokens.some((t, i) => browserGlobals.includes(t.value) && (tokens[i + 1]?.value === "." || tokens[i + 1]?.value === "[" || tokens[i - 1]?.value === "typeof"))) direct.add("browser");
  for (const token of tokens) if (token.kind === "template" && /\$\{[\s\S]*\bimport\s*\(/.test(token.value)) computed.push(token.start);
  const edges = [];
  const external = [];
  const unresolved = [];
  for (const entry of imports) {
    const target = resolve(file, entry.specifier);
    if (target === undefined) unresolved.push(entry);
    else if (target === null) {
      external.push(entry);
      // Next types are still a package coupling even when erased at runtime.
      if (/^next(?:\/|$)/.test(entry.specifier)) direct.add("next");
      if (!entry.typeOnly) {
        const spec = entry.specifier.replace(/^node:/, "");
        if (builtins.has(spec) || entry.specifier === "server-only" || /^(?:better-sqlite3|sqlite3|node:sqlite)(?:\/|$)/.test(entry.specifier)) direct.add("server");
        if (/^(?:react|react-dom)(?:\/|$)/.test(entry.specifier)) direct.add("browser");
      }
    } else edges.push({ ...entry, target });
  }
  nodes.set(file, { file, direct: [...direct].sort(), edges, external, unresolved, computed });
  for (const edge of edges) visit(edge.target);
}
for (const files of Object.values(seeds)) for (const file of files) visit(file);

// Runtime flags propagate over value imports only; types still appear in the graph.
for (const node of nodes.values()) node.flags = [...node.direct];
let changed;
do {
  changed = false;
  for (const node of nodes.values()) for (const edge of node.edges) {
    if (edge.typeOnly) continue;
    for (const flag of nodes.get(edge.target).flags) if (!node.flags.includes(flag)) { node.flags.push(flag); changed = true; }
  }
} while (changed);
for (const node of nodes.values()) node.flags.sort();

function closure(start) {
  const seen = new Set();
  const pending = [...start];
  while (pending.length) {
    const file = pending.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const edge of nodes.get(file).edges) pending.push(edge.target);
  }
  return [...seen].sort();
}

// Tarjan SCCs retain edge kind so type-only cycles can be distinguished later.
let index = 0;
const indices = new Map(), low = new Map(), stack = [], onStack = new Set(), cycles = [];
function strong(file) {
  indices.set(file, index); low.set(file, index++); stack.push(file); onStack.add(file);
  for (const edge of nodes.get(file).edges) {
    const target = edge.target;
    if (!indices.has(target)) { strong(target); low.set(file, Math.min(low.get(file), low.get(target))); }
    else if (onStack.has(target)) low.set(file, Math.min(low.get(file), indices.get(target)));
  }
  if (low.get(file) !== indices.get(file)) return;
  const component = [];
  let item;
  do { item = stack.pop(); onStack.delete(item); component.push(item); } while (item !== file);
  if (component.length > 1 || nodes.get(file).edges.some((edge) => edge.target === file)) cycles.push(component.sort());
}
for (const file of [...nodes.keys()].sort()) if (!indices.has(file)) strong(file);
cycles.sort((a, b) => a[0].localeCompare(b[0]));
const data = { seeds, closures: Object.fromEntries(Object.entries(seeds).map(([name, files]) => [name, closure(files)])), nodes: Object.fromEntries([...nodes].sort(([a], [b]) => a.localeCompare(b))), cycles };
if (process.argv.includes("--json")) console.log(JSON.stringify(data, null, 2));
else {
  const label = (file) => data.nodes[file].flags.join("+") || "pure candidate";
  for (const [name, files] of Object.entries(data.closures)) {
    console.log(`\n## ${name} (${files.length} files; ${seeds[name].length} seeds)`);
    for (const file of files) console.log(`- ${file} — ${label(file)}`);
  }
  console.log(`\n## Cycles (${cycles.length})`);
  for (const component of cycles) console.log(`- ${component.join(", ")}`);
  console.log("\n## Unresolved local imports / computed dynamic imports");
  for (const node of Object.values(data.nodes)) {
    for (const entry of node.unresolved) console.log(`- ${node.file}: ${entry.specifier}`);
    for (const offset of node.computed) console.log(`- ${node.file}: computed import at offset ${offset}`);
  }
}
