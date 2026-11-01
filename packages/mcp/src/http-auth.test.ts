import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  bearerMatches,
  isAllowedHost,
  isAllowedOrigin,
  parseAllowedHosts,
  resolveMcpHttpToken,
} from "./http-auth.ts";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-http-auth-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("bearerMatches", () => {
  const token = "a".repeat(43);

  it("accepts only the exact bearer token", () => {
    expect(bearerMatches(`Bearer ${token}`, token)).toBe(true);
    expect(bearerMatches(`bearer ${token}`, token)).toBe(true);
    expect(bearerMatches(`Bearer ${token}x`, token)).toBe(false);
    expect(bearerMatches(token, token)).toBe(false);
    expect(bearerMatches(undefined, token)).toBe(false);
  });
});

describe("host and origin checks", () => {
  it("allows loopback hosts with or without a port and rejects rebinding names", () => {
    expect(isAllowedHost("127.0.0.1:1340")).toBe(true);
    expect(isAllowedHost("localhost")).toBe(true);
    expect(isAllowedHost("[::1]:1340")).toBe(true);
    expect(isAllowedHost("evil.example:1340")).toBe(false);
    expect(isAllowedHost(undefined)).toBe(false);
    expect(isAllowedHost("devbox.tailnet.ts.net:1340", parseAllowedHosts(" DevBox.tailnet.ts.net "))).toBe(true);
  });

  it("allows a missing Origin (native clients) but not a foreign one", () => {
    expect(isAllowedOrigin(undefined)).toBe(true);
    expect(isAllowedOrigin("http://localhost:1337")).toBe(true);
    expect(isAllowedOrigin("https://evil.example")).toBe(false);
    expect(isAllowedOrigin("not a url")).toBe(false);
  });
});

describe("resolveMcpHttpToken", () => {
  it("generates a 0600 token file once and reuses it", () => {
    const env = { DEVHUB_MCP_HTTP_TOKEN_FILE: path.join(dir, "nested", "token") };
    const first = resolveMcpHttpToken(env);
    expect(first.source).toBe("generated");
    expect(first.token.length).toBeGreaterThanOrEqual(32);
    expect(fs.statSync(first.file).mode & 0o777).toBe(0o600);

    const second = resolveMcpHttpToken(env);
    expect(second).toMatchObject({ source: "file", token: first.token });
  });

  it("prefers the env token and rejects a short one", () => {
    const file = path.join(dir, "token");
    expect(resolveMcpHttpToken({ DEVHUB_MCP_HTTP_TOKEN: "t".repeat(40), DEVHUB_MCP_HTTP_TOKEN_FILE: file })).toMatchObject({
      source: "env",
    });
    expect(fs.existsSync(file)).toBe(false);
    expect(() => resolveMcpHttpToken({ DEVHUB_MCP_HTTP_TOKEN: "short", DEVHUB_MCP_HTTP_TOKEN_FILE: file })).toThrow(
      "at least 32",
    );
  });
});
