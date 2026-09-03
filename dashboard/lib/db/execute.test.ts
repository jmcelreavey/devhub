import { describe, expect, it } from "vitest";
import { planExecution, planStatements } from "./execute";
import type { DbConnectionRef } from "./types";

const connection = (over: Partial<DbConnectionRef> = {}): DbConnectionRef => ({
  id: "bi:rds:capi:dev",
  label: "CAPI · dev",
  engine: "postgres",
  accessMode: "read",
  dangerous: false,
  source: "plugin:bi",
  ...over,
});

describe("planStatements", () => {
  it("splits a SQL batch", () => {
    const plan = planStatements(connection(), "SELECT 1; SELECT 2");
    expect(plan.statements).toHaveLength(2);
    expect(plan.kind).toBe("read");
  });

  /** A Mongo command has no separator, so a batch is always exactly one. */
  it("treats a Mongo command as a single statement", () => {
    const plan = planStatements(
      connection({ engine: "mongodb" }),
      "db.posts.find({})",
    );
    expect(plan.statements).toHaveLength(1);
    expect(plan.kind).toBe("read");
  });

  it("classifies a Mongo write", () => {
    const plan = planStatements(
      connection({ engine: "mongodb" }),
      "db.posts.deleteMany({})",
    );
    expect(plan.kind).toBe("write");
  });
});

describe("planExecution", () => {
  it("allows a read on a read-only connection", () => {
    const plan = planExecution(connection(), "SELECT * FROM posts");
    expect(plan.refusal).toBeUndefined();
    expect(plan.needsConfirmation).toBe(false);
  });

  it("refuses a write on a read-only connection and names the connection", () => {
    const plan = planExecution(connection(), "UPDATE posts SET title = 'x'");
    expect(plan.refusal?.code).toBe("read_only");
    expect(plan.refusal?.message).toContain("CAPI · dev");
    expect(plan.refusal?.message).toMatch(/read-only/);
  });

  /** A batch is refused if any statement in it would be. */
  it("refuses a batch whose second statement writes", () => {
    const plan = planExecution(connection(), "SELECT 1;\nDELETE FROM posts");
    expect(plan.refusal?.code).toBe("read_only");
    expect(plan.refusal?.message).toContain("DELETE FROM posts");
  });

  it("carries the classifier's reason into the message", () => {
    const plan = planExecution(
      connection(),
      "WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d",
    );
    expect(plan.refusal?.message).toMatch(/CTE contains DELETE/);
  });

  /** unknown fails closed — this is the property that must not regress. */
  it("refuses an unclassifiable statement on a read-only connection", () => {
    const plan = planExecution(connection(), "DO $$ BEGIN PERFORM 1; END $$");
    expect(plan.refusal?.code).toBe("read_only");
  });

  it("allows a write on a write connection", () => {
    const plan = planExecution(
      connection({ accessMode: "write" }),
      "UPDATE posts SET title = 'x'",
    );
    expect(plan.refusal).toBeUndefined();
    expect(plan.needsConfirmation).toBe(false);
  });

  it("refuses a write when the caller requires a read, even on a write connection", () => {
    const plan = planExecution(
      connection({ accessMode: "write" }),
      "DELETE FROM posts",
      "read",
    );
    expect(plan.refusal?.code).toBe("read_required");
    expect(plan.refusal?.message).toContain("guarded write endpoint");
  });

  it("requires confirmation for a write on a dangerous connection", () => {
    const plan = planExecution(
      connection({ accessMode: "write", dangerous: true, label: "CAPI · prd" }),
      "DELETE FROM posts WHERE id = 1",
    );
    expect(plan.refusal).toBeUndefined();
    expect(plan.needsConfirmation).toBe(true);
  });

  /** Reading prd is routine; only changing it needs ceremony. */
  it("does not require confirmation to read a dangerous connection", () => {
    const plan = planExecution(
      connection({ accessMode: "write", dangerous: true }),
      "SELECT * FROM posts",
    );
    expect(plan.needsConfirmation).toBe(false);
  });

  it("refuses a Mongo aggregate that writes on a read-only connection", () => {
    const plan = planExecution(
      connection({ engine: "mongodb" }),
      "db.posts.aggregate([{ $out: 'copy' }])",
    );
    expect(plan.refusal?.code).toBe("read_only");
    expect(plan.refusal?.message).toMatch(/\$out/);
  });
});
