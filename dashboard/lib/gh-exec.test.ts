import { describe, it, expect } from "vitest";
import {
  GH_AUTH_REQUIRED_MESSAGE,
  GH_NOT_FOUND_MESSAGE,
  githubCliErrorInfo,
  mapGithubCliError,
} from "./gh-exec";

describe("githubCliErrorInfo", () => {
  it("classifies missing gh binary", () => {
    const info = githubCliErrorInfo(new Error("spawn gh ENOENT"));
    expect(info.kind).toBe("missing");
    expect(info.message).toBe(GH_NOT_FOUND_MESSAGE);
    expect(info.httpStatus).toBe(500);
  });

  it("classifies auth failures", () => {
    const info = githubCliErrorInfo(new Error("HTTP 401: Requires authentication"));
    expect(info.kind).toBe("auth");
    expect(info.message).toBe(GH_AUTH_REQUIRED_MESSAGE);
    expect(info.httpStatus).toBe(401);
  });

  it("passes through other errors", () => {
    const info = githubCliErrorInfo(new Error("merge conflict"));
    expect(info.kind).toBe("other");
    expect(info.message).toBe("merge conflict");
    expect(info.httpStatus).toBe(500);
  });

  it("classifies gateway timeouts as 504", () => {
    const info = githubCliErrorInfo(new Error("HTTP 504: Gateway Timeout"));
    expect(info.httpStatus).toBe(504);
    expect(info.message).toContain("timed out");
  });

  /**
   * The real-world failure: a degraded GitHub makes `gh` hang, so `execGh`
   * kills it. That error carries no "timeout" text — only `killed`/`signal` —
   * so message sniffing alone would misfile it as a generic 500 and the stale
   * PR cache would never be served.
   */
  it("classifies a timeout-killed process as 504, not 500", () => {
    const killed = Object.assign(new Error("Command failed: gh search prs"), {
      killed: true,
      signal: "SIGKILL",
    });
    const info = githubCliErrorInfo(killed);
    expect(info.httpStatus).toBe(504);
    expect(info.message).toContain("timed out");
  });

  it("does not treat a non-killed failure as a timeout", () => {
    const failed = Object.assign(new Error("Command failed: gh search prs"), {
      killed: false,
      signal: null,
    });
    expect(githubCliErrorInfo(failed).httpStatus).toBe(500);
  });

  it("mapGithubCliError mirrors githubCliErrorInfo", () => {
    expect(mapGithubCliError(new Error("not logged in"))).toEqual({
      status: 401,
      error: GH_AUTH_REQUIRED_MESSAGE,
    });
  });
});
