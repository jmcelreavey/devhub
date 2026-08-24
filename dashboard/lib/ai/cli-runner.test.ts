import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CURSOR_HEADLESS_FORBIDDEN_FLAGS,
  applyCliTokenBudget,
  cursorAgentPrintArgs,
  describeCliTimeout,
  extractCursorStreamText,
  isPackagedAppResourcePath,
  looksComplete,
  resolveHeadlessCliCwd,
} from "./cli-runner";

/**
 * These cover the parts that only run when something has already gone wrong -
 * a torn transcript, a run killed mid-write, a prompt over budget, a cwd that
 * would put a CLI inside the app bundle. That is exactly the code you cannot
 * exercise by using the app normally, so it is the code most worth pinning.
 */

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cli-runner-test-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function dir(name: string): string {
  const full = path.join(tmp, name);
  fs.mkdirSync(full, { recursive: true });
  return full;
}

describe("cursorAgentPrintArgs", () => {
  it("asks for streaming json, because plain --print looks identical to a hang", () => {
    const args = cursorAgentPrintArgs("write a haiku", "gpt-5");
    expect(args).toContain("--output-format");
    expect(args[args.indexOf("--output-format") + 1]).toBe("stream-json");
    expect(args).toContain("--stream-partial-output");
  });

  it("passes the prompt and model through", () => {
    const args = cursorAgentPrintArgs("write a haiku", "sonnet-4");
    expect(args[args.indexOf("-p") + 1]).toBe("write a haiku");
    expect(args[args.indexOf("--model") + 1]).toBe("sonnet-4");
  });

  it("never smuggles in an auto-approve flag", () => {
    const args = cursorAgentPrintArgs("rm -rf /", "gpt-5");
    for (const flag of CURSOR_HEADLESS_FORBIDDEN_FLAGS) {
      expect(args).not.toContain(flag);
    }
  });
});

describe("extractCursorStreamText", () => {
  const deltas = [
    '{"type":"assistant","message":{"content":[{"type":"text","text":"Hel"}]}}',
    '{"type":"assistant","message":{"content":[{"type":"text","text":"lo"}]}}',
  ].join("\n");

  it("prefers the result event over the deltas that repeat it", () => {
    const raw = `${deltas}\n{"type":"result","result":"Hello"}`;
    expect(extractCursorStreamText(raw)).toBe("Hello");
  });

  it("falls back to the deltas when the run was cut short", () => {
    expect(extractCursorStreamText(deltas)).toBe("Hello");
  });

  it("ignores a torn final line from a killed process", () => {
    const raw = `${deltas}\n{"type":"assis`;
    expect(extractCursorStreamText(raw)).toBe("Hello");
  });

  it("passes plain text straight through for a non-json CLI", () => {
    expect(extractCursorStreamText("  just text  ")).toBe("just text");
  });

  it("returns empty rather than throwing on empty input", () => {
    expect(extractCursorStreamText("")).toBe("");
  });

  it("skips non-text blocks in a message", () => {
    const raw = '{"type":"assistant","message":{"content":[{"type":"tool_use"},{"type":"text","text":"ok"}]}}';
    expect(extractCursorStreamText(raw)).toBe("ok");
  });
});

describe("looksComplete", () => {
  it("accepts a closed document in either tag and any case", () => {
    expect(looksComplete("<html></HTML>")).toBe(true);
    expect(looksComplete("<body></body >")).toBe(true);
  });

  it("rejects a document that stops mid-flight", () => {
    expect(looksComplete("<html><body><h1>Half a th")).toBe(false);
  });
});

describe("describeCliTimeout", () => {
  it("says a ceiling run needs longer, not a simpler prompt", () => {
    const msg = describeCliTimeout("cursor-agent", 180_000, 4_096, "ceiling");
    expect(msg).toMatch(/still working/);
    expect(msg).toMatch(/longer/);
    expect(msg).not.toMatch(/simpler instruction/);
  });

  it("says an idle run with output should try a simpler instruction", () => {
    const msg = describeCliTimeout("cursor-agent", 90_000, 4_096, "idle");
    expect(msg).toMatch(/simpler instruction/);
  });

  it("points at sign-in when nothing was ever written", () => {
    const msg = describeCliTimeout("claude", 90_000, 0, "idle");
    expect(msg).toMatch(/no output/);
    expect(msg).toMatch(/signed in/);
  });

  it("reports seconds, not milliseconds", () => {
    expect(describeCliTimeout("claude", 90_000, 1, "idle")).toMatch(/\b90s\b/);
  });
});

describe("applyCliTokenBudget", () => {
  it("leaves the prompt alone when there is no budget", () => {
    expect(applyCliTokenBudget("hello")).toBe("hello");
    expect(applyCliTokenBudget("hello", 0)).toBe("hello");
  });

  it("appends the budget instruction", () => {
    expect(applyCliTokenBudget("hello", 500)).toMatch(/under ~500 tokens/);
  });

  it("truncates a prompt that would crowd out the reply", () => {
    const huge = "x".repeat(500_000);
    const out = applyCliTokenBudget(huge, 8_000);
    expect(out.length).toBeLessThan(huge.length);
    expect(out).toMatch(/prompt truncated/);
  });

  it("keeps a floor so a large budget cannot truncate to nothing", () => {
    const prompt = "y".repeat(10_000);
    const out = applyCliTokenBudget(prompt, 1_000_000);
    expect(out.length).toBeGreaterThan(4_000);
  });
});

describe("isPackagedAppResourcePath", () => {
  it("recognises a macOS bundle in either slash style", () => {
    expect(isPackagedAppResourcePath("/Applications/DevHub.app/Contents/Resources/server")).toBe(true);
    expect(isPackagedAppResourcePath("C:\\Apps\\DevHub.app\\Contents\\MacOS")).toBe(true);
  });

  it("leaves an ordinary checkout alone", () => {
    expect(isPackagedAppResourcePath("/Users/me/Developer/devhub")).toBe(false);
  });
});

describe("resolveHeadlessCliCwd", () => {
  it("prefers the requested directory when it exists", () => {
    const requested = dir("requested");
    expect(resolveHeadlessCliCwd({ requestedCwd: requested, home: dir("home") })).toBe(requested);
  });

  it("falls back through checkout, then notes, then home", () => {
    const home = dir("home2");
    const notes = dir("notes");
    const checkout = dir("checkout");
    expect(resolveHeadlessCliCwd({ requestedCwd: "/does/not/exist", checkoutRoot: checkout, home })).toBe(checkout);
    expect(resolveHeadlessCliCwd({ notesDir: notes, home })).toBe(notes);
    expect(resolveHeadlessCliCwd({ home })).toBe(home);
  });

  it("never lands a CLI inside the app bundle", () => {
    const home = dir("home3");
    const bundle = dir("DevHub.app/Contents/Resources");
    expect(resolveHeadlessCliCwd({ requestedCwd: bundle, home })).toBe(home);
  });

  it("never lands a CLI inside the resource root, bundle-shaped or not", () => {
    const home = dir("home4");
    const resourceRoot = dir("resources");
    const inside = dir("resources/server");
    expect(resolveHeadlessCliCwd({ requestedCwd: inside, home, resourceRoot })).toBe(home);
    expect(resolveHeadlessCliCwd({ requestedCwd: resourceRoot, home, resourceRoot })).toBe(home);
  });

  it("ignores a file masquerading as a directory", () => {
    const home = dir("home5");
    const file = path.join(tmp, "a-file.txt");
    fs.writeFileSync(file, "not a dir");
    expect(resolveHeadlessCliCwd({ requestedCwd: file, home })).toBe(home);
  });

  it("ignores blank and whitespace-only candidates", () => {
    const home = dir("home6");
    expect(resolveHeadlessCliCwd({ requestedCwd: "   ", checkoutRoot: "", home })).toBe(home);
  });
});
