/**
 * Typed client for DevHub's own API (R7).
 *
 * The server validates request bodies with zod (`parseBody`). The client used
 * to build those bodies by hand, so the two sides agreed only by convention:
 * rename a field in a route schema and every caller still compiles, then fails
 * at runtime with a 400 nobody sees until they click the button.
 *
 * `apiPost` closes that by taking the *same* schema the route uses. The body is
 * type-checked at compile time against `z.input<S>` and validated before it
 * leaves the browser, so a mismatch is a red squiggle rather than a bad request.
 *
 * Deliberately not a code generator. Generating a client for 147 routes would
 * add a build step, a generated artifact to keep in sync, and a lot of surface
 * for the sake of routes that are called once each. Sharing the schema gets the
 * safety without any of that.
 */
import type { z } from "zod";

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

/** Server error payloads are `{ error: string }` by convention across the API. */
function messageFrom(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "error" in body) {
    const err = (body as { error: unknown }).error;
    if (typeof err === "string" && err.trim()) return err;
  }
  return fallback;
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    // A non-JSON error body (proxy HTML, a stack trace) is still worth showing.
    return text;
  }
}

export interface ApiPostOptions {
  signal?: AbortSignal;
  /** Extra headers; Content-Type is always set. */
  headers?: Record<string, string>;
}

/**
 * POST a body validated against the route's own schema.
 *
 * Validation happens client-side *as well as* server-side. That isn't
 * redundant: the server check is the security boundary and stays
 * authoritative, while this one turns a silent 400 into an immediate, precise
 * error naming the offending field.
 */
export async function apiPost<S extends z.ZodType, T = unknown>(
  path: string,
  schema: S,
  body: z.input<S>,
  opts: ApiPostOptions = {},
): Promise<T> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(`Invalid request body for ${path}: ${formatIssues(parsed.error)}`, 0, body);
  }

  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...opts.headers },
    body: JSON.stringify(parsed.data),
    signal: opts.signal,
  });

  const payload = await readBody(res);
  if (!res.ok) {
    throw new ApiError(messageFrom(payload, `${path} failed (${res.status})`), res.status, payload);
  }
  return payload as T;
}

/** GET with the same error handling, so callers have one failure shape. */
export async function apiGet<T = unknown>(path: string, opts: ApiPostOptions = {}): Promise<T> {
  const res = await fetch(path, { signal: opts.signal, headers: opts.headers });
  const payload = await readBody(res);
  if (!res.ok) {
    throw new ApiError(messageFrom(payload, `${path} failed (${res.status})`), res.status, payload);
  }
  return payload as T;
}

/**
 * "field: message" per issue.
 *
 * Hand-rolled rather than `z.prettifyError` because that renders a multi-line
 * tree meant for a terminal; this ends up in a toast.
 */
export function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((i) => {
      const at = i.path.length ? i.path.join(".") : "body";
      return `${at}: ${i.message}`;
    })
    .join("; ");
}

/** True when a thrown value is our own API error, for narrowing in catch blocks. */
export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

/** The stale marker the service worker sets when serving a cached API response. */
export const STALE_HEADER = "X-DevHub-Stale";
