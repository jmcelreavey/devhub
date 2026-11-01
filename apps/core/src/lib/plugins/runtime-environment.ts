import { readDashboardEnvLocalFile } from "../dashboard-env-local";
import type { RuntimeContribution } from "../../../../../packages/shared/ui-lib/plugins/runtime-contract";

/** Resolve only reviewed names; injected contexts never read host settings. */
export function runtimeEnvironmentValues(runtime: RuntimeContribution, source: NodeJS.ProcessEnv): Record<string, string> {
  const overrides = source === process.env ? readDashboardEnvLocalFile([...runtime.permissions.env, ...(runtime.permissions.publicEnv ?? [])]).overrides : null;
  const values: Record<string, string> = {};
  for (const name of [...runtime.permissions.env, ...(runtime.permissions.publicEnv ?? [])]) {
    const value = overrides?.get(name)?.trim() || source[name];
    if (value !== undefined) values[name] = value;
  }
  return values;
}
