import { githubProvider } from "./github";
import { jiraProvider } from "./jira";
import { IntegrationError, type IntegrationProvider } from "./types";
import { runtimeIntegrationProviders } from "./runtime-provider";
import { pluginContext } from "../plugins/context";
export function createRegistry(providers: readonly IntegrationProvider[]) {
  const registry = new Map<string, IntegrationProvider>();
  for (const provider of providers) {
    if (provider.apiVersion !== 1 || !/^[a-z][a-z0-9-]{0,62}$/.test(provider.id)) throw new IntegrationError("invalid", "Unsupported integration provider contract.");
    if (registry.has(provider.id)) throw new IntegrationError("conflict", "Duplicate integration provider: " + provider.id);
    registry.set(provider.id, provider);
  }
  return registry;
}
export function providers() {
  const ctx = pluginContext();
  return [...createRegistry([jiraProvider, githubProvider, ...runtimeIntegrationProviders(ctx)]).values()];
}
export function providerFor(id: string) {
  const provider = providers().find((item) => item.id === id);
  if (!provider) throw new IntegrationError("unsupported", "This provider is absent or disabled.");
  return provider;
}
