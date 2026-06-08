import { resolveEnvValue } from "./dashboard-env-local";

export function resolveDatadogApplicationKey(overrides: Map<string, string>): string | undefined {
  return (
    resolveEnvValue("DATADOG_APPLICATION_KEY", overrides) ??
    resolveEnvValue("DD_APPLICATION_KEY", overrides) ??
    resolveEnvValue("DATADOG_APP_KEY", overrides) ??
    process.env.DATADOG_APP_KEY?.trim()
  );
}
