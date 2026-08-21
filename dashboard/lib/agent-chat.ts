/**
 * Client-safe Agent dock chat helpers.
 * No Node builtins — this module is imported by the webpack client.
 */

import { isAgentLikeKind, type TerminalSessionKind } from "@/lib/terminal-meta";

export const AGENT_CHAT_EVENT = "devhub:agent-chat";
export const AGENT_CHAT_STORAGE_KEY = "devhub:agent-chat.v1";
export const AGENT_COMPOSER_FOCUS_EVENT = "devhub:agent-composer-focus";
export const AGENT_CHAT_CLEAR_EVENT = "devhub:agent-chat-clear";
export const AGENT_COMPOSER_INSERT_EVENT = "devhub:agent-composer-insert";
export const AGENT_POPOUT_SIZE_KEY = "devhub:agent-chat-popout";

export type AgentChatRole = "system" | "user" | "assistant";

export interface AgentChatMessage {
  id: string;
  role: AgentChatRole;
  content: string;
  /** Prompt actually sent, when it differs from the visible bubble. */
  payload?: string;
  createdAt: number;
  attachments?: { name: string; kind: "text" | "image" }[];
}

export interface AgentChatTurn {
  role: AgentChatRole;
  content: string;
}

export interface AgentChatRequest {
  messages: AgentChatTurn[];
  cwd?: string;
  attachments?: {
    name: string;
    kind: "text" | "image";
    mime?: string;
    text?: string;
    dataUrl?: string;
  }[];
}

export interface AgentChatResponse {
  text: string;
  provider: string;
}

export interface AgentChatOpenDetail {
  title: string;
  /** Full prompt sent to the model (may be longer than display). */
  prompt?: string;
  /** User-visible turn; defaults to summary/title. */
  display?: string;
  kind?: Extract<TerminalSessionKind, "agent" | "review">;
  cwd?: string;
  repoName?: string;
  summary?: string;
  providerLabel?: string;
  autoSend?: boolean;
  /** Put display/prompt in the composer; user hits send. */
  composerDraft?: boolean;
  forceNewTab?: boolean;
  agentPhase?: "starting" | "running" | "ready" | "done" | "failed";
}

export class AgentChatError extends Error {
  status?: number;
  setupHint?: string;
  constructor(message: string, opts?: { status?: number; setupHint?: string }) {
    super(message);
    this.name = "AgentChatError";
    this.status = opts?.status;
    this.setupHint = opts?.setupHint;
  }
}

export function newAgentChatId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function seedJobMessages(display: string): AgentChatMessage[] {
  const text = display.trim();
  if (!text) return [];
  return [
    {
      id: newAgentChatId(),
      role: "user",
      content: text,
      createdAt: Date.now(),
    },
  ];
}

/** Flatten a transcript into a oneshot prompt the CLI/API routers already understand. */
export function flattenAgentChatMessages(messages: AgentChatTurn[]): {
  system?: string;
  prompt: string;
} {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content.trim())
    .filter(Boolean)
    .join("\n\n");
  const rest = messages.filter((m) => m.role !== "system");
  if (rest.length === 1 && rest[0]?.role === "user") {
    return { system: system || undefined, prompt: rest[0].content };
  }
  const prompt = rest
    .map((m) => `${m.role === "assistant" ? "Assistant" : "User"}: ${m.content}`)
    .join("\n\n");
  return { system: system || undefined, prompt: prompt || "Hello" };
}

export function isAgentChatKind(kind: TerminalSessionKind | undefined): boolean {
  return isAgentLikeKind(kind);
}

/**
 * MCP/UI shell injects must not land in Agent/Review chat panes.
 * Those tabs have no PTY.
 */
export function injectKindForPropose(opts: {
  kind?: TerminalSessionKind;
  source?: string;
}): TerminalSessionKind {
  const kind = opts.kind;
  if (opts.source === "mcp" || opts.source === "ui") {
    if (!kind || isAgentLikeKind(kind)) return "shell";
  }
  return kind ?? "shell";
}

interface ChatStore {
  [tabId: string]: AgentChatMessage[];
}

export function parseAgentChatStore(raw: string | null): ChatStore {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: ChatStore = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(value)) continue;
      const messages: AgentChatMessage[] = [];
      for (const item of value) {
        if (!item || typeof item !== "object") continue;
        const rec = item as Partial<AgentChatMessage>;
        if (rec.role !== "user" && rec.role !== "assistant" && rec.role !== "system") continue;
        if (typeof rec.content !== "string") continue;
        const attachments = Array.isArray(rec.attachments)
          ? rec.attachments
              .map((att) => {
                if (!att || typeof att !== "object") return null;
                const row = att as { name?: unknown; kind?: unknown };
                if (typeof row.name !== "string") return null;
                if (row.kind !== "text" && row.kind !== "image") return null;
                return { name: row.name, kind: row.kind };
              })
              .filter((row): row is { name: string; kind: "text" | "image" } => row != null)
          : undefined;
        messages.push({
          id: typeof rec.id === "string" ? rec.id : newAgentChatId(),
          role: rec.role,
          content: rec.content,
          payload: typeof rec.payload === "string" ? rec.payload : undefined,
          createdAt: typeof rec.createdAt === "number" ? rec.createdAt : Date.now(),
          ...(attachments && attachments.length > 0 ? { attachments } : {}),
        });
      }
      out[key] = messages;
    }
    return out;
  } catch {
    return {};
  }
}

export function readAgentChatHistory(tabId: number): AgentChatMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const store = parseAgentChatStore(sessionStorage.getItem(AGENT_CHAT_STORAGE_KEY));
    return store[String(tabId)] ?? [];
  } catch {
    return [];
  }
}

export function writeAgentChatHistory(tabId: number, messages: AgentChatMessage[]): void {
  if (typeof window === "undefined") return;
  try {
    const store = parseAgentChatStore(sessionStorage.getItem(AGENT_CHAT_STORAGE_KEY));
    if (messages.length === 0) delete store[String(tabId)];
    else store[String(tabId)] = messages.slice(-80);
    sessionStorage.setItem(AGENT_CHAT_STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* private mode / quota */
  }
}

export function clearAgentChatHistory(tabId: number): void {
  writeAgentChatHistory(tabId, []);
}

/**
 * Client ceiling so Ask/chat can't spin forever if the route never returns.
 * Sit above the route's generate timeout (240s) so a late CLI reply isn't
 * aborted as a silent fetch AbortError.
 */
export const AGENT_CHAT_TIMEOUT_MS = 260_000;

export function isAbortError(err: unknown): boolean {
  if (typeof DOMException !== "undefined" && err instanceof DOMException && err.name === "AbortError") {
    return true;
  }
  return err instanceof Error && err.name === "AbortError";
}

/** True when the user hit Stop — not a timeout or HMR disconnect. */
export function isUserAbortedAsk(err: unknown, signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted) && isAbortError(err);
}

function abortReasonIsTimeout(reason: unknown): boolean {
  if (reason instanceof DOMException && reason.name === "TimeoutError") return true;
  if (reason instanceof Error && reason.name === "TimeoutError") return true;
  return false;
}

function withTimeout(
  signal: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; didTimeout: () => boolean; cleanup: () => void } {
  const ac = new AbortController();
  let timedOut = false;
  const onParent = () => ac.abort(signal?.reason);
  if (signal?.aborted) {
    ac.abort(signal.reason);
  } else {
    signal?.addEventListener("abort", onParent);
  }
  const timer = setTimeout(() => {
    timedOut = true;
    ac.abort(
      new DOMException(`Timed out after ${Math.round(timeoutMs / 1000)}s`, "TimeoutError"),
    );
  }, timeoutMs);
  return {
    signal: ac.signal,
    didTimeout: () => timedOut,
    cleanup: () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onParent);
    },
  };
}

export async function sendAgentChat(
  req: AgentChatRequest,
  onChunk?: (delta: string) => void,
  signal?: AbortSignal,
  timeoutMs = AGENT_CHAT_TIMEOUT_MS,
): Promise<AgentChatResponse> {
  const timed = withTimeout(signal, timeoutMs);
  try {
    const res = await fetch("/api/agent/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
      signal: timed.signal,
    });
    const ct = res.headers.get("content-type") ?? "";
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string; setupHint?: string };
      throw new AgentChatError(json.error ?? `Chat failed (${res.status})`, {
        status: res.status,
        setupHint: json.setupHint,
      });
    }
    if (ct.includes("application/json") || !res.body) {
      const json = (await res.json()) as { text?: string; provider?: string };
      const text = (json.text ?? "").trim();
      if (text) onChunk?.(text);
      return { text, provider: json.provider ?? "agent" };
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let text = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const delta = decoder.decode(value, { stream: true });
      text += delta;
      if (delta) onChunk?.(delta);
    }
    return {
      text: text.trim(),
      provider: res.headers.get("x-devhub-ai-provider") ?? "api",
    };
  } catch (err) {
    if (err instanceof AgentChatError) throw err;
    if (
      timed.didTimeout() ||
      abortReasonIsTimeout(timed.signal.reason) ||
      abortReasonIsTimeout(err)
    ) {
      throw new AgentChatError("Request timed out. Stop and retry, or shorten the ask.");
    }
    if (isUserAbortedAsk(err, signal)) throw err;
    if (isAbortError(err)) {
      throw new AgentChatError("Ask was interrupted. Retry.");
    }
    throw err;
  } finally {
    timed.cleanup();
  }
}

export function openAgentChat(detail: AgentChatOpenDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(AGENT_CHAT_EVENT, { detail }));
}

export function focusAgentComposer(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(AGENT_COMPOSER_FOCUS_EVENT));
}

export interface AgentComposerInsertDetail {
  /** Target a specific Agent tab; omit to fill the focused/visible composer. */
  tabId?: number;
  text: string;
}

/** Put text in the Agent composer — never auto-send. */
export function insertAgentComposer(detail: AgentComposerInsertDetail): void {
  if (typeof window === "undefined") return;
  const text = detail.text.replace(/\s+$/, "");
  if (!text) return;
  window.dispatchEvent(
    new CustomEvent(AGENT_COMPOSER_INSERT_EVENT, { detail: { tabId: detail.tabId, text } }),
  );
}

export function clearAgentChatTab(tabId: number): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(AGENT_CHAT_CLEAR_EVENT, { detail: { tabId } }));
}

export interface AgentPopoutSize {
  w: number;
  h: number;
}

export function readAgentPopoutSize(): AgentPopoutSize | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(AGENT_POPOUT_SIZE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AgentPopoutSize>;
    const w = typeof parsed.w === "number" && parsed.w >= 360 ? parsed.w : null;
    const h = typeof parsed.h === "number" && parsed.h >= 280 ? parsed.h : null;
    if (w == null || h == null) return null;
    return { w, h };
  } catch {
    return null;
  }
}

export function writeAgentPopoutSize(size: AgentPopoutSize): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      AGENT_POPOUT_SIZE_KEY,
      JSON.stringify({
        w: Math.round(Math.min(Math.max(size.w, 360), 1600)),
        h: Math.round(Math.min(Math.max(size.h, 280), 1400)),
      }),
    );
  } catch {
    /* private mode / quota */
  }
}
