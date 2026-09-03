import { afterEach, describe, expect, it } from "vitest";
import {
  beginQuery,
  endQuery,
  listInFlightQueries,
  listSlowQueries,
  markQueryCancellable,
  resetQueryRegistry,
  summarizeStatement,
} from "./query-registry";

afterEach(() => resetQueryRegistry());

describe("summarizeStatement", () => {
  it("collapses whitespace to one line", () => {
    expect(summarizeStatement("SELECT *\n  FROM users\n  WHERE id = 1")).toBe(
      "SELECT * FROM users WHERE id = 1",
    );
  });

  it("truncates long statements", () => {
    const summary = summarizeStatement(`SELECT ${"a".repeat(300)}`, 40);
    expect(summary).toHaveLength(40);
    expect(summary.endsWith("…")).toBe(true);
  });

  /**
   * This string reaches the status page and an MCP tool, so a connection string
   * pasted into the editor must not survive the trip.
   */
  it("redacts connection strings and inline passwords", () => {
    expect(summarizeStatement("SELECT dblink('postgres://u:p@host/db')")).toContain(
      "postgres://‹redacted›",
    );
    expect(summarizeStatement("CREATE ROLE bob PASSWORD 'hunter2'")).toBe(
      "CREATE ROLE bob PASSWORD '‹redacted›'",
    );
  });
});

describe("query registry", () => {
  const query = { connectionId: "bi:rds:capi:dev", engine: "postgres" as const, timeoutMs: 60_000 };

  it("reports a query as in flight until it ends", () => {
    const id = beginQuery({ ...query, statement: "SELECT 1" });
    expect(listInFlightQueries().map((q) => q.summary)).toEqual(["SELECT 1"]);
    endQuery(id, { ok: true, timedOut: false });
    expect(listInFlightQueries()).toEqual([]);
  });

  it("orders in-flight queries oldest first", () => {
    beginQuery({ ...query, statement: "first" });
    beginQuery({ ...query, statement: "second" });
    expect(listInFlightQueries().map((q) => q.summary)).toEqual(["first", "second"]);
  });

  it("tracks cancellability once the engine reports a handle", () => {
    const id = beginQuery({ ...query, statement: "SELECT pg_sleep(60)" });
    expect(listInFlightQueries()[0].cancellable).toBe(false);
    markQueryCancellable(id);
    expect(listInFlightQueries()[0].cancellable).toBe(true);
  });

  it("does not record fast, successful queries", () => {
    const id = beginQuery({ ...query, statement: "SELECT 1" });
    endQuery(id, { ok: true, timedOut: false });
    expect(listSlowQueries()).toEqual([]);
  });

  /** However short the ceiling was, hitting it is the interesting event. */
  it("always records a timeout", () => {
    const id = beginQuery({ ...query, statement: "SELECT pg_sleep(600)" });
    endQuery(id, { ok: false, timedOut: true });
    expect(listSlowQueries()).toHaveLength(1);
    expect(listSlowQueries()[0].timedOut).toBe(true);
  });

  it("ignores an unknown id", () => {
    expect(() => endQuery(999, { ok: true, timedOut: false })).not.toThrow();
  });
});
