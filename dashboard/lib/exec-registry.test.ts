import { afterEach, describe, expect, it } from "vitest";
import {
  beginExternalCall,
  endExternalCall,
  listInFlightCalls,
  listSlowCalls,
  redactArgs,
  resetExecRegistry,
} from "./exec-registry";

afterEach(() => resetExecRegistry());

describe("redactArgs", () => {
  /**
   * This output is rendered in a page and returned by an MCP tool, so a token
   * reaching it would be a real leak rather than cosmetic noise.
   */
  it("redacts token-shaped arguments", () => {
    expect(redactArgs(["api", "ghp_abcdefghijklmnop"])).toEqual(["api", "‹redacted›"]);
    expect(redactArgs(["--token=supersecret"])).toEqual(["--token=‹redacted›"]);
    expect(redactArgs(["--password=hunter2"])).toEqual(["--password=‹redacted›"]);
  });

  it("leaves ordinary arguments intact", () => {
    expect(redactArgs(["status", "--porcelain", "-C", "/repos/atlas"])).toEqual([
      "status",
      "--porcelain",
      "-C",
      "/repos/atlas",
    ]);
  });
});

describe("exec registry", () => {
  it("reports a call as in flight until it ends", () => {
    const id = beginExternalCall({ file: "git", args: ["status"], timeoutMs: 1000 });
    expect(listInFlightCalls().map((c) => c.command)).toEqual(["git status"]);
    endExternalCall(id, { ok: true, timedOut: false });
    expect(listInFlightCalls()).toEqual([]);
  });

  /** A fast, successful call is noise; recording every one would bury the offenders. */
  it("does not record a fast successful call as slow", () => {
    const id = beginExternalCall({ file: "git", args: ["status"], timeoutMs: 1000 });
    endExternalCall(id, { ok: true, timedOut: false });
    expect(listSlowCalls()).toEqual([]);
  });

  it("always records a timeout, however short", () => {
    const id = beginExternalCall({ file: "gh", args: ["search"], timeoutMs: 1000 });
    endExternalCall(id, { ok: false, timedOut: true });
    expect(listSlowCalls().map((c) => [c.command, c.timedOut])).toEqual([["gh search", true]]);
  });
});
