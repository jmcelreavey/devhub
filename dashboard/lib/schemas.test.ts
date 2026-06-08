import { describe, it, expect } from "vitest";
import { NoteOrderPatchSchema, TaskCreateSchema, TaskPatchSchema, TaskDeleteSchema, TaskReorderSchema } from "./schemas";

describe("TaskCreateSchema", () => {
  it("accepts valid input", () => {
    const r = TaskCreateSchema.safeParse({ text: "Pick up groceries" });
    expect(r.success).toBe(true);
  });

  it("accepts optional due date", () => {
    const r = TaskCreateSchema.safeParse({ text: "x", due: "2026-05-08" });
    expect(r.success).toBe(true);
  });

  it("rejects empty text", () => {
    const r = TaskCreateSchema.safeParse({ text: "" });
    expect(r.success).toBe(false);
  });

  it("rejects malformed due", () => {
    const r = TaskCreateSchema.safeParse({ text: "x", due: "yesterday" });
    expect(r.success).toBe(false);
  });

  it("rejects oversized text", () => {
    const r = TaskCreateSchema.safeParse({ text: "a".repeat(501) });
    expect(r.success).toBe(false);
  });
});

describe("TaskPatchSchema", () => {
  it("requires id", () => {
    const r = TaskPatchSchema.safeParse({ done: true });
    expect(r.success).toBe(false);
  });

  it("requires at least one updatable field", () => {
    const r = TaskPatchSchema.safeParse({ id: "abc" });
    expect(r.success).toBe(false);
  });

  it("accepts due null (clear)", () => {
    const r = TaskPatchSchema.safeParse({ id: "abc", due: null });
    expect(r.success).toBe(true);
  });

  it("accepts status abandoned with reason", () => {
    const r = TaskPatchSchema.safeParse({ id: "abc", status: "abandoned", abandonReason: "deprioritized" });
    expect(r.success).toBe(true);
  });

  it("rejects invalid status", () => {
    const r = TaskPatchSchema.safeParse({ id: "abc", status: "unknown" });
    expect(r.success).toBe(false);
  });
});

describe("TaskDeleteSchema", () => {
  it("requires id", () => {
    expect(TaskDeleteSchema.safeParse({}).success).toBe(false);
    expect(TaskDeleteSchema.safeParse({ id: "x" }).success).toBe(true);
  });
});

describe("TaskReorderSchema", () => {
  it("accepts task ids", () => {
    expect(TaskReorderSchema.safeParse({ ids: ["one", "two"] }).success).toBe(true);
  });

  it("rejects empty order", () => {
    expect(TaskReorderSchema.safeParse({ ids: [] }).success).toBe(false);
  });
});

describe("NoteOrderPatchSchema", () => {
  it("accepts explicit sibling orders", () => {
    expect(NoteOrderPatchSchema.safeParse({ paths: ["beta.json", "alpha.json"] }).success).toBe(true);
  });

  it("rejects empty explicit sibling orders", () => {
    expect(NoteOrderPatchSchema.safeParse({ paths: [] }).success).toBe(false);
  });
});
