import { preferredPaseoProvider } from "./managed";
import { withPaseo } from "./client";

export interface PaseoProviderRow {
  id: string;
  label: string;
  ready: boolean;
  models: string[];
  /** Why an installed provider isn't ready, such as a failed initialization. */
  error?: string;
}

/** Installed providers only: "unavailable" means the CLI isn't on this machine at all. */
export async function listPaseoProviders(): Promise<PaseoProviderRow[]> {
  return withPaseo(async ({ api }) => {
    const snapshot = await api.providers.snapshot();
    return snapshot.entries
      .filter((entry) => entry.enabled && entry.status !== "unavailable")
      .map((entry) => ({
        id: entry.provider,
        label: entry.label ?? entry.provider,
        ready: entry.status === "ready",
        models: (entry.models ?? []).map((model) => model.id),
        ...(entry.error ? { error: entry.error } : {}),
      }));
  });
}

/** The Connection tab's choice (else DEVHUB_AGENT_CLI) when it's ready, else the first ready provider. */
export function defaultPaseoProvider(rows: PaseoProviderRow[], preferred = preferredPaseoProvider()): string | undefined {
  return rows.find((row) => row.id === preferred && row.ready)?.id ?? rows.find((row) => row.ready)?.id;
}
