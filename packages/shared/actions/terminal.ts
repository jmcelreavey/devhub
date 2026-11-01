import { z } from "zod";
import { defineAction } from "./define.ts";

export const terminalProposalStreamInput = z.object({});
export interface TerminalProposalStreamContext {
  open: () => unknown;
}
export const terminalProposalStream = defineAction<typeof terminalProposalStreamInput, TerminalProposalStreamContext, unknown>({
  input: terminalProposalStreamInput,
  http: { method: "GET", path: "/api/terminal/propose/stream" },
  mcp: { reason: "The dock uses a browser event stream; proposal status is already available through MCP." },
  handler: (_input, context) => context.open(),
});

export const terminalSearchInput = z.object({ q: z.string(), limit: z.number().int().optional() });
export interface TerminalSearchContext {
  search: (query: string, limit?: number) => unknown;
}
export const terminalSearch = defineAction<typeof terminalSearchInput, TerminalSearchContext, unknown>({
  input: terminalSearchInput,
  http: { method: "GET", path: "/api/terminal/search" },
  mcp: { reason: "Transcript search is a redacted dashboard viewer, not a separate terminal MCP tool." },
  handler: ({ q, limit }, context) => q.trim().length < 2
    ? { matches: [], sessionsSearched: 0, truncated: false }
    : context.search(q, limit),
});

export const terminalTranscriptInput = z.object({ session: z.string() });
export interface TerminalTranscriptContext {
  read: (session: string) => { status: number; body: unknown };
}
export const terminalTranscript = defineAction<typeof terminalTranscriptInput, TerminalTranscriptContext, { status: number; body: unknown }>({
  input: terminalTranscriptInput,
  http: { method: "GET", path: "/api/terminal/transcript" },
  mcp: { reason: "The redacted closed-session viewer is dashboard-only; MCP has the live terminal tail." },
  handler: ({ session }, context) => context.read(session),
});

export const terminalPasteImageInput = z.object({
  files: z.array(z.object({ bytes: z.instanceof(Uint8Array), mime: z.string(), name: z.string().optional() })),
});
export interface TerminalPasteImageContext {
  write: (files: z.output<typeof terminalPasteImageInput>["files"]) => Promise<{ status: number; body: unknown }>;
}
export const terminalPasteImage = defineAction<typeof terminalPasteImageInput, TerminalPasteImageContext, { status: number; body: unknown }>({
  input: terminalPasteImageInput,
  http: { method: "POST", path: "/api/terminal/paste-image" },
  mcp: { reason: "Pasted binary images are uploaded by the local terminal dock, not by an MCP tool." },
  handler: ({ files }, context) => context.write(files),
});

export const terminalListInput = z.object({}).meta({ additionalProperties: false });

export interface TerminalSession {
  tabId: number;
  sessionId: string | null;
  label: string;
  cwd?: string;
  kind?: string;
  repoName?: string;
  status: string;
  busy: boolean;
}

export interface TerminalListResult {
  sessions: TerminalSession[];
}

export interface TerminalListContext {
  list: () => TerminalListResult | Promise<TerminalListResult>;
}

export const terminalList = defineAction<typeof terminalListInput, TerminalListContext, TerminalListResult>({
  input: terminalListInput,
  http: { method: "GET", path: "/api/terminal/sessions" },
  mcp: {
    name: "terminal_list",
    toolset: "terminal",
    description: "List DevHub terminal dock tabs (label, cwd, kind, busy, session id). Requires the dashboard running with the terminal dock open at least once this session.",
  },
  handler: (_input, context) => context.list(),
});

export const terminalHeartbeatInput = z.object({
  tabId: z.number().finite(),
  sessionId: z.string().nullish(),
  label: z.string().trim().min(1).optional(),
  cwd: z.string().optional(),
  kind: z.enum(["shell", "agent", "review", "upstart", "devserver", "capture"]).optional(),
  repoName: z.string().optional(),
  status: z.enum(["connecting", "open", "closed"]).default("connecting"),
  busy: z.boolean().default(false),
  remove: z.boolean().optional(),
}).refine((body) => body.remove === true || Boolean(body.label), {
  path: ["label"],
  message: "label is required",
}).meta({ additionalProperties: false });

export interface TerminalHeartbeatContext {
  update: (input: z.output<typeof terminalHeartbeatInput>) => void | Promise<void>;
}

export const terminalHeartbeat = defineAction<typeof terminalHeartbeatInput, TerminalHeartbeatContext, { ok: true }>({
  input: terminalHeartbeatInput,
  http: { method: "POST", path: "/api/terminal/sessions" },
  mcp: { reason: "The dock owns terminal registration and heartbeats." },
  handler: async (input, context) => {
    await context.update(input);
    return { ok: true };
  },
});

export interface TerminalProposalValue {
  id: string;
  status: string;
  command: string;
  hostApproval?: { id: string; summary: string };
  finalCommand?: string;
  destructive: boolean;
  autoRun?: boolean;
  error?: string;
}

export const terminalProposalStatusInput = z.object({
  id: z.string().describe("Proposal id returned by terminal_propose_run"),
}).meta({ additionalProperties: false });

export interface TerminalProposalStatusContext {
  find: (id: string) => TerminalProposalValue | null | Promise<TerminalProposalValue | null>;
}

export const terminalProposalStatus = defineAction<typeof terminalProposalStatusInput, TerminalProposalStatusContext, { proposal: TerminalProposalValue | null }>({
  input: terminalProposalStatusInput,
  http: { method: "GET", path: "/api/terminal/propose", discriminator: "query id is nonempty" },
  mcp: {
    name: "terminal_proposal_status",
    toolset: "terminal",
    description: "Check the outcome of a terminal or plugin approval proposal. Returns pending / approved / injected / denied / expired / failed. Poll this instead of assuming a proposal was approved. Requires the dashboard running.",
  },
  handler: async ({ id }, context) => ({ proposal: await context.find(id) }),
});

export const terminalProposalListInput = z.object({ status: z.string().optional() }).meta({ additionalProperties: false });
export interface TerminalProposalListContext {
  list: (status?: string) => TerminalProposalValue[] | Promise<TerminalProposalValue[]>;
}
export const terminalProposalList = defineAction<typeof terminalProposalListInput, TerminalProposalListContext, { proposals: TerminalProposalValue[] }>({
  input: terminalProposalListInput,
  http: { method: "GET", path: "/api/terminal/propose", discriminator: "query id is empty or absent" },
  mcp: { reason: "The dock reads the proposal queue; MCP queries a single proposal." },
  handler: async ({ status }, context) => ({ proposals: await context.list(status) }),
});

export const terminalProposeInput = z.object({
  command: z.string().describe("Shell command to propose"),
  cwd: z.string().optional().describe("Absolute cwd under the user home"),
  label: z.string().optional().describe("Tab label — how the user tells this run apart in the dock"),
  summary: z.string().optional().describe("Friendly chip copy (preferred over dumping the raw command)"),
  kind: z.enum(["shell", "agent", "review", "upstart", "devserver", "capture"]).optional().describe("Tab chrome only; every kind gets its own tab"),
  repoName: z.string().optional(),
  reason: z.string().optional().describe("Shown in the confirm chip"),
}).meta({ additionalProperties: false });

export const terminalProposeBodyInput = terminalProposeInput.extend({
  command: z.string().trim().min(1, "command is required").max(8_000, "command too long"),
  source: z.enum(["mcp", "api"]).default("api"),
  autoRunConfirmed: z.boolean().optional(),
});

export type TerminalProposeResult =
  | { status: number; proposal: TerminalProposalValue }
  | { status: number; error: string };

export interface TerminalProposeContext {
  create: (input: z.output<typeof terminalProposeInput>) => TerminalProposeResult | Promise<TerminalProposeResult>;
}

export const terminalPropose = defineAction<typeof terminalProposeInput, TerminalProposeContext, TerminalProposeResult>({
  input: terminalProposeInput,
  http: { method: "POST", path: "/api/terminal/propose" },
  mcp: {
    name: "terminal_propose_run",
    toolset: "terminal",
    description: "Run a command in the DevHub terminal dock (visible logs). MCP commands launch automatically without human approval. Prefer this over running a command in the agent/Cursor shell: the dock is where the user can see it, keep it, and kill it. Always use it for upstarts, dev servers, Expo, and anything long-running or user-visible. Every run opens its own tab, so nothing ever waits on another session. Requires the dashboard running.",
  },
  handler: (input, context) => context.create(input),
});

export const terminalResolveInput = z.object({
  id: z.string().min(1),
  action: z.enum(["approve", "deny", "injected", "failed"]),
  finalCommand: z.string().optional(),
  error: z.string().optional(),
}).meta({ additionalProperties: false });

export interface TerminalResolveContext {
  resolve: (input: z.output<typeof terminalResolveInput>) => TerminalProposalValue | null | Promise<TerminalProposalValue | null>;
}

export const terminalResolve = defineAction<typeof terminalResolveInput, TerminalResolveContext, { proposal: TerminalProposalValue | null }>({
  input: terminalResolveInput,
  http: { method: "PATCH", path: "/api/terminal/propose" },
  mcp: { reason: "Only the dock resolves terminal approval and injection outcomes." },
  handler: async (input, context) => ({ proposal: await context.resolve(input) }),
});

export const terminalTailInput = z.object({
  sessionId: z.string().describe("Session UUID from terminal_list"),
  maxLines: z.number().optional().describe("Max trailing lines (default 80)"),
}).meta({ additionalProperties: false });

export interface TerminalLogResult {
  status: number;
  body: string | { error: string };
}

export interface TerminalLogContext {
  read: (sessionId: string) => Promise<TerminalLogResult>;
}

export interface TerminalTailResult extends TerminalLogResult {
  sessionId: string;
  maxLines?: number;
}

export const terminalTail = defineAction<typeof terminalTailInput, TerminalLogContext, TerminalTailResult>({
  input: terminalTailInput,
  http: { method: "GET", path: "/api/terminal/log" },
  mcp: {
    name: "terminal_tail",
    toolset: "terminal",
    description: "Read the cleaned (ANSI-stripped) tail of a terminal session log by session id from terminal_list. Requires the dashboard running.",
  },
  handler: async (input, context) => ({ ...await context.read(input.sessionId), ...input }),
});

export const terminalWaitInput = z.object({
  sessionId: z.string().describe("Session UUID from terminal_list"),
  pattern: z.string().min(1).max(500).describe("JavaScript regular expression, e.g. ready on|listening"),
  flags: z.string().regex(/^[imsu]*$/).optional().describe("Regex flags: any of i, m, s, u"),
  timeoutSeconds: z.number().int().min(1).max(300).optional().describe("Default 60, max 300"),
  includeExisting: z.boolean().optional().describe("Also match output that was already there"),
}).meta({ additionalProperties: false });

export interface TerminalWaitContext {
  readLog: (sessionId: string) => Promise<string>;
  signal?: AbortSignal;
}

export interface TerminalWaitResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export const terminalWait = defineAction<typeof terminalWaitInput, TerminalWaitContext, TerminalWaitResult>({
  input: terminalWaitInput,
  http: { reason: "Polling and cancellation belong to the MCP request." },
  mcp: {
    name: "terminal_wait_for",
    toolset: "terminal",
    description: "Block until output in a DevHub terminal session matches a regex (a dev server's \"ready on\" line, a test summary, an error) or the timeout passes. By default only output written after the call starts counts. Use instead of polling terminal_tail. Requires the dashboard running.",
  },
  handler: async ({ sessionId, pattern, flags, timeoutSeconds, includeExisting }, context) => {
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, flags ?? "");
    } catch (err) {
      return { content: [{ type: "text", text: `Invalid pattern: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
    const tailLines = (value: string) => value.replace(/\s+$/, "").split("\n").slice(-20).join("\n");
    const timeout = timeoutSeconds ?? 60;
    const deadline = Date.now() + timeout * 1_000;
    let log = await context.readLog(sessionId);
    let offset = includeExisting ? 0 : log.length;
    for (;;) {
      const fresh = log.slice(offset);
      const scan = fresh.length > 200_000 ? fresh.slice(-200_000) : fresh;
      const match = regex.exec(scan);
      if (match) {
        const lineStart = scan.lastIndexOf("\n", match.index) + 1;
        const lineEnd = scan.indexOf("\n", match.index);
        const line = scan.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
        return { content: [{ type: "text", text: `Matched /${pattern}/${flags ?? ""} in ${sessionId}:\n${line}\n\nRecent output:\n\`\`\`\n${tailLines(log)}\n\`\`\`` }] };
      }
      if (Date.now() >= deadline || context.signal?.aborted) {
        return { content: [{ type: "text", text: `No match for /${pattern}/${flags ?? ""} within ${timeout}s.\n\nRecent output:\n\`\`\`\n${tailLines(log)}\n\`\`\`` }] };
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      log = await context.readLog(sessionId);
      if (log.length < offset) offset = 0;
    }
  },
});
