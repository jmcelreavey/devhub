import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DbClient, DbEngineAdapter } from "./adapter";
import type { ResolvedDbConnection } from "./types";

const resolveDbConnection = vi.hoisted(() => vi.fn<(id: string) => Promise<ResolvedDbConnection>>());
vi.mock("./registry", () => ({ resolveDbConnection }));

const {
  acquire,
  cancelConnection,
  closeAllConnections,
  closeConnection,
  isTimeoutError,
  listOpenConnections,
  registerAdapterForTests,
  resetPool,
  runStatement,
  sweepIdleConnections,
} = await import("./pool");
const { resetQueryRegistry, listSlowQueries } = await import("./query-registry");
const { DB_IDLE_EVICT_MS } = await import("./timeouts");

/** A fake engine that records what the pool asked it to do. */
function fakeAdapter() {
  const calls = { open: 0, close: 0, ping: 0, run: 0, cancel: 0 };
  let pingFails = false;
  let runImpl: (statement: string) => Promise<unknown> = async () => undefined;

  const adapter: DbEngineAdapter = {
    engine: "postgres",
    async open() {
      calls.open++;
      return { id: calls.open } as DbClient;
    },
    async close() {
      calls.close++;
    },
    async ping() {
      calls.ping++;
      if (pingFails) throw new Error("connection is dead");
    },
    async run(_client, statement) {
      calls.run++;
      await runImpl(statement);
      return { columns: [], rows: [], truncated: false, durationMs: 1, statement };
    },
    async cancel() {
      calls.cancel++;
      return true;
    },
  };

  return {
    adapter,
    calls,
    failPing: (fail: boolean) => {
      pingFails = fail;
    },
    setRun: (impl: (statement: string) => Promise<unknown>) => {
      runImpl = impl;
    },
  };
}

const resolved = (over: Partial<ResolvedDbConnection> = {}): ResolvedDbConnection => ({
  id: "local:test",
  engine: "postgres",
  accessMode: "read",
  dangerous: false,
  postgres: { host: "h", port: 5432, database: "d", user: "u", password: "p", ssl: false },
  ...over,
});

let fake: ReturnType<typeof fakeAdapter>;

beforeEach(() => {
  fake = fakeAdapter();
  registerAdapterForTests("postgres", fake.adapter);
  resolveDbConnection.mockReset();
  resolveDbConnection.mockResolvedValue(resolved());
  resetQueryRegistry();
});

afterEach(async () => {
  await resetPool();
  vi.useRealTimers();
});

describe("acquire", () => {
  it("opens once and reuses the connection", async () => {
    await acquire("local:test");
    await acquire("local:test");
    expect(fake.calls.open).toBe(1);
    expect(fake.calls.ping).toBe(1);
  });

  /**
   * Two panels mounting at once must not mint two IAM tokens for one click.
   */
  it("shares a single open between concurrent callers", async () => {
    await Promise.all([acquire("local:test"), acquire("local:test"), acquire("local:test")]);
    expect(fake.calls.open).toBe(1);
  });

  /**
   * A pooled connection can be killed server-side by a failover or an idle
   * reaper. Discovering that through the user's next query is a bad way to
   * learn it.
   */
  it("reopens transparently when the cached connection fails its ping", async () => {
    const first = await acquire("local:test");
    fake.failPing(true);

    const second = await acquire("local:test");
    expect(second.client).not.toBe(first.client);
    expect(fake.calls.open).toBe(2);
    expect(fake.calls.close).toBe(1);
  });

  /**
   * The pool routes by `resolved.engine`, so a connection whose engine and
   * payload disagree reaches the wrong adapter. Better a named error than a
   * driver crash on an undefined host.
   */
  it("surfaces an engine/target mismatch as a readable error", async () => {
    resolveDbConnection.mockResolvedValue(resolved({ engine: "mongodb" }));
    await expect(acquire("local:test")).rejects.toThrow(/not a MongoDB target/);
  });
});

describe("runStatement", () => {
  it("runs on the pooled connection and returns the result", async () => {
    const result = await runStatement("local:test", "SELECT 1", { readOnly: true });
    expect(result.statement).toBe("SELECT 1");
    expect(fake.calls.run).toBe(1);
  });

  /**
   * Both engines authenticate at connect time, so a live socket outlives its
   * password. The pool must reopen before the credentials are spent rather than
   * fail on the next reconnect.
   */
  it("reopens when the credentials have aged out", async () => {
    resolveDbConnection.mockResolvedValue(resolved({ expiresAt: Date.now() + 1_000 }));
    await acquire("local:test");
    expect(fake.calls.open).toBe(1);

    await runStatement("local:test", "SELECT 1", { readOnly: true });
    expect(fake.calls.open).toBe(2);
    expect(fake.calls.close).toBe(1);
  });

  it("keeps a connection whose credentials are still good", async () => {
    resolveDbConnection.mockResolvedValue(resolved({ expiresAt: Date.now() + 60 * 60_000 }));
    await acquire("local:test");
    await runStatement("local:test", "SELECT 1", { readOnly: true });
    expect(fake.calls.open).toBe(1);
  });

  it("records a timed-out query in the registry", async () => {
    fake.setRun(async () => {
      throw Object.assign(new Error("canceling statement due to statement timeout"), {
        code: "57014",
      });
    });
    await expect(runStatement("local:test", "SELECT pg_sleep(600)", { readOnly: true })).rejects.toThrow();
    expect(listSlowQueries()[0]?.timedOut).toBe(true);
  });

  it("releases the busy count even when the statement throws", async () => {
    fake.setRun(async () => {
      throw new Error("boom");
    });
    await expect(runStatement("local:test", "SELECT 1", { readOnly: true })).rejects.toThrow("boom");
    expect(listOpenConnections()[0].busy).toBe(0);
  });
});

describe("eviction", () => {
  it("closes connections idle past the ceiling", async () => {
    await acquire("local:test");
    await sweepIdleConnections(Date.now() + DB_IDLE_EVICT_MS + 1);
    expect(fake.calls.close).toBe(1);
    expect(listOpenConnections()).toEqual([]);
  });

  it("never evicts a connection with a statement running", async () => {
    let release: () => void = () => {};
    fake.setRun(() => new Promise<void>((resolve) => (release = resolve)));

    const running = runStatement("local:test", "SELECT pg_sleep(5)", { readOnly: true });
    await vi.waitFor(() => expect(listOpenConnections()[0]?.busy).toBe(1));

    await sweepIdleConnections(Date.now() + DB_IDLE_EVICT_MS + 1);
    expect(fake.calls.close).toBe(0);

    release();
    await running;
  });
});

describe("cancel and close", () => {
  it("cancels through the adapter", async () => {
    await acquire("local:test");
    expect(await cancelConnection("local:test")).toBe(true);
    expect(fake.calls.cancel).toBe(1);
  });

  it("reports false when nothing is open", async () => {
    expect(await cancelConnection("local:nothing")).toBe(false);
  });

  it("closes everything on demand", async () => {
    await acquire("local:test");
    await closeAllConnections();
    expect(listOpenConnections()).toEqual([]);
    expect(fake.calls.close).toBe(1);
  });

  it("is a no-op closing a connection that was never opened", async () => {
    await expect(closeConnection("local:nothing")).resolves.toBeUndefined();
  });
});

describe("isTimeoutError", () => {
  /** Matched on structure and engine codes, never on message text. */
  it("recognises the engines' own cancellation codes", () => {
    expect(isTimeoutError({ code: "57014" })).toBe(true);
    expect(isTimeoutError({ code: 50 })).toBe(true);
    expect(isTimeoutError({ name: "AbortError" })).toBe(true);
    expect(isTimeoutError(new Error("timed out"))).toBe(false);
    expect(isTimeoutError(null)).toBe(false);
  });
});
