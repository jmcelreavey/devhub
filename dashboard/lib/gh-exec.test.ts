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

  it("mapGithubCliError mirrors githubCliErrorInfo", () => {
    expect(mapGithubCliError(new Error("not logged in"))).toEqual({
      status: 401,
      error: GH_AUTH_REQUIRED_MESSAGE,
    });
  });
});
