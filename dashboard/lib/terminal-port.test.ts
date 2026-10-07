import { describe, expect, it } from "vitest";
import { terminalPort } from "./terminal-port";

describe("terminalPort", () => {
  it("defaults to the usual peer port when no port is configured", () => {
    expect(terminalPort({})).toBe(1339);
    expect(terminalPort({ TERMINAL_PORT: " " })).toBe(1339);
  });

  it("uses a separately configured peer port", () => {
    expect(terminalPort({ TERMINAL_PORT: " 1402 " })).toBe(1402);
  });

  it.each(["0", "-1", "65536", "1339extra", "1.5", "1e3"])("rejects an invalid listener port: %s", (value) => {
    expect(() => terminalPort({ TERMINAL_PORT: value })).toThrow("TERMINAL_PORT");
  });
});
