import { z } from "zod";
import type { IntegrationProvider } from "../integrations/types";

import type { RuntimeContribution } from "../../../../../packages/shared/ui-lib/plugins/runtime-contract";
import type { RuntimeRequest } from "./runtime-catalog";

export type RuntimeProviderLookup = (id: string) => IntegrationProvider;

const text = z.string().max(4096);
const pr = z.object({ number: z.number().int(), title: text, url: text, repo: text, updatedAt: text.optional() });
const issue = z.object({ key: text, summary: text, status: text, url: text, updatedAt: text });
const alert = z.object({ title: text, timestampMs: z.number().finite(), status: text.optional() });
const schemas = {
  "github.prs": z.object({ authored: z.array(pr).max(100), reviews: z.array(pr).max(100) }),
  "jira.issues": z.array(issue).max(40),
  "datadog.alerts": z.object({ oncall: z.array(alert).max(20), related: z.array(alert).max(20) }),
};
type Source = keyof typeof schemas;
export type RuntimeReadProviders = Record<Source, () => Promise<unknown>>;

function providers(providerFor?: RuntimeProviderLookup): RuntimeReadProviders {
  return {
    "github.prs": async () => {
      const { fetchMyGithubPrs } = await import("../github/prs");
      const { authored, reviews } = await fetchMyGithubPrs();
      return { authored, reviews };
    },
    "jira.issues": async () => {
      const { getMyTickets } = await import("../jira/client");
      return (await getMyTickets()).slice(0, 40);
    },
    "datadog.alerts": async () => {
      if (!providerFor) throw new Error("Integration lookup is unavailable");
      const provider = providerFor("datadog");
      if (!provider.capabilities.includes("alerts.read") || !provider.alerts) throw new Error("Alerts are unavailable");
      return provider.alerts.recent(5);
    },
  };
}

/** Optional source failures retain the existing evidence endpoint's partial-result behaviour. */
async function read(source: Source, signal: AbortSignal, readers: RuntimeReadProviders): Promise<unknown> {
  try {
    const value = await new Promise<unknown>((resolve, reject) => {
      const abort = () => reject(new Error("Host read stopped"));
      if (signal.aborted) { abort(); return; }
      signal.addEventListener("abort", abort, { once: true });
      // Native clients keep their own network/subprocess deadlines; this only bounds snapshot preparation.
      void Promise.resolve().then(readers[source]).then(resolve, reject)
        .finally(() => signal.removeEventListener("abort", abort));
    });
    // Zod strips every field outside this allowlist, including account/config metadata.
    return schemas[source].parse(value);
  } catch { return null; }
}

/** Only the core appends this snapshot. Public request input cannot supply it. */
export async function prepareRuntimeReads(runtime: RuntimeContribution, request: RuntimeRequest, signal?: AbortSignal, readers?: RuntimeReadProviders, providerFor?: RuntimeProviderLookup) {
  const grant = request.kind === "api" && request.method === "GET" && runtime.capabilities?.reads?.find(read => read.path === request.path);
  if (!grant) return undefined;
  const deadline = AbortSignal.timeout(10_000);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const sourcesToRead = readers ?? providers(providerFor);
  const sources = Object.fromEntries(await Promise.all(grant.sources.map(async source => [source, await read(source, combined, sourcesToRead)])));
  if (signal?.aborted) throw new Error("Host read cancelled");
  const origin = new URL(process.env.DEVHUB_BASE_URL || `http://${process.env.DEVHUB_BIND_HOST || "localhost"}:${process.env.PORT || "1337"}`).origin;
  return { version: "1" as const, origin, sources };
}
