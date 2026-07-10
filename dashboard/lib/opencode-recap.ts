import { resolveOpenCodePort } from "./opencode-command";

type JsonObject = Record<string, unknown>;

interface OpenCodeSession extends JsonObject {
  id: string;
  parentID?: string;
  directory?: string;
  title?: string;
  time?: { created?: number; updated?: number };
}

export interface OpenCodeRecapOptions {
  sessionId?: string;
  includeChildren?: boolean;
  directory?: string;
}

export class OpenCodeRecapError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "OpenCodeRecapError";
  }
}

const SECRET_KEY = /authorization|cookie|credential|password|private[_-]?key|client[_-]?secret|secret|token|api[_-]?key|application[_-]?key/i;
const BUILTIN_TOOLS = new Set([
  "apply_patch",
  "bash",
  "edit",
  "glob",
  "grep",
  "ls",
  "mkdir",
  "question",
  "read",
  "rm",
  "shell",
  "skill",
  "task",
  "todowrite",
  "webfetch",
  "write",
]);
const COMMAND_TOOLS = new Set(["bash", "shell", "oc_bash"]);
const FILE_TOOLS = new Set(["apply_patch", "edit", "mkdir", "oc_edit", "oc_mkdir", "oc_rm", "oc_write", "rm", "write"]);
const MUTATION_NAME = /(?:^|_)(append|complete|connect|create|delete|generate|open|record|restart|run|set|switch|transition|update|upload|use|write)(?:_|$)/;

function redactUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.username || url.password) {
      url.username = "[REDACTED]";
      url.password = "[REDACTED]";
    }
    for (const key of [...url.searchParams.keys()]) {
      if (SECRET_KEY.test(key)) url.searchParams.set(key, "[REDACTED]");
    }
    return url.toString();
  } catch {
    return raw;
  }
}

function redactString(value: string): string {
  return value
    .replace(/https?:\/\/[^\s"'<>]+/g, redactUrl)
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "[REDACTED_AUTH]")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED_AWS_KEY]")
    .replace(/(^|\s)([A-Za-z_][A-Za-z0-9_]*)=([^\s]+)/g, (match, prefix: string, key: string) =>
      SECRET_KEY.test(key) ? `${prefix}${key}=[REDACTED]` : match,
    );
}

export function redactRecapSecrets(value: unknown, parentKey = ""): unknown {
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map(item => redactRecapSecrets(item, parentKey));
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as JsonObject).map(([key, child]) => {
      if (SECRET_KEY.test(key)) return [key, "[REDACTED]"];
      return [key, redactRecapSecrets(child, key)];
    }),
  );
}

function stateOf(part: JsonObject): JsonObject {
  return part.state && typeof part.state === "object" ? (part.state as JsonObject) : {};
}

function fileChanges(tool: string, input: JsonObject, state: JsonObject): JsonObject[] {
  if (!FILE_TOOLS.has(tool)) return [];
  const metadata = state.metadata && typeof state.metadata === "object" ? (state.metadata as JsonObject) : {};
  if (Array.isArray(metadata.files)) {
    return metadata.files.flatMap(file => {
      if (!file || typeof file !== "object") return [];
      const item = file as JsonObject;
      return [{ path: item.relativePath ?? item.filePath, operation: item.type ?? "update" }];
    });
  }
  if (typeof input.path === "string") {
    return [{ path: input.path, operation: tool.replace(/^oc_/, "") }];
  }
  const patch = typeof input.patchText === "string" ? input.patchText : "";
  return [...patch.matchAll(/^\*\*\* (Add|Update|Delete) File: (.+)$/gm)].map(match => ({
    path: match[2],
    operation: match[1].toLowerCase(),
  }));
}

function recapSession(session: OpenCodeSession, messages: unknown[], status?: unknown): JsonObject {
  const commands: JsonObject[] = [];
  const mcpCalls: JsonObject[] = [];
  const changes: JsonObject[] = [];
  const failures: JsonObject[] = [];
  const mutations: JsonObject[] = [];

  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const parts = (message as JsonObject).parts;
    if (!Array.isArray(parts)) continue;
    for (const rawPart of parts) {
      if (!rawPart || typeof rawPart !== "object") continue;
      const part = rawPart as JsonObject;
      if (part.type !== "tool" || typeof part.tool !== "string") continue;
      const tool = part.tool;
      const state = stateOf(part);
      const input = state.input && typeof state.input === "object" ? (state.input as JsonObject) : {};
      const toolStatus = state.status;

      if (COMMAND_TOOLS.has(tool) && typeof input.command === "string") {
        commands.push({ command: input.command, cwd: input.cwd, status: toolStatus, ...(state.time ? { time: state.time } : {}) });
      }
      if (!BUILTIN_TOOLS.has(tool) && !COMMAND_TOOLS.has(tool) && !FILE_TOOLS.has(tool)) {
        const call = { tool, input, status: toolStatus, ...(state.time ? { time: state.time } : {}) };
        mcpCalls.push(call);
        if (MUTATION_NAME.test(tool)) mutations.push(call);
      }
      if (toolStatus === "completed") changes.push(...fileChanges(tool, input, state));
      if (toolStatus === "error" || toolStatus === "failed") {
        failures.push({ tool, error: state.error ?? state.output ?? "failed", ...(state.time ? { time: state.time } : {}) });
      }
    }
  }

  return redactRecapSecrets({
    id: session.id,
    parentId: session.parentID,
    title: session.title,
    directory: session.directory,
    status,
    time: session.time,
    commands,
    mcpCalls,
    fileChanges: changes,
    failures,
    mutations,
  }) as JsonObject;
}

function openCodeHeaders(): HeadersInit {
  const password = process.env.OPENCODE_SERVER_PASSWORD?.trim();
  return password
    ? { Accept: "application/json", Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}` }
    : { Accept: "application/json" };
}

async function getJson<T>(fetchImpl: typeof fetch, base: string, path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(`${base}${path}`, { headers: openCodeHeaders(), cache: "no-store" });
  } catch {
    throw new OpenCodeRecapError(503, "OpenCode is unavailable.");
  }
  if (!response.ok) {
    if (response.status === 404) throw new OpenCodeRecapError(404, "OpenCode session not found.");
    throw new OpenCodeRecapError(503, "OpenCode is unavailable.");
  }
  return (await response.json()) as T;
}

function withDirectory(path: string, directory?: string): string {
  if (!directory) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}directory=${encodeURIComponent(directory)}`;
}

async function getOptionalJson<T>(fetchImpl: typeof fetch, base: string, path: string): Promise<T | null> {
  try {
    return await getJson<T>(fetchImpl, base, path);
  } catch (error) {
    if (error instanceof OpenCodeRecapError && error.status === 404) return null;
    throw error;
  }
}

function isBusy(value: unknown): boolean {
  return value === "busy" || (!!value && typeof value === "object" && (value as JsonObject).type === "busy");
}

export async function getOpenCodeRecap(
  options: OpenCodeRecapOptions = {},
  fetchImpl: typeof fetch = fetch,
): Promise<{ sessions: JsonObject[] }> {
  const base = `http://127.0.0.1:${resolveOpenCodePort()}`;
  const scoped = (path: string) => withDirectory(path, options.directory);
  const listed = options.sessionId ? [] : await getJson<OpenCodeSession[]>(fetchImpl, base, scoped("/session?roots=true"));
  const byId = new Map(listed.map(session => [session.id, session]));
  let selected: OpenCodeSession;

  if (options.sessionId) {
    selected = await getJson(fetchImpl, base, scoped(`/session/${encodeURIComponent(options.sessionId)}`));
    byId.set(selected.id, selected);
  } else {
    const statuses = await getJson<Record<string, unknown>>(fetchImpl, base, scoped("/session/status"));
    const roots = new Map<string, OpenCodeSession>();
    for (const id of Object.keys(statuses).filter(id => isBusy(statuses[id]))) {
      let current = byId.get(id) ?? await getJson<OpenCodeSession>(fetchImpl, base, scoped(`/session/${encodeURIComponent(id)}`));
      while (current.parentID) {
        current = byId.get(current.parentID) ?? await getJson<OpenCodeSession>(fetchImpl, base, scoped(`/session/${encodeURIComponent(current.parentID)}`));
        byId.set(current.id, current);
      }
      roots.set(current.id, current);
    }
    if (roots.size > 1) throw new OpenCodeRecapError(409, "Multiple OpenCode root sessions are busy; provide sessionId.");
    const latestRoot = listed
      .filter(session => !session.parentID)
      .sort((a, b) => (b.time?.updated ?? b.time?.created ?? 0) - (a.time?.updated ?? a.time?.created ?? 0))[0];
    selected = roots.values().next().value ?? latestRoot;
    if (!selected) throw new OpenCodeRecapError(404, "No OpenCode root session found.");
  }

  const selectedSessions = [selected];
  if (options.includeChildren) {
    const seen = new Set([selected.id]);
    for (let index = 0; index < selectedSessions.length; index += 1) {
      const children = await getJson<OpenCodeSession[]>(
        fetchImpl,
        base,
        scoped(`/session/${encodeURIComponent(selectedSessions[index].id)}/children`),
      );
      for (const child of children) {
        if (!seen.has(child.id)) {
          seen.add(child.id);
          selectedSessions.push(child);
        }
      }
    }
  }

  const statuses = await getJson<Record<string, unknown>>(fetchImpl, base, scoped("/session/status"));
  const sessions = await Promise.all(
    selectedSessions.map(async session => {
      const messages = await getJson<unknown[]>(fetchImpl, base, scoped(`/session/${encodeURIComponent(session.id)}/message`));
      const diff = await getOptionalJson<Array<Record<string, unknown>>>(fetchImpl, base, scoped(`/session/${encodeURIComponent(session.id)}/diff`));
      const recap = recapSession(session, messages, statuses[session.id]);
      if (diff?.length) recap.fileChanges = redactRecapSecrets(diff);
      return recap;
    }),
  );
  return { sessions };
}
