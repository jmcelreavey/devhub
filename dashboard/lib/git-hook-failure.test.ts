import { describe, expect, it } from "vitest";
import {
  combineGitStreams,
  detectGitHookFailure,
  detectGitHookFailureFromLog,
  detectHookName,
  formatHookOutput,
  hookFailureTitle,
  parseHookFailurePayload,
  stripAnsi,
  summarizeHookFailure,
} from "./git-hook-failure";

const PRE_PUSH_VERIFY = `
[pre-push] Scanning for internal-name / secret leaks…
[pre-push] Running dashboard verify…
npm error Lifecycle script \`lint\` failed
ESLint found 3 errors

[pre-push] Verify failed. Fix the errors above or set DEVHUB_SKIP_VERIFY=1 to override.
error: failed to push some refs to 'github.com:example/devhub.git'
`;

describe("detectGitHookFailure", () => {
  it("detects pre-push verify failures with stdout+stderr split", () => {
    const failure = detectGitHookFailure(
      PRE_PUSH_VERIFY,
      "error: failed to push some refs to 'origin'",
      "push",
    );
    expect(failure).not.toBeNull();
    expect(failure!.code).toBe("hook_failed");
    expect(failure!.hook).toBe("pre-push");
    expect(failure!.phase).toBe("push");
    expect(failure!.output).toContain("[pre-push] Verify failed");
    expect(failure!.summary?.toLowerCase()).toMatch(/verify failed|pre-push/);
  });

  it("detects husky pre-commit", () => {
    const failure = detectGitHookFailure(
      "",
      "husky - pre-commit script failed (code 1)\nlint-staged failed",
      "commit",
    );
    expect(failure?.hook).toBe("pre-commit");
    expect(failure?.phase).toBe("commit");
  });

  it("detects commit-msg / commitlint", () => {
    const failure = detectGitHookFailure(
      "⧗   input: bad message\n✖   subject may not be empty [subject-empty]",
      "husky - commit-msg hook exited with code 1",
      "commit",
    );
    expect(failure?.hook).toBe("commit-msg");
  });

  it("returns null for plain network push failures", () => {
    expect(
      detectGitHookFailure(
        "",
        "fatal: could not read Username for 'https://github.com'",
        "push",
      ),
    ).toBeNull();
  });

  it("infers pre-push when verify dump accompanies failed-to-push", () => {
    const failure = detectGitHookFailure(
      "npm run verify\nTypecheck failed\nerror TS2322",
      "error: failed to push some refs to 'origin'",
      "push",
    );
    expect(failure?.hook).toBe("pre-push");
  });
});

describe("formatHookOutput / helpers", () => {
  it("strips ansi and caps long logs", () => {
    expect(stripAnsi("\u001b[31mred\u001b[0m")).toBe("red");
    const many = Array.from({ length: 150 }, (_, i) => `line ${i}`).join("\n");
    const formatted = formatHookOutput(many, 40);
    expect(formatted).toContain("earlier line(s) omitted");
    expect(formatted.split("\n").length).toBeLessThanOrEqual(41);
  });

  it("combineGitStreams prefers both streams", () => {
    expect(combineGitStreams("out", "err")).toBe("out\nerr");
    expect(combineGitStreams("same", "same")).toBe("same");
  });

  it("detectHookName finds bracket tags", () => {
    expect(detectHookName("[pre-push] Running")).toBe("pre-push");
  });

  it("summarizeHookFailure picks banner lines", () => {
    expect(summarizeHookFailure(PRE_PUSH_VERIFY, "pre-push")).toMatch(/Verify failed/i);
  });

  it("hookFailureTitle names the hook and phase", () => {
    expect(
      hookFailureTitle({
        code: "hook_failed",
        hook: "pre-push",
        phase: "push",
        output: "x",
      }),
    ).toBe("pre-push failed during push");
  });

  it("parseHookFailurePayload validates shape", () => {
    expect(parseHookFailurePayload(`{"code":"hook_failed","phase":"push","output":"boom"}`)).toEqual(
      {
        code: "hook_failed",
        hook: undefined,
        phase: "push",
        output: "boom",
        summary: undefined,
        logPath: undefined,
      },
    );
    expect(parseHookFailurePayload(`{"error":"nope"}`)).toBeNull();
  });

  it("detectGitHookFailureFromLog works on orchestrator dumps", () => {
    const failure = detectGitHookFailureFromLog(PRE_PUSH_VERIFY, "push");
    expect(failure?.hook).toBe("pre-push");
  });
});
