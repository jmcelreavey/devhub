import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "../context.ts";
import { registerDbTools, toPlainExplain } from "./db.ts";

/**
 * `db_explain` promises a plan without running the statement. ANALYZE breaks
 * that promise by executing it, so any caller-supplied ANALYZE has to be
 * stripped rather than passed through — otherwise an *explain* tool can delete
 * rows.
 */
describe("toPlainExplain", () => {
  it("prefixes a bare statement", () => {
    expect(toPlainExplain("SELECT 1")).toBe("EXPLAIN SELECT 1");
  });

  it("leaves an already-plain EXPLAIN as one", () => {
    expect(toPlainExplain("EXPLAIN SELECT 1")).toBe("EXPLAIN SELECT 1");
  });

  it("strips ANALYZE so the statement is not executed", () => {
    expect(toPlainExplain("EXPLAIN ANALYZE DELETE FROM posts")).toBe("EXPLAIN DELETE FROM posts");
  });

  it("strips the British spelling too", () => {
    expect(toPlainExplain("EXPLAIN ANALYSE DELETE FROM posts")).toBe("EXPLAIN DELETE FROM posts");
  });

  it("strips parenthesised options", () => {
    expect(toPlainExplain("EXPLAIN (ANALYZE, BUFFERS) UPDATE t SET a = 1")).toBe(
      "EXPLAIN UPDATE t SET a = 1",
    );
  });

  it("is case- and whitespace-insensitive", () => {
    expect(toPlainExplain("  explain   analyze   DELETE FROM t  ")).toBe("EXPLAIN DELETE FROM t");
  });

  it("keeps VERBOSE out of the reissued statement", () => {
    expect(toPlainExplain("EXPLAIN VERBOSE SELECT 1")).toBe("EXPLAIN SELECT 1");
  });

  /** A column or table named "explaining" must not be mistaken for the keyword. */
  it("does not strip a word that merely starts with explain", () => {
    expect(toPlainExplain("SELECT explaining FROM t")).toBe("EXPLAIN SELECT explaining FROM t");
  });
});

describe("db_explain", () => {
  const handlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();
  const post = vi.fn();

  beforeEach(() => {
    handlers.clear();
    post.mockReset();
    const server = {
      registerTool: (
        name: string,
        _config: unknown,
        handler: (args: Record<string, unknown>) => Promise<unknown>,
      ) => handlers.set(name, handler),
    } as unknown as McpServer;
    registerDbTools(server, { dashboard: { post } } as unknown as Context);
  });

  it("refuses a batch before issuing EXPLAIN", async () => {
    post.mockResolvedValueOnce({
      statements: [{ sql: "SELECT 1" }, { sql: "DELETE FROM posts" }],
      connection: { engine: "postgres" },
    });

    const result = await handlers.get("db_explain")!({
      connectionId: "local:test",
      statement: "SELECT 1; DELETE FROM posts",
    });

    expect(post).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ isError: true });
  });

  it("plans and explains the normalized single statement", async () => {
    post
      .mockResolvedValueOnce({
        statements: [{ sql: "EXPLAIN ANALYZE SELECT 1" }],
        connection: { engine: "postgres" },
      })
      .mockResolvedValueOnce({ columns: ["QUERY PLAN"], rows: [] });

    await handlers.get("db_explain")!({
      connectionId: "local:test",
      statement: "EXPLAIN ANALYZE SELECT 1",
    });

    expect(post).toHaveBeenNthCalledWith(2, "/api/db/local%3Atest/query", {
      statement: "EXPLAIN SELECT 1",
    });
  });
});
