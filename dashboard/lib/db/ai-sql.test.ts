import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DbConnectionRef } from "./types";

const generateAiText = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ai/generate", () => ({ generateAiText }));

const {
  AiSqlRefusedError,
  extractSql,
  generateSql,
  renderSchemaForPrompt,
  selectRelevantTables,
} = await import("./ai-sql");

const connection = (over: Partial<DbConnectionRef> = {}): DbConnectionRef => ({
  id: "local:demo",
  label: "Demo",
  engine: "postgres",
  accessMode: "read",
  dangerous: false,
  source: "user",
  ...over,
});

beforeEach(() => {
  generateAiText.mockReset();
});

describe("extractSql", () => {
  it("returns a bare statement unchanged", () => {
    expect(extractSql("SELECT 1")).toBe("SELECT 1");
  });

  /** Models add fences even when told not to. */
  it("unwraps a fenced block", () => {
    expect(extractSql("```sql\nSELECT 1\n```")).toBe("SELECT 1");
    expect(extractSql("```\nSELECT 1\n```")).toBe("SELECT 1");
  });

  it("unwraps a fence that follows a preamble", () => {
    expect(extractSql("Here you go:\n\n```sql\nSELECT 1\n```\n")).toBe("SELECT 1");
  });

  it("handles a JSON fence for Mongo commands", () => {
    expect(extractSql('```json\n{"collection":"p","operation":"find"}\n```')).toBe(
      '{"collection":"p","operation":"find"}',
    );
  });
});

describe("renderSchemaForPrompt", () => {
  it("renders tables compactly with types and keys", () => {
    expect(
      renderSchemaForPrompt([
        {
          namespace: "public",
          name: "posts",
          columns: [
            { name: "id", dataType: "int4", nullable: false, primaryKey: true },
            { name: "title", dataType: "text", nullable: true, primaryKey: false },
          ],
        },
      ]),
    ).toBe("- public.posts(id int4 PK NOT NULL, title text)");
  });

  /** SQLite's single namespace is noise in a prompt. */
  it("does not qualify the SQLite namespace", () => {
    expect(renderSchemaForPrompt([{ namespace: "main", name: "posts" }])).toBe("- posts");
  });

  it("lists a table with no known columns by name alone", () => {
    expect(renderSchemaForPrompt([{ namespace: "public", name: "posts" }])).toBe("- public.posts");
  });
});

describe("selectRelevantTables", () => {
  /** When the list is trimmed, the table the user is looking at must survive. */
  it("puts the focused table first", () => {
    const objects = [
      { namespace: "public", name: "authors", kind: "table" as const },
      { namespace: "public", name: "posts", kind: "table" as const },
    ];
    expect(
      selectRelevantTables(objects, { namespace: "public", name: "posts" }).map((t) => t.name),
    ).toEqual(["posts", "authors"]);
  });

  it("preserves order when nothing is focused", () => {
    const objects = [
      { namespace: "public", name: "authors", kind: "table" as const },
      { namespace: "public", name: "posts", kind: "table" as const },
    ];
    expect(selectRelevantTables(objects, null).map((t) => t.name)).toEqual(["authors", "posts"]);
  });
});

describe("generateSql", () => {
  const request = {
    connection: connection(),
    prompt: "everything",
    tables: [{ namespace: "public", name: "posts" }],
    mode: "generate" as const,
  };

  it("returns the model's SQL", async () => {
    generateAiText.mockResolvedValue({ text: "SELECT * FROM posts LIMIT 10", provider: "api" });
    expect((await generateSql(request)).sql).toBe("SELECT * FROM posts LIMIT 10");
  });

  /**
   * The prompt asks for a read; this is what happens when the model ignores it.
   * A prompt is a request, not a constraint, so the output is re-classified.
   */
  it("refuses a write the model produced for a read-only connection", async () => {
    generateAiText.mockResolvedValue({ text: "DELETE FROM posts", provider: "api" });
    await expect(generateSql(request)).rejects.toThrow(AiSqlRefusedError);
  });

  it("refuses a mutation hidden in a CTE", async () => {
    generateAiText.mockResolvedValue({
      text: "WITH d AS (DELETE FROM posts RETURNING *) SELECT * FROM d",
      provider: "api",
    });
    await expect(generateSql(request)).rejects.toThrow(/read-only/);
  });

  it("allows a write when the connection permits one", async () => {
    generateAiText.mockResolvedValue({ text: "DELETE FROM posts WHERE id = 1", provider: "api" });
    const result = await generateSql({
      ...request,
      connection: connection({ accessMode: "write" }),
    });
    expect(result.sql).toBe("DELETE FROM posts WHERE id = 1");
  });

  /**
   * Mongo has no SQL classifier, so the guard cannot apply — the adapter's
   * command allowlist is what holds there instead.
   */
  it("does not run the SQL classifier over a Mongo command", async () => {
    generateAiText.mockResolvedValue({ text: "db.posts.find({}).limit(10)", provider: "api" });
    const result = await generateSql({
      ...request,
      connection: connection({ engine: "mongodb" }),
    });
    expect(result.sql).toBe("db.posts.find({}).limit(10)");
  });

  it("returns prose as a note in explain mode", async () => {
    generateAiText.mockResolvedValue({ text: "It counts the posts.", provider: "api" });
    const result = await generateSql({ ...request, mode: "explain" });
    expect(result.sql).toBe("");
    expect(result.note).toBe("It counts the posts.");
  });

  it("fails when the model returns nothing usable", async () => {
    generateAiText.mockResolvedValue({ text: "   ", provider: "api" });
    await expect(generateSql(request)).rejects.toThrow(/nothing usable/);
  });

  it("tells the model when the connection is read-only", async () => {
    generateAiText.mockResolvedValue({ text: "SELECT 1", provider: "api" });
    await generateSql(request);
    expect(generateAiText.mock.calls[0][0].system).toMatch(/READ-ONLY/);
  });

  it("warns the model when the connection is production", async () => {
    generateAiText.mockResolvedValue({ text: "SELECT 1", provider: "api" });
    await generateSql({ ...request, connection: connection({ dangerous: true }) });
    expect(generateAiText.mock.calls[0][0].system).toMatch(/PRODUCTION/);
  });

  it("sends the schema and the failing error when fixing", async () => {
    generateAiText.mockResolvedValue({ text: "SELECT 1", provider: "api" });
    await generateSql({ ...request, mode: "fix", statement: "SELECT bad", error: "no column bad" });
    const prompt = generateAiText.mock.calls[0][0].prompt as string;
    expect(prompt).toContain("- public.posts");
    expect(prompt).toContain("SELECT bad");
    expect(prompt).toContain("no column bad");
  });
});
