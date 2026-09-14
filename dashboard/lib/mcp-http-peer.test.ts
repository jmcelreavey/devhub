import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mcpHttpAutostartEnabled, mcpHttpEntry, mcpHttpPort } from "@/lib/mcp-http-peer";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-http-peer-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("mcpHttpPort", () => {
  it("uses DEVHUB_MCP_HTTP_PORT when valid, else 1340", () => {
    expect(mcpHttpPort({ DEVHUB_MCP_HTTP_PORT: "1441" })).toBe(1441);
    expect(mcpHttpPort({ DEVHUB_MCP_HTTP_PORT: "nope" })).toBe(1340);
    expect(mcpHttpPort({ DEVHUB_MCP_HTTP_PORT: "70000" })).toBe(1340);
    expect(mcpHttpPort({})).toBe(1340);
  });
});

describe("mcpHttpAutostartEnabled", () => {
  it("is on by default and off for DEVHUB_MCP_HTTP=0 or tests", () => {
    expect(mcpHttpAutostartEnabled({})).toBe(true);
    expect(mcpHttpAutostartEnabled({ DEVHUB_MCP_HTTP: "0" })).toBe(false);
    expect(mcpHttpAutostartEnabled({ NODE_ENV: "test" })).toBe(false);
  });
});

describe("mcpHttpEntry", () => {
  it("needs both the installed tsx and the HTTP entry", () => {
    const pkg = path.join(dir, "mcp-servers", "devhub-server");
    fs.mkdirSync(path.join(pkg, "src"), { recursive: true });
    fs.writeFileSync(path.join(pkg, "src", "http.ts"), "");
    expect(mcpHttpEntry(dir)).toBeNull();

    fs.mkdirSync(path.join(pkg, "node_modules", ".bin"), { recursive: true });
    fs.writeFileSync(path.join(pkg, "node_modules", ".bin", "tsx"), "");
    expect(mcpHttpEntry(dir)).toEqual({
      tsx: path.join(pkg, "node_modules", ".bin", "tsx"),
      entry: path.join(pkg, "src", "http.ts"),
      cwd: pkg,
    });
  });
});
