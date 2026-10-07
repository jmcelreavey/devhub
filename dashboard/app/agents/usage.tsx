"use client";

import { useLive } from "@/lib/hooks/use-fetch";
import { useState } from "react";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { FetchError } from "@/components/ui/FetchError";
import { formatRelative } from "@/lib/utils";
import type { ProviderUsage, UsageMeter, UsageSpend } from "@/lib/agent-usage/types";

// The server caches each provider for five minutes; polling faster only re-reads that cache.
const REFRESH_MS = 5 * 60_000;

export default function Usage() {
  const { data, error, mutate } = useLive<{ providers: ProviderUsage[] }>("/api/agent-usage", { refreshInterval: REFRESH_MS });
  const [retrying, setRetrying] = useState<string>();
  const [retryError, setRetryError] = useState("");
  async function retry(id: string) {
    setRetrying(id); setRetryError("");
    try {
      const response = await fetch(`/api/agent-usage?refresh=${encodeURIComponent(id)}`);
      if (!response.ok) throw new Error("Could not refresh usage. Try again.");
      await mutate(await response.json(), { revalidate: false });
    } catch { setRetryError("Could not refresh usage. Try again."); }
    finally { setRetrying(undefined); }
  }
  return <div className="max-w-3xl mx-auto p-6 space-y-4">
    <div>
      <h2 className="text-xl font-semibold">Plan usage</h2>
      <p className="text-sm text-text-muted mt-1">How much of each subscription you&apos;ve used, read from this machine&apos;s sign-ins. Updates every five minutes. Providers you don&apos;t use need no setup.</p>
    </div>
    {retryError && <p role="alert" className="text-sm text-danger">{retryError}</p>}
    {error ? <FetchError message="Could not load usage." onRetry={() => void mutate()} /> : !data ? <SkeletonRows count={5} height={96} /> : data.providers.map((provider) => <ProviderCard key={provider.id} provider={provider} retry={() => void retry(provider.id)} busy={retrying !== undefined} />)}
  </div>;
}

function ProviderCard({ provider, retry, busy }: { provider: ProviderUsage; retry: () => void; busy: boolean }) {
  const muted = provider.status !== "ok";
  return <section className="card p-5 space-y-3" aria-label={`${provider.name} usage`}>
    <header className="flex items-center gap-2">
      <h3 className={muted ? "font-medium text-text-muted" : "font-medium"}>{provider.name}</h3>
      {provider.plan && <span className="badge badge-muted">{provider.plan}</span>}
      {provider.status === "error" && <span className="badge badge-danger ml-auto">Couldn&apos;t load</span>}
      {provider.status === "unavailable" && <span className="badge badge-muted ml-auto">Not available</span>}
    </header>
    {provider.meters.map((meter) => <Meter key={meter.label} meter={meter} />)}
    {provider.spend.length > 0 && <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">{provider.spend.map((spend) => <SpendRow key={`${spend.source}:${spend.label}`} spend={spend} />)}</dl>}
    {provider.message && <p className={provider.status === "error" ? "text-sm text-danger" : "text-xs text-text-subtle"}>{provider.message}</p>}
    {muted && <button type="button" className="btn btn-ghost" disabled={busy} onClick={retry}>Retry {provider.name} usage</button>}
  </section>;
}

function meterTone(percent: number): string {
  if (percent >= 90) return "var(--danger)";
  if (percent >= 75) return "var(--warning)";
  return "var(--accent)";
}

function Meter({ meter }: { meter: UsageMeter }) {
  const percent = Math.min(100, Math.max(0, meter.percent));
  return <div>
    <div className="flex items-baseline justify-between text-sm mb-1">
      <span>{meter.label}</span>
      <span className="text-text-muted tabular-nums">{Math.round(meter.percent)}%{meter.resetsAt && <span className="text-text-subtle"> · resets {formatRelative(Date.parse(meter.resetsAt))}</span>}</span>
    </div>
    <div className="h-1.5 rounded-full overflow-hidden bg-bg" role="meter" aria-label={meter.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}>
      <div className="h-full rounded-full" style={{ width: `${percent}%`, background: meterTone(meter.percent) }} />
    </div>
  </div>;
}

function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
}

function SpendRow({ spend }: { spend: UsageSpend }) {
  return <div>
    <dt className="text-text-muted text-xs flex items-center gap-1.5">{spend.label}<span className={spend.source === "billed" ? "badge badge-success" : "badge badge-muted"}>{spend.source === "billed" ? "Billed" : "Estimate"}</span></dt>
    <dd className="tabular-nums font-medium mt-0.5">{formatMoney(spend.amount, spend.currency)}{spend.limit !== undefined && <span className="text-text-subtle font-normal"> of {formatMoney(spend.limit, spend.currency)}</span>}</dd>
  </div>;
}
