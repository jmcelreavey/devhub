/**
 * Fetch the most recent Datadog alert events for a query — a small, signal-rich
 * replacement for paginating 24h volume into a single (noisy) count.
 * @see https://docs.datadoghq.com/api/latest/events/#search-events
 */

import { datadogApiBaseUrl, datadogAuthHeaders, datadogErrorMessage } from "@/lib/datadog-links";

export interface RecentEvent {
  id: string;
  title: string;
  timestampMs: number;
  status?: string;
  tags: string[];
}

export interface RecentEventsResult {
  events: RecentEvent[];
  query: string;
  error?: string;
}

export type DatadogRecentAlertsResponse =
  | {
      ok: true;
      fetchedAt: string;
      ddSite: string;
      oncall: RecentEvent[];
      teamSlack: RecentEvent[];
    }
  | {
      ok: false;
      code: "not_configured" | "needs_application_key" | "upstream";
      message: string;
    };

interface EventsSearchResponse {
  data?: unknown[];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function parseTimestamp(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

/** Extract a stable, human-readable shape from a v2 event object (defensive — shapes vary). */
export function extractRecentEvent(raw: unknown): RecentEvent {
  const root = asRecord(raw);
  const attributes = asRecord(root.attributes);
  const nested = asRecord(attributes.attributes);

  const title =
    (typeof nested.title === "string" && nested.title) ||
    (typeof attributes.title === "string" && attributes.title) ||
    (typeof attributes.message === "string" && attributes.message.split("\n")[0]) ||
    "(untitled alert)";

  const status =
    (typeof nested.status === "string" && nested.status) ||
    (typeof nested.alert_type === "string" && nested.alert_type) ||
    undefined;

  const tags = Array.isArray(attributes.tags)
    ? attributes.tags.filter((t): t is string => typeof t === "string")
    : [];

  return {
    id: typeof root.id === "string" ? root.id : "",
    title: title.slice(0, 200),
    timestampMs: parseTimestamp(attributes.timestamp),
    status,
    tags,
  };
}

export async function fetchRecentEvents(
  apiHost: string,
  apiKey: string,
  applicationKey: string,
  query: string,
  limit = 5,
): Promise<RecentEventsResult> {
  const base = datadogApiBaseUrl(apiHost);
  try {
    const res = await fetch(`${base}/api/v2/events/search`, {
      method: "POST",
      headers: datadogAuthHeaders(apiKey, applicationKey),
      body: JSON.stringify({
        filter: { query, from: "now-24h", to: "now" },
        sort: "-timestamp" as const,
        page: { limit },
      }),
    });
    const json = (await res.json()) as EventsSearchResponse;
    if (!res.ok) {
      return { events: [], query, error: datadogErrorMessage(json, `${res.status} ${res.statusText}`) };
    }
    return { events: (json.data ?? []).map(extractRecentEvent), query };
  } catch (e) {
    return { events: [], query, error: e instanceof Error ? e.message : "Datadog request failed" };
  }
}
