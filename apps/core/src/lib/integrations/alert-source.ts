import { providers } from "./registry";
import type { IntegrationAlertBatch } from "./types";

export async function loadIntegrationAlerts(limit: number): Promise<IntegrationAlertBatch> {
  const sources = providers().flatMap((provider) => provider.capabilities.includes("alerts.read") && provider.alerts ? [provider.alerts] : []);
  const batches = await Promise.all(sources.map((source) => source.recent(limit)));
  return {
    oncall: batches.flatMap((batch) => batch.oncall),
    related: batches.flatMap((batch) => batch.related),
  };
}
