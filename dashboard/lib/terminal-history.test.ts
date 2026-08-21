import { describe, expect, it } from "vitest";
import { fuzzyFilterHistory } from "./terminal-history";

describe("fuzzyFilterHistory", () => {
  const history = [
    "git push origin main",
    "npm run test",
    "kubectl get pods -n dad",
    "docker compose up -d",
    "git status",
  ];

  it("returns the newest items unfiltered for an empty query", () => {
    expect(fuzzyFilterHistory(history, "")).toEqual(history);
    expect(fuzzyFilterHistory(history, "   ")).toEqual(history);
  });

  it("matches subsequence characters in order", () => {
    expect(fuzzyFilterHistory(history, "gpush")).toEqual(["git push origin main"]);
  });

  it("is case-insensitive", () => {
    expect(fuzzyFilterHistory(history, "KUBECTL")).toContain("kubectl get pods -n dad");
  });

  it("ranks word-start hits above mid-word hits", () => {
    // "d" starts both "docker" and appears mid-word in "pods" — word start wins.
    const [top] = fuzzyFilterHistory(["kubectl get pods", "docker compose up"], "d");
    expect(top).toBe("docker compose up");
  });

  it("ranks consecutive runs above scattered matches", () => {
    const [top] = fuzzyFilterHistory(["npm run test", "npx pm2 list"], "npm");
    expect(top).toBe("npm run test");
  });

  it("drops non-matches and respects the limit", () => {
    expect(fuzzyFilterHistory(history, "zzz")).toEqual([]);
    expect(fuzzyFilterHistory(history, "e", 2)).toHaveLength(2);
  });
});
