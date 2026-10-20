/**
 * Reasoning effort for model pickers.
 *
 * Paseo's provider snapshot wins when a model lists `thinkingOptions`. Otherwise
 * a small table decides: Claude low–max, OpenAI gpt-5/6 none–xhigh, Cursor
 * effort inside the model id, GLM thinking on/off. Unknown models get nothing
 * so the picker stays hidden. "Default" is the empty id and sends no override.
 */

export interface EffortOption {
  id: string;
  label: string;
}

export interface AppliedEffort {
  /** Model id after provider-specific effort handling. */
  model?: string;
  /** Paseo `thinkingOptionId`, and the value CLI flags send. Omitted for Default and Cursor. */
  thinkingOptionId?: string;
  /** OpenAI `reasoning.effort` when the id is one of those values. */
  reasoningEffort?: string;
  /** GLM/z.ai thinking switch. Omitted for Default, which leaves the server default. */
  glmThinking?: "enabled" | "disabled";
}

const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
const OPENAI_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh"] as const;
const CURSOR_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
const CURSOR_FALLBACK_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
const CURSOR_EFFORT_SUFFIXES = [
  { suffix: "extra-high", effort: "xhigh" },
  ...CURSOR_EFFORTS.map((effort) => ({ suffix: effort, effort })),
] as const;
const REASONING_EFFORT_IDS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

const LABELS: Record<string, string> = {
  none: "None",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
  on: "On",
  off: "Off",
};

const EFFORT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;

/** Empty when the value isn't a single effort token. */
export function normalizeEffortId(raw: string | null | undefined): string {
  const value = raw?.trim() ?? "";
  return EFFORT_ID.test(value) ? value : "";
}

interface CursorModelParts {
  base: string;
  effort?: string;
  fast: boolean;
}

function cursorFamilyKey(base: string): string {
  return base.replace(/^cursor-(?=grok-)/, "").toLowerCase();
}

function splitCursorModelId(model: string): CursorModelParts {
  const trimmed = model.trim();
  const parameterized = /^([^\[\]]+)\[([^\]]*)\]$/.exec(trimmed);
  if (parameterized) {
    const params = new Map(parameterized[2].split(",").map((pair) => pair.split("=").map((part) => part.trim()) as [string, string]));
    const baseParts = splitCursorModelId(parameterized[1]);
    return {
      base: baseParts.base,
      effort: normalizeEffortId(params.get("effort") ?? params.get("reasoning_effort")) || baseParts.effort,
      fast: params.get("fast") === "true" || baseParts.fast,
    };
  }

  const fast = trimmed.endsWith("-fast");
  const withoutFast = fast ? trimmed.slice(0, -5) : trimmed;
  for (const { suffix, effort } of CURSOR_EFFORT_SUFFIXES) {
    if (withoutFast.endsWith(`-${suffix}`)) {
      return { base: withoutFast.slice(0, -suffix.length - 1), effort, fast };
    }
  }
  return { base: withoutFast, fast };
}

function cursorEffortVariants(model: string, availableModels: readonly string[]): Map<string, string> | null {
  const target = splitCursorModelId(model);
  const candidates = availableModels
    .map((id) => ({ id, parts: splitCursorModelId(id) }))
    .filter(({ parts }) => parts.fast === target.fast && cursorFamilyKey(parts.base) === cursorFamilyKey(target.base));
  const explicit = candidates.filter(({ parts }) => parts.effort);
  if (explicit.length === 0) return null;

  const variants = new Map(explicit.map(({ id, parts }) => [parts.effort!, id]));
  const medium = candidates.find(({ parts }) => !parts.effort);
  if (medium) variants.set("medium", medium.id);
  return variants;
}

/** Cursor effort is a sibling model id, never an `[effort=]` suffix. */
export function resolveCursorModelEffort(
  model: string,
  effort: string | null | undefined,
  availableModels: readonly string[],
): string {
  const trimmed = model.trim();
  if (!trimmed) return "";
  const target = splitCursorModelId(trimmed);
  const requested = normalizeEffortId(effort) || target.effort || "";
  const variants = cursorEffortVariants(trimmed, availableModels);
  const mapped = requested ? variants?.get(requested.toLowerCase()) : undefined;
  if (mapped) return mapped;
  if (availableModels.includes(trimmed)) return trimmed;

  const fallback = availableModels.find((id) => {
    const parts = splitCursorModelId(id);
    return !parts.effort && parts.fast === target.fast && cursorFamilyKey(parts.base) === cursorFamilyKey(target.base);
  });
  if (fallback) return fallback;
  return stripCursorEffort(trimmed);
}

function labelFor(id: string): string {
  return LABELS[id.toLowerCase()] ?? id;
}

function options(ids: readonly string[]): EffortOption[] {
  return ids.map((id) => ({ id, label: labelFor(id) }));
}

function bareModel(model: string): string {
  const withoutParams = model.split("[")[0] ?? "";
  return (withoutParams.split("/").pop() ?? "").trim().toLowerCase();
}

export type EffortFamily = "claude" | "openai" | "cursor" | "glm";

/** Which control a model uses. Null hides the picker. */
export function effortFamily(provider?: string | null, model?: string | null): EffortFamily | null {
  const p = (provider ?? "").trim().toLowerCase();
  const text = (model ?? "").trim();
  const name = bareModel(text);
  if (p === "cursor" || p === "cursor-cli") return "cursor";
  if (name.includes("glm") || p === "glm" || p === "zai") return "glm";
  if (/^gpt-[56](\.|-|$)/.test(name)) return "openai";
  if (/^(claude|opus|sonnet|haiku)([-.]|$)/.test(name)) return "claude";
  if (/\[.*\beffort=/i.test(text) || /grok|composer/.test(name) || name.startsWith("cursor-")) return "cursor";
  if (p === "claude" && !name) return "claude";
  if ((p === "codex" || p === "chatgpt" || p === "chatgpt-cli" || p === "openai") && !name) return "openai";
  if ((p === "api" || p === "glm" || p === "zai") && !name) return "glm";
  return null;
}

/**
 * Picker rows, not including Default. Null when this model has no effort control.
 * A non-empty Paseo `thinkingOptions` list replaces the table.
 */
export function effortOptionsForModel(input: {
  provider?: string | null;
  model?: string | null;
  thinkingOptions?: readonly { id: string; label?: string }[] | null;
  availableModels?: readonly string[] | null;
}): EffortOption[] | null {
  const family = effortFamily(input.provider, input.model);
  const provider = input.provider?.trim().toLowerCase() ?? "";
  if (provider === "cursor" || provider === "cursor-cli") {
    if (!input.availableModels) return null;
    const variants = cursorEffortVariants(input.model ?? "", input.availableModels);
    return variants ? options(CURSOR_EFFORTS.filter((id) => variants.has(id))) : null;
  }
  const fromProvider = (input.thinkingOptions ?? []).filter((option) => normalizeEffortId(option.id));
  if (fromProvider.length > 0) {
    return fromProvider.map((option) => ({ id: option.id.trim(), label: option.label?.trim() || labelFor(option.id) }));
  }
  if (family === "claude") return options(CLAUDE_EFFORTS);
  if (family === "openai") return options(OPENAI_EFFORTS);
  if (family === "cursor") return options(CURSOR_FALLBACK_EFFORTS);
  if (family === "glm") return options(["on", "off"]);
  return null;
}

/** Effort already encoded in a Cursor model id, including legacy parameter syntax. */
export function effortInModel(model: string): string {
  return splitCursorModelId(model).effort ?? "";
}

/** Drop `effort=` and leave the rest of a parameterized id alone. */
export function stripCursorEffort(model: string): string {
  const trimmed = model.trim();
  const match = /^([^[\]]+)\[([^\]]*)\]$/.exec(trimmed);
  if (!match) return trimmed;
  const rest = match[2]
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part && !/^effort=/i.test(part) && !/^reasoning_effort=/i.test(part));
  return rest.length ? `${match[1].trim()}[${rest.join(",")}]` : match[1].trim();
}

function asReasoningEffort(id: string): string | undefined {
  return REASONING_EFFORT_IDS.find((item) => item === id.toLowerCase());
}

/**
 * Turn a picker value into what each runtime actually sends.
 * Default (blank) returns the model unchanged and no override.
 */
export function applyEffort(input: {
  provider?: string | null;
  model?: string | null;
  effort?: string | null;
  thinkingOptions?: readonly { id: string; label?: string }[] | null;
  availableModels?: readonly string[] | null;
}): AppliedEffort {
  const model = input.model?.trim() || undefined;
  const effort = normalizeEffortId(input.effort);
  const family = effortFamily(input.provider, input.model);
  if (["cursor", "cursor-cli"].includes(input.provider?.trim().toLowerCase() ?? "")) {
    return {
      model: model ? resolveCursorModelEffort(model, effort, input.availableModels ?? []) : model,
    };
  }
  if (!effort) return { model };
  const options = effortOptionsForModel(input);
  const chosen = options?.find((option) => option.id.toLowerCase() === effort.toLowerCase());
  if (!chosen) return { model };
  const id = chosen.id;
  if (family === "glm" && (id === "on" || id === "off")) {
    return { model, glmThinking: id === "on" ? "enabled" : "disabled" };
  }
  // Only OpenAI's HTTP API reads reasoning.effort. Other families use thinkingOptionId or a CLI flag.
  const reasoningEffort = family === "openai" ? asReasoningEffort(id) : undefined;
  return { model, thinkingOptionId: id, ...(reasoningEffort ? { reasoningEffort } : {}) };
}

/** Extra argv for a CLI that takes effort beside `--model`. Cursor encodes it in the id instead. */
export function cliEffortArgs(provider: string, effort: string | null | undefined): string[] {
  const id = normalizeEffortId(effort);
  if (!id) return [];
  const name = provider.trim().toLowerCase();
  if (name === "claude") return ["--effort", id];
  if (name === "codex" || name === "chatgpt" || name === "chatgpt-cli") return ["-c", `model_reasoning_effort=${id}`];
  return [];
}
