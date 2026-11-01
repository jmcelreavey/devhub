/**
 * Session intent metadata for dock tabs + launch options.
 *
 * Kept tiny on purpose — not a plugin framework. Templates seed a
 * label/kind (Agent opens the configured interactive CLI separately).
 */

/** Single source of truth for session kinds — keep MCP zod enum in sync. */
export const TERMINAL_SESSION_KINDS = [
  "shell",
  "agent",
  "review",
  "upstart",
  "devserver",
  "capture",
] as const;

export type TerminalSessionKind = (typeof TERMINAL_SESSION_KINDS)[number];

export interface TerminalSessionMeta {
  kind?: TerminalSessionKind;
  repoName?: string;
}

export interface TerminalTabTemplate {
  id: string;
  label: string;
  kind: TerminalSessionKind;
  /** Optional starter command for dedicated tabs (devserver, etc.). */
  command?: string;
}

/** Built-in tab starters shown from the dock "+" menu. Review is a job kind, not a blank template. */
export const TERMINAL_TAB_TEMPLATES: TerminalTabTemplate[] = [
  { id: "shell", label: "Shell", kind: "shell" },
  { id: "agent", label: "Agent", kind: "agent" },
];

const KIND_PREFIX: Record<TerminalSessionKind, string> = {
  shell: "",
  agent: "Agent",
  review: "Review",
  upstart: "Upstart",
  devserver: "Dev",
  capture: "Capture",
};

/** Tab label: `Agent · widgets` or plain `zsh`. */
export function formatTerminalTabLabel(opts: {
  label?: string;
  kind?: TerminalSessionKind;
  repoName?: string;
  cwd?: string;
}): string {
  if (opts.label?.trim()) return opts.label.trim();
  const base =
    opts.repoName?.trim() ||
    (opts.cwd ? opts.cwd.split("/").filter(Boolean).pop() : undefined) ||
    "zsh";
  const kind = opts.kind && opts.kind !== "shell" ? KIND_PREFIX[opts.kind] : "";
  return kind ? `${kind} · ${base}` : base;
}

export function isAgentLikeKind(kind: TerminalSessionKind | undefined): boolean {
  return kind === "agent" || kind === "review";
}

export function parseTerminalSessionKind(value: unknown): TerminalSessionKind | undefined {
  if (typeof value !== "string") return undefined;
  return (TERMINAL_SESSION_KINDS as readonly string[]).includes(value)
    ? (value as TerminalSessionKind)
    : undefined;
}
