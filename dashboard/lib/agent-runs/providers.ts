/**
 * Agent CLIs an MCP caller can dispatch work to.
 *
 * Built-ins run with approvals disabled: a dispatched run has nobody sitting at
 * a permission prompt, so the control is the visible DevHub terminal tab (and
 * `agent_cancel`), not a y/n that would stall forever.
 *
 * Any other CLI with a headless mode, or a wrapper script around one, is added
 * through `~/.config/devhub/agent-providers.json`, so a new agent is config
 * rather than code:
 *
 * ```json
 * { "providers": [
 *   { "id": "my-agent", "label": "My Agent", "command": "my-agent",
 *     "args": ["-p", "{prompt}"], "modelArgs": ["--model", "{model}"] }
 * ] }
 * ```
 *
 * GUI agent apps (AutoClaw, Grok Bot) have no headless CLI to dispatch to —
 * they connect the other way, as MCP clients of DevHub.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { CHATGPT_APP_CODEX } from "@/lib/ai/preference";
import { AGENT_STREAM_FORMATS, type AgentStreamFormat } from "@/lib/agent-runs/events";
import { augmentedPathEnv } from "@/lib/process-env";

export interface AgentArgsInput {
  prompt: string;
  model?: string;
  resumeSessionId?: string;
  maxTurns?: number;
}

export interface AgentProviderSpec {
  id: string;
  label: string;
  /** Binary names or absolute paths; the first executable match wins. */
  binaries: string[];
  format: AgentStreamFormat;
  supportsResume: boolean;
  supportsMaxTurns: boolean;
  custom: boolean;
  buildArgs(input: AgentArgsInput): string[];
}

export interface ResolvedAgentProvider {
  spec: AgentProviderSpec;
  /** Null when the CLI is not installed. */
  binPath: string | null;
}

const flag = (name: string, value: string | undefined): string[] => (value ? [name, value] : []);

export const BUILT_IN_AGENT_PROVIDERS: readonly AgentProviderSpec[] = [
  {
    id: "claude",
    label: "Claude Code",
    binaries: ["claude"],
    format: "claude-stream-json",
    supportsResume: true,
    supportsMaxTurns: true,
    custom: false,
    buildArgs: ({ prompt, model, resumeSessionId, maxTurns }) => [
      "-p",
      prompt,
      "--output-format",
      "stream-json",
      "--verbose",
      "--dangerously-skip-permissions",
      ...flag("--model", model),
      ...flag("--max-turns", maxTurns ? String(maxTurns) : undefined),
      ...flag("--resume", resumeSessionId),
    ],
  },
  {
    id: "cursor",
    label: "Cursor",
    binaries: ["cursor-agent"],
    format: "cursor-stream-json",
    supportsResume: true,
    supportsMaxTurns: false,
    custom: false,
    // No --stream-partial-output: its deltas repeat the whole message at the end.
    buildArgs: ({ prompt, model, resumeSessionId }) => [
      "-p",
      prompt,
      "--output-format",
      "stream-json",
      "--force",
      "--approve-mcps",
      "--trust",
      ...flag("--model", model),
      ...flag("--resume", resumeSessionId),
    ],
  },
  {
    id: "codex",
    label: "ChatGPT Codex",
    // The ChatGPT.app bundle first — see CHATGPT_APP_CODEX for why PATH is second.
    binaries: [CHATGPT_APP_CODEX, "codex"],
    format: "codex-json",
    supportsResume: false,
    supportsMaxTurns: false,
    custom: false,
    buildArgs: ({ prompt, model }) => [
      "exec",
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
      "--skip-git-repo-check",
      ...flag("-m", model),
      prompt,
    ],
  },
  {
    id: "gemini",
    label: "Gemini",
    binaries: ["gemini"],
    format: "text",
    supportsResume: false,
    supportsMaxTurns: false,
    custom: false,
    buildArgs: ({ prompt, model }) => ["-p", prompt, "--yolo", ...flag("-m", model)],
  },
  {
    id: "opencode",
    label: "OpenCode",
    binaries: ["opencode"],
    format: "text",
    supportsResume: false,
    supportsMaxTurns: false,
    custom: false,
    buildArgs: ({ prompt, model }) => ["run", ...flag("--model", model), prompt],
  },
  {
    id: "antigravity",
    label: "Antigravity",
    binaries: ["agy"],
    format: "text",
    supportsResume: false,
    supportsMaxTurns: false,
    custom: false,
    buildArgs: ({ prompt, model }) => ["-p", prompt, "--dangerously-skip-permissions", ...flag("--model", model)],
  },
];

const CustomProviderSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/, "lowercase letters, digits and dashes"),
  label: z.string().trim().min(1).max(40),
  command: z.string().trim().min(1),
  args: z
    .array(z.string())
    .refine((args) => args.some((arg) => arg.includes("{prompt}")), "args must include {prompt}"),
  /** Appended when a model is requested; `{model}` is substituted. */
  modelArgs: z.array(z.string()).optional(),
  /** Appended when resuming a follow-up; `{sessionId}` is substituted. */
  resumeArgs: z.array(z.string()).optional(),
  format: z.enum(AGENT_STREAM_FORMATS).default("text"),
});

const CustomProvidersFileSchema = z.object({ providers: z.array(CustomProviderSchema) });

export function agentProvidersFile(): string {
  return (
    process.env.DEVHUB_AGENT_PROVIDERS_FILE?.trim() ||
    path.join(os.homedir(), ".config", "devhub", "agent-providers.json")
  );
}

/** Single pass, so a prompt that happens to contain "{model}" is left alone. */
function fillPlaceholders(args: readonly string[], values: Record<string, string>): string[] {
  return args.map((arg) => arg.replace(/\{(prompt|model|sessionId)\}/g, (match, key: string) => values[key] ?? match));
}

function expandHome(file: string): string {
  return file.startsWith("~/") ? path.join(os.homedir(), file.slice(2)) : file;
}

function customProviderSpec(def: z.infer<typeof CustomProviderSchema>): AgentProviderSpec {
  return {
    id: def.id,
    label: def.label,
    binaries: [expandHome(def.command)],
    format: def.format,
    supportsResume: Boolean(def.resumeArgs?.length),
    supportsMaxTurns: false,
    custom: true,
    buildArgs: ({ prompt, model, resumeSessionId }) => [
      ...fillPlaceholders(def.args, { prompt }),
      ...(model && def.modelArgs ? fillPlaceholders(def.modelArgs, { model }) : []),
      ...(resumeSessionId && def.resumeArgs
        ? fillPlaceholders(def.resumeArgs, { sessionId: resumeSessionId })
        : []),
    ],
  };
}

/** A missing file is normal; a broken one is reported, never thrown. */
export function loadCustomProviders(file = agentProvidersFile()): {
  providers: AgentProviderSpec[];
  error?: string;
} {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { providers: [] };
    return { providers: [], error: `${file}: ${err instanceof Error ? err.message : String(err)}` };
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { providers: [], error: `${file} is not valid JSON` };
  }
  const parsed = CustomProvidersFileSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    return { providers: [], error: `${file}: ${issues}` };
  }
  return { providers: parsed.data.providers.map(customProviderSpec) };
}

function isExecutableFile(file: string): boolean {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/** PATH lookup without spawning `which` — this runs on every providers listing. */
export function resolveBinary(candidates: readonly string[], envPath = augmentedPathEnv().PATH ?? ""): string | null {
  const dirs = envPath.split(path.delimiter).filter(Boolean);
  for (const candidate of candidates) {
    if (path.isAbsolute(candidate)) {
      if (isExecutableFile(candidate)) return candidate;
      continue;
    }
    for (const dir of dirs) {
      const full = path.join(dir, candidate);
      if (isExecutableFile(full)) return full;
    }
  }
  return null;
}

/** Built-ins plus custom providers; a custom entry with a built-in id replaces it. */
export function listAgentProviders(): { providers: ResolvedAgentProvider[]; configError?: string } {
  const custom = loadCustomProviders();
  const byId = new Map<string, AgentProviderSpec>();
  for (const spec of [...BUILT_IN_AGENT_PROVIDERS, ...custom.providers]) byId.set(spec.id, spec);
  const envPath = augmentedPathEnv().PATH ?? "";
  return {
    providers: [...byId.values()].map((spec) => ({ spec, binPath: resolveBinary(spec.binaries, envPath) })),
    configError: custom.error,
  };
}

export function getAgentProvider(id: string): ResolvedAgentProvider | null {
  return listAgentProviders().providers.find((p) => p.spec.id === id) ?? null;
}
