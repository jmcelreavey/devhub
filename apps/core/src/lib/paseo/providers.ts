import { preferredPaseoProvider } from "./managed";
import { withPaseo } from "./client";

export interface PaseoThinkingOption {
  id: string;
  label: string;
}

export interface PaseoProviderRow {
  id: string;
  label: string;
  ready: boolean;
  models: string[];
  /** Per-model thinking options from the Paseo snapshot, when that model lists any. */
  thinking?: Record<string, PaseoThinkingOption[]>;
  /** Why an installed provider isn't ready, such as a failed initialization. */
  error?: string;
}

function thinkingByModel(models: { id: string; thinkingOptions?: { id: string; label: string }[] }[] | undefined): { thinking?: Record<string, PaseoThinkingOption[]> } {
  const thinking: Record<string, PaseoThinkingOption[]> = {};
  for (const model of models ?? []) {
    const options = (model.thinkingOptions ?? []).filter((option) => option.id.trim()).map((option) => ({ id: option.id, label: option.label }));
    if (options.length) thinking[model.id] = options;
  }
  return Object.keys(thinking).length ? { thinking } : {};
}

/** Long enough that Start chat reuses the snapshot the launch sheet just loaded. */
const PROVIDER_SNAPSHOT_TTL_MS = 15_000;

let providerSnapshot: { at: number; rows: PaseoProviderRow[] } | undefined;
let providerSnapshotInflight: Promise<PaseoProviderRow[]> | undefined;

/** A daemon restart or a test needs the next read to dial Paseo again. */
export function clearPaseoProviderCache(): void {
  providerSnapshot = undefined;
  providerSnapshotInflight = undefined;
}

async function loadPaseoProviders(): Promise<PaseoProviderRow[]> {
  const rows = await withPaseo(async ({ api }) => {
    const snapshot = await api.providers.snapshot();
    return snapshot.entries
      .filter((entry) => entry.enabled && entry.status !== "unavailable")
      .map((entry) => ({
        id: entry.provider,
        label: entry.label ?? entry.provider,
        ready: entry.status === "ready",
        models: (entry.models ?? []).map((model) => model.id),
        ...thinkingByModel(entry.models),
        ...(entry.error ? { error: entry.error } : {}),
      }));
  });
  providerSnapshot = { at: Date.now(), rows };
  return rows;
}

/** Installed providers only: "unavailable" means the CLI isn't on this machine at all. */
export async function listPaseoProviders(): Promise<PaseoProviderRow[]> {
  if (providerSnapshot && Date.now() - providerSnapshot.at < PROVIDER_SNAPSHOT_TTL_MS) return providerSnapshot.rows;
  // Overlapping Start clicks and the launch sheet share one websocket snapshot.
  providerSnapshotInflight ??= loadPaseoProviders().finally(() => { providerSnapshotInflight = undefined; });
  return providerSnapshotInflight;
}

/** Snapshot thinking options for this model, also matching the id with `effort=` stripped. */
export function thinkingOptionsForModel(rows: PaseoProviderRow[], provider: string, model?: string): PaseoThinkingOption[] | undefined {
  const thinking = rows.find((row) => row.id === provider)?.thinking;
  if (!thinking) return undefined;
  const key = model?.trim() ?? "";
  if (key && thinking[key]) return thinking[key];
  const bare = key.split("[")[0]?.trim() ?? "";
  if (bare && thinking[bare]) return thinking[bare];
  return undefined;
}

/** The Connection tab's choice (else DEVHUB_AGENT_CLI) when it's ready, else the first ready provider. */
export function defaultPaseoProvider(rows: PaseoProviderRow[], preferred = preferredPaseoProvider()): string | undefined {
  return rows.find((row) => row.id === preferred && row.ready)?.id ?? rows.find((row) => row.ready)?.id;
}
