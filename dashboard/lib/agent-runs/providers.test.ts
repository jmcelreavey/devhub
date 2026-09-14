import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BUILT_IN_AGENT_PROVIDERS, loadCustomProviders, resolveBinary } from "@/lib/agent-runs/providers";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-providers-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function writeProvidersFile(value: unknown): string {
  const file = path.join(dir, "agent-providers.json");
  fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
  return file;
}

describe("built-in providers", () => {
  it("passes claude's model, max turns and resume session as argv", () => {
    const claude = BUILT_IN_AGENT_PROVIDERS.find((p) => p.id === "claude");
    expect(claude?.buildArgs({ prompt: "do it", model: "opus", maxTurns: 5, resumeSessionId: "s1" })).toEqual([
      "-p",
      "do it",
      "--output-format",
      "stream-json",
      "--verbose",
      "--dangerously-skip-permissions",
      "--model",
      "opus",
      "--max-turns",
      "5",
      "--resume",
      "s1",
    ]);
  });

  it("omits optional flags that were not requested", () => {
    const cursor = BUILT_IN_AGENT_PROVIDERS.find((p) => p.id === "cursor");
    expect(cursor?.buildArgs({ prompt: "go" })).toEqual([
      "-p",
      "go",
      "--output-format",
      "stream-json",
      "--force",
      "--approve-mcps",
      "--trust",
    ]);
  });
});

describe("loadCustomProviders", () => {
  it("fills placeholders without re-expanding the prompt", () => {
    const file = writeProvidersFile({
      providers: [
        {
          id: "grok",
          label: "Grok",
          command: "grok",
          args: ["-p", "{prompt}"],
          modelArgs: ["--model", "{model}"],
          resumeArgs: ["--resume", "{sessionId}"],
        },
      ],
    });
    const { providers, error } = loadCustomProviders(file);
    expect(error).toBeUndefined();
    const [grok] = providers;
    expect(grok).toMatchObject({ id: "grok", format: "text", supportsResume: true, custom: true });
    expect(grok?.buildArgs({ prompt: "say {model}", model: "grok-4", resumeSessionId: "abc" })).toEqual([
      "-p",
      "say {model}",
      "--model",
      "grok-4",
      "--resume",
      "abc",
    ]);
  });

  it("reports an invalid definition instead of throwing", () => {
    const file = writeProvidersFile({ providers: [{ id: "bad", label: "Bad", command: "bad", args: ["-p"] }] });
    const result = loadCustomProviders(file);
    expect(result.providers).toEqual([]);
    expect(result.error).toContain("{prompt}");
  });

  it("reports malformed JSON", () => {
    expect(loadCustomProviders(writeProvidersFile("{nope")).error).toContain("not valid JSON");
  });

  it("treats a missing file as no custom providers", () => {
    expect(loadCustomProviders(path.join(dir, "missing.json"))).toEqual({ providers: [] });
  });
});

describe("resolveBinary", () => {
  it("finds the first executable candidate on PATH", () => {
    const bin = path.join(dir, "fake-agent");
    fs.writeFileSync(bin, "#!/bin/sh\n", { mode: 0o755 });
    fs.writeFileSync(path.join(dir, "not-executable"), "", { mode: 0o644 });
    expect(resolveBinary(["missing", "not-executable", "fake-agent"], dir)).toBe(bin);
    expect(resolveBinary(["missing"], dir)).toBeNull();
    expect(resolveBinary([bin], "")).toBe(bin);
  });
});
