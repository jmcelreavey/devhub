import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "../context.ts";
import {
  formatConnectionLine,
  formatExecutionResult,
  formatSchema,
  formatTable,
  registerDbTools,
  toPlainExplain,
} from "./db.ts";

describe("formatConnectionLine", () => {
  it("prints the exact confirmation label for a dangerous write connection", () => {
    expect(
      formatConnectionLine({
        id: "bi:mongo:fantasy-stocks:prd",
        label: "Fantasy Stocks · prd",
        engine: "mongodb",
        accessMode: "write",
        dangerous: true,
      }),
    ).toContain('confirmLabel: "Fantasy Stocks · prd"');
  });

  it("does not add a confirmation label to read-only connections", () => {
    expect(
      formatConnectionLine({
        id: "bi:mongo:fantasy-stocks:prd",
        label: "Fantasy Stocks · prd",
        engine: "mongodb",
        accessMode: "read",
        dangerous: true,
      }),
    ).not.toContain("confirmLabel");
  });
});

describe("compact database output", () => {
  it("does not repeat statements in execution results", () => {
    const output = formatExecutionResult({
      connectionId: "bi:rds:idun:prd",
      kind: "write",
      durationMs: 12,
      results: [{ columns: [], rows: [], rowsAffected: 1, durationMs: 10 }],
    });

    expect(output).toContain("1 row affected");
    expect(output).not.toContain("UPDATE");
  });

  it("omits system objects from compact schemas by default", () => {
    const output = formatSchema({
      engine: "postgres",
      namespaces: [
        { name: "pg_catalog", system: true },
        { name: "public", system: false },
      ],
      objects: [
        { namespace: "pg_catalog", name: "pg_type", kind: "table" },
        {
          namespace: "public",
          name: "Articles",
          kind: "table",
          estimatedRows: 12,
        },
      ],
    });

    expect(output).toContain("public.Articles");
    expect(output).not.toContain("pg_catalog.pg_type");
  });

  it("summarizes a table without duplicating its DDL", () => {
    const output = formatTable({
      namespace: "public",
      name: "Articles",
      kind: "table",
      columns: [
        { name: "id", dataType: "uuid", nullable: false, primaryKey: true },
      ],
      indexes: [{ name: "Articles_pkey", primary: true, columns: ["id"] }],
    });

    expect(output).toContain("id · uuid · required · primary key");
    expect(output).not.toContain("CREATE TABLE");
  });
});

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
    expect(toPlainExplain("EXPLAIN ANALYZE DELETE FROM posts")).toBe(
      "EXPLAIN DELETE FROM posts",
    );
  });

  it("strips the British spelling too", () => {
    expect(toPlainExplain("EXPLAIN ANALYSE DELETE FROM posts")).toBe(
      "EXPLAIN DELETE FROM posts",
    );
  });

  it("strips parenthesised options", () => {
    expect(
      toPlainExplain("EXPLAIN (ANALYZE, BUFFERS) UPDATE t SET a = 1"),
    ).toBe("EXPLAIN UPDATE t SET a = 1");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(toPlainExplain("  explain   analyze   DELETE FROM t  ")).toBe(
      "EXPLAIN DELETE FROM t",
    );
  });

  it("keeps VERBOSE out of the reissued statement", () => {
    expect(toPlainExplain("EXPLAIN VERBOSE SELECT 1")).toBe("EXPLAIN SELECT 1");
  });

  /** A column or table named "explaining" must not be mistaken for the keyword. */
  it("does not strip a word that merely starts with explain", () => {
    expect(toPlainExplain("SELECT explaining FROM t")).toBe(
      "EXPLAIN SELECT explaining FROM t",
    );
  });
});

describe("db_explain", () => {
  const handlers = new Map<
    string,
    (args: Record<string, unknown>) => Promise<unknown>
  >();
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

describe("db_connect", () => {
  const handlers = new Map<
    string,
    (args: Record<string, unknown>) => Promise<unknown>
  >();
  const get = vi.fn();
  const post = vi.fn();

  beforeEach(() => {
    handlers.clear();
    get.mockReset();
    post.mockReset();
    const server = {
      registerTool: (
        name: string,
        _config: unknown,
        handler: (args: Record<string, unknown>) => Promise<unknown>,
      ) => handlers.set(name, handler),
    } as unknown as McpServer;
    registerDbTools(server, { dashboard: { get, post } } as unknown as Context);
  });

  it("requests and applies a write-capable profile remedy", async () => {
    get
      .mockResolvedValueOnce({
        ok: false,
        checks: [
          {
            label: "AWS profile",
            status: "fail",
            detail: "Writer profile required.",
            remedy: {
              id: "aws-profile",
              label: "Sign in to dev-dad+",
              endpoint: "/api/bi/aws-profile",
              body: { profile: "dev-dad+" },
            },
          },
        ],
      })
      .mockResolvedValueOnce({ ok: true, checks: [] });
    post.mockResolvedValue({ ok: true });

    await handlers.get("db_connect")!({
      connectionId: "bi:mongo:fantasy-stocks:dev",
      accessMode: "write",
      fix: true,
    });

    expect(get).toHaveBeenNthCalledWith(
      1,
      "/api/db/bi%3Amongo%3Afantasy-stocks%3Adev/preflight",
      { accessMode: "write" },
    );
    expect(post).toHaveBeenCalledWith(
      "/api/bi/aws-profile",
      { profile: "dev-dad+" },
      300_000,
    );
  });
});

describe("db_query", () => {
  it("executes once with a read-only intent and compact row limit", async () => {
    const handlers = new Map<
      string,
      (args: Record<string, unknown>) => Promise<unknown>
    >();
    const post = vi.fn().mockResolvedValue({
      connectionId: "local:test",
      kind: "read",
      durationMs: 2,
      results: [
        {
          columns: [{ name: "value" }],
          rows: [[1]],
          truncated: false,
          durationMs: 1,
        },
      ],
    });
    const server = {
      registerTool: (
        name: string,
        _config: unknown,
        handler: (args: Record<string, unknown>) => Promise<unknown>,
      ) => handlers.set(name, handler),
    } as unknown as McpServer;
    registerDbTools(server, { dashboard: { post } } as unknown as Context);

    const result = await handlers.get("db_query")!({
      connectionId: "local:test",
      statement: "SELECT 1",
    });

    expect(post).toHaveBeenCalledOnce();
    expect(post).toHaveBeenCalledWith(
      "/api/db/local%3Atest/query",
      {
        statement: "SELECT 1",
        rowLimit: 100,
        timeoutMs: undefined,
        readOnly: true,
      },
      70_000,
    );
    expect(result).toMatchObject({
      content: [{ text: expect.stringContaining("Result 1: 1 row") }],
    });
  });
});
