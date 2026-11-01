/** Fetch helpers for the plugin API. Failures arrive as the API's error envelope. */

export interface ApiFailure {
  status: number;
  code: string;
  message: string;
}

async function readBody(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function failureOf(status: number, body: unknown): ApiFailure {
  const error = body && typeof body === "object" && "error" in body
    ? (body as { error?: { code?: string; message?: string } }).error
    : null;
  return { status, code: error?.code || "INTERNAL", message: error?.message || "Something went wrong with plugin settings." };
}

export function asFailure(err: unknown): ApiFailure {
  if (err && typeof err === "object" && "code" in err && "message" in err) return err as ApiFailure;
  return { status: 0, code: "NETWORK", message: "Couldn’t reach DevHub. Try again." };
}

export async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
  const body = await readBody(res);
  if (!res.ok) throw failureOf(res.status, body);
  return body as T;
}

export async function postJson<T>(url: string, payload?: unknown, idempotencyKey?: string): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json", "Content-Type": "application/json" };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: payload === undefined ? undefined : JSON.stringify(payload),
    cache: "no-store",
  });
  const body = await readBody(res);
  if (!res.ok) throw failureOf(res.status, body);
  return body as T;
}
