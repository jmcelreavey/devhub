import { IntegrationError } from "./types";
export function statusError(status: number, retryAfter?: string | null): IntegrationError {
  const delay = retryAfter ? Number(retryAfter) : undefined;
  if (status === 400 || status === 422) return new IntegrationError("invalid", "The provider rejected the query or item. Check its native syntax.");
  if (status === 401 || status === 403) return new IntegrationError("auth", "The provider rejected this account's credentials or permissions.");
  if (status === 404) return new IntegrationError("not-found", "The item was not found in this account.");
  if (status === 409 || status === 412) return new IntegrationError("conflict", "The provider item changed. Refresh before trying again.");
  if (status === 429) return new IntegrationError("rate-limit", "The provider rate limit was reached.", Number.isFinite(delay) ? delay : 60);
  return new IntegrationError("unavailable", "The provider request failed (" + status + ").");
}
export async function providerJson(url: string, init: RequestInit, signal: AbortSignal): Promise<unknown> {
  try {
    const response = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) });
    if (!response.ok) throw statusError(response.status, response.headers.get("retry-after"));
    return response.status === 204 ? null : await response.json();
  } catch (error) {
    if (error instanceof IntegrationError || signal.aborted) throw error;
    // Provider responses and URLs can contain credentials; never expose raw errors.
    throw new IntegrationError("unavailable", "The provider could not be reached or returned an invalid response.");
  }
}
