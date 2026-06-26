/**
 * Thin HTTP client for the local DevHub dashboard (Next.js, default
 * http://localhost:1337). Filesystem-backed tools (notes/docs/tasks/diagrams/
 * appraisal) do NOT use this — they talk to disk directly and work headless.
 *
 * Everything stateful or action-oriented (scripts, status, briefing, calendar,
 * work, repos, and all BI ops) proxies through here so the dashboard process
 * stays the single source of truth: it owns the run registry, the loaded
 * secrets, and (for BI) the active AWS profile.
 *
 * Node's fetch sends no `Origin` header, so the dashboard's `isSameOrigin`
 * guard passes for these server-to-server calls without any auth change.
 */

export interface DashboardRequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  /** JSON body (object) — serialized and sent with application/json. */
  body?: unknown;
  /** Query string params (string values only). */
  query?: Record<string, string | number | boolean | undefined>;
  /** Per-request timeout in ms (default 30s; raise for slow ops). */
  timeoutMs?: number;
}

/** Raised when the dashboard returns a non-2xx response; carries the status + parsed payload. */
export class DashboardHttpError extends Error {
  constructor(
    readonly status: number,
    readonly payload: unknown,
    message: string,
  ) {
    super(message);
    this.name = "DashboardHttpError";
  }
}

/** Raised when the dashboard cannot be reached at all (not running / wrong port). */
export class DashboardUnreachableError extends Error {
  constructor(readonly baseUrl: string, readonly cause: unknown) {
    super(
      `Could not reach the DevHub dashboard at ${baseUrl}. Start it with \`npm run dev\` ` +
        `(or set DEVHUB_BASE_URL if it runs on another port).`,
    );
    this.name = "DashboardUnreachableError";
  }
}

export class DashboardClient {
  constructor(readonly baseUrl: string) {}

  private buildUrl(path: string, query?: DashboardRequestOptions["query"]): string {
    const url = new URL(path.replace(/^\//, ""), this.baseUrl.endsWith("/") ? this.baseUrl : `${this.baseUrl}/`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
  }

  /** Perform a request and return the parsed JSON (or text) body. Throws on non-2xx / unreachable. */
  async request<T = unknown>(path: string, opts: DashboardRequestOptions = {}): Promise<T> {
    const { method = "GET", body, query, timeoutMs = 30_000 } = opts;
    const url = this.buildUrl(path, query);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        signal: controller.signal,
        headers: body !== undefined ? { "content-type": "application/json" } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      throw new DashboardUnreachableError(this.baseUrl, err);
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    let payload: unknown = text;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        /* leave as text */
      }
    }

    if (!res.ok) {
      const detail =
        payload && typeof payload === "object" && "error" in payload
          ? String((payload as { error: unknown }).error)
          : res.statusText || `HTTP ${res.status}`;
      throw new DashboardHttpError(res.status, payload, `Dashboard ${method} ${path} failed (${res.status}): ${detail}`);
    }
    return payload as T;
  }

  get<T = unknown>(path: string, query?: DashboardRequestOptions["query"], timeoutMs?: number): Promise<T> {
    return this.request<T>(path, { method: "GET", query, timeoutMs });
  }

  post<T = unknown>(path: string, body?: unknown, timeoutMs?: number): Promise<T> {
    return this.request<T>(path, { method: "POST", body, timeoutMs });
  }
}

/**
 * Wrap a dashboard-backed tool handler so any client error becomes a clean MCP
 * error result instead of an exception. Keeps every proxy tool's catch block
 * identical.
 */
export async function withDashboardErrors(
  fn: () => Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }>,
): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof DashboardUnreachableError || err instanceof DashboardHttpError) {
      return { content: [{ type: "text", text: err.message }], isError: true };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text", text: `Unexpected error: ${message}` }], isError: true };
  }
}
