"use client";

import { effortOptionsForModel, type EffortOption } from "@/lib/ai/effort";
import type { CSSProperties } from "react";

const STORAGE_PREFIX = "devhub:effort:";

function storageKey(provider: string, model: string): string {
  return `${STORAGE_PREFIX}${provider}:${model || "default"}`;
}

/** Last effort chosen for this provider and model. Empty means Default. */
export function readRememberedEffort(provider: string, model: string): string {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(storageKey(provider, model)) ?? "";
  } catch {
    return "";
  }
}

export function rememberEffort(provider: string, model: string, effort: string): void {
  if (typeof window === "undefined") return;
  try {
    const key = storageKey(provider, model);
    if (effort) localStorage.setItem(key, effort);
    else localStorage.removeItem(key);
  } catch {
    /* private mode */
  }
}

/** Remembered effort when it is still one of this model's options. */
export function rememberedEffortFor(
  provider: string,
  model: string,
  thinkingOptions?: readonly { id: string; label?: string }[] | null,
  availableModels?: readonly string[] | null,
): string {
  const options = effortOptionsForModel({ provider, model, thinkingOptions, availableModels });
  if (!options) return "";
  const saved = readRememberedEffort(provider, model);
  return options.some((option) => option.id === saved) ? saved : "";
}

/**
 * Compact effort picker. Renders nothing when the model has no effort control.
 * Default sends no override.
 */
export function EffortSelect({
  provider,
  model,
  thinkingOptions,
  availableModels,
  value,
  onChange,
  disabled,
  remember = true,
  label = "Effort",
  labelled = true,
  className = "input w-full mt-1",
  style,
}: {
  provider?: string | null;
  model?: string | null;
  thinkingOptions?: readonly { id: string; label?: string }[] | null;
  availableModels?: readonly string[] | null;
  value: string;
  onChange: (effort: string) => void;
  disabled?: boolean;
  /** Disable when the caller stores effort with a separate feature preference. */
  remember?: boolean;
  label?: string;
  labelled?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const options: EffortOption[] | null = effortOptionsForModel({
    provider,
    model,
    thinkingOptions,
    availableModels,
  });
  if (!options) return null;
  const selected = options.some((option) => option.id === value) ? value : "";
  const select = (
    <select
      className={className}
      style={style}
      aria-label={labelled ? undefined : label}
      value={selected}
      disabled={disabled}
      onChange={(event) => {
        const next = event.target.value;
        if (remember) rememberEffort(provider ?? "", model ?? "", next);
        onChange(next);
      }}
    >
      <option value="">Default</option>
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.label}
        </option>
      ))}
    </select>
  );
  if (!labelled) return select;
  return (
    <label className="text-sm">
      {label}
      {select}
    </label>
  );
}
