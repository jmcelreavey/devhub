import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readUserConnections, writeUserConnections } from "./user-connections";

const dirs: string[] = [];

function tempFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-db-connections-"));
  dirs.push(dir);
  return path.join(dir, "connections.json");
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("saved database connections", () => {
  it("treats a missing store as an empty first run", () => {
    expect(readUserConnections(tempFile())).toEqual([]);
  });

  it("reports a malformed store instead of silently hiding every connection", () => {
    const file = tempFile();
    fs.writeFileSync(file, "not json");
    expect(() => readUserConnections(file)).toThrow(/Could not read saved database connections/);
  });

  it("writes credentials with owner-only permissions", () => {
    const file = tempFile();
    writeUserConnections(
      [{ slug: "local", label: "Local", engine: "sqlite", file: "/tmp/local.db" }],
      file,
    );
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(readUserConnections(file)).toHaveLength(1);
  });
});
