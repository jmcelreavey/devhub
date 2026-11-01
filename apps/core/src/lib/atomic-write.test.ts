import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeAtomic, writeAtomicNow, safeReadJSON } from "./atomic-write";

function tmpdir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "devhub-atomic-"));
}

describe("writeAtomic", () => {
  let dir: string;
  beforeEach(() => {
    dir = tmpdir();
  });

  it("writes content atomically", async () => {
    const file = path.join(dir, "task.json");
    await writeAtomic(file, JSON.stringify({ a: 1 }));
    expect(JSON.parse(fs.readFileSync(file, "utf-8"))).toEqual({ a: 1 });
  });

  it("creates parent directories", async () => {
    const file = path.join(dir, "deep", "nested", "task.json");
    await writeAtomic(file, "{}");
    expect(fs.existsSync(file)).toBe(true);
  });

  it("serializes concurrent writes to the same file (last call wins, none lost)", async () => {
    const file = path.join(dir, "race.json");
    await Promise.all([
      writeAtomic(file, "1"),
      writeAtomic(file, "2"),
      writeAtomic(file, "3"),
      writeAtomic(file, "4"),
      writeAtomic(file, "5"),
    ]);
    const final = fs.readFileSync(file, "utf-8");
    expect(["1", "2", "3", "4", "5"]).toContain(final);
    // No leftover .tmp files
    const stragglers = fs.readdirSync(dir).filter((f) => f.endsWith(".tmp"));
    expect(stragglers).toEqual([]);
  });

  it("writeAtomicNow performs synchronous atomic replace", () => {
    const file = path.join(dir, "sync.json");
    writeAtomicNow(file, "hello");
    expect(fs.readFileSync(file, "utf-8")).toBe("hello");
  });
});

describe("safeReadJSON", () => {
  let dir: string;
  beforeEach(() => {
    dir = tmpdir();
  });

  it("returns fallback when file does not exist", () => {
    const result = safeReadJSON(path.join(dir, "missing.json"), { default: true });
    expect(result).toEqual({ default: true });
  });

  it("returns parsed JSON when file is valid", () => {
    const file = path.join(dir, "valid.json");
    fs.writeFileSync(file, JSON.stringify([1, 2, 3]));
    expect(safeReadJSON<number[]>(file, [])).toEqual([1, 2, 3]);
  });

  it("renames corrupt file and returns fallback", () => {
    const file = path.join(dir, "corrupt.json");
    fs.writeFileSync(file, "not valid json {");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = safeReadJSON<unknown[]>(file, []);
    expect(result).toEqual([]);
    expect(fs.existsSync(file)).toBe(false);
    const renamed = fs.readdirSync(dir).filter((f) => f.includes(".corrupt-"));
    expect(renamed).toHaveLength(1);
    error.mockRestore();
  });
});
