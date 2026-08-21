import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/agent/cli-env", () => ({
  isCursorAgentInstalled: vi.fn(() => false),
  resolveCursorAgentBin: vi.fn(() => null),
  readAgentCliSettings: vi.fn(() => ({
    cli: "opencode",
    opencodeModel: "",
    cursorModel: "cursor-grok-4.5-high",
  })),
}));

vi.mock("@/lib/dashboard-env-local", () => ({
  readDashboardEnvLocalFile: vi.fn(() => ({ overrides: new Map(), passthrough: [] })),
  resolveEnvValue: vi.fn((key: string, overrides: Map<string, string>) => {
    return overrides.get(key) ?? process.env[key];
  }),
}));

vi.mock("@/lib/notes-ai/config", () => ({
  isNotesAiConfigured: vi.fn(() => false),
}));

vi.mock("@/lib/opencode/command", () => ({
  resolveOpenCodeBinary: vi.fn(() => "opencode"),
}));

vi.mock("@/lib/peer-service-availability", () => ({
  isChatGPTConfigured: vi.fn(() => false),
  isOpenCodeConfigured: vi.fn(() => false),
}));

import { isCursorAgentInstalled } from "@/lib/agent/cli-env";
import { readDashboardEnvLocalFile } from "@/lib/dashboard-env-local";
import { isNotesAiConfigured } from "@/lib/notes-ai/config";
import { isChatGPTConfigured, isOpenCodeConfigured } from "@/lib/peer-service-availability";
import {
  fromAgentLaunchCli,
  normalizeAiProvider,
  readConfiguredAiProvider,
  resolveAgentLaunchCli,
  resolveAiProvider,
  toAgentLaunchCli,
} from "@/lib/ai/preference";

describe("normalizeAiProvider", () => {
  it("accepts canonical and legacy aliases", () => {
    expect(normalizeAiProvider("cursor-cli")).toBe("cursor-cli");
    expect(normalizeAiProvider("cursor")).toBe("cursor-cli");
    expect(normalizeAiProvider("chatgpt-cli")).toBe("chatgpt-cli");
    expect(normalizeAiProvider("codex")).toBe("chatgpt-cli");
    expect(normalizeAiProvider("opencode")).toBe("opencode");
    expect(normalizeAiProvider("api")).toBe("api");
    expect(normalizeAiProvider("notes-ai")).toBe("api");
    expect(normalizeAiProvider("nope")).toBeNull();
  });
});

describe("toAgentLaunchCli / fromAgentLaunchCli", () => {
  it("round-trips launch ids", () => {
    expect(toAgentLaunchCli("cursor-cli")).toBe("cursor");
    expect(toAgentLaunchCli("chatgpt-cli")).toBe("chatgpt");
    expect(toAgentLaunchCli("opencode")).toBe("opencode");
    expect(toAgentLaunchCli("api")).toBe("opencode");
    expect(fromAgentLaunchCli("cursor")).toBe("cursor-cli");
    expect(fromAgentLaunchCli("chatgpt")).toBe("chatgpt-cli");
  });
});

describe("resolveAiProvider", () => {
  const ENV_KEYS = ["DEVHUB_AI_PROVIDER", "DEVHUB_AGENT_CLI", "AI_API_KEY"] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    vi.mocked(readDashboardEnvLocalFile).mockReturnValue({
      overrides: new Map(),
      passthrough: [],
    } as never);
    vi.mocked(isCursorAgentInstalled).mockReturnValue(false);
    vi.mocked(isChatGPTConfigured).mockReturnValue(false);
    vi.mocked(isOpenCodeConfigured).mockReturnValue(false);
    vi.mocked(isNotesAiConfigured).mockReturnValue(false);
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("returns null when nothing is available", () => {
    const r = resolveAiProvider();
    expect(r.provider).toBeNull();
    expect(r.setupHint).toBeTruthy();
  });

  it("auto-prefers cursor-cli when installed", () => {
    vi.mocked(isCursorAgentInstalled).mockReturnValue(true);
    vi.mocked(isNotesAiConfigured).mockReturnValue(true);
    const r = resolveAiProvider();
    expect(r.provider).toBe("cursor-cli");
    expect(r.configured).toBeNull();
    expect(r.fallback).toBe(false);
  });

  it("honours DEVHUB_AI_PROVIDER=api when key is set", () => {
    process.env.DEVHUB_AI_PROVIDER = "api";
    vi.mocked(isNotesAiConfigured).mockReturnValue(true);
    vi.mocked(isCursorAgentInstalled).mockReturnValue(true);
    const r = resolveAiProvider();
    expect(r.provider).toBe("api");
  });

  it("falls back when preferred CLI is missing", () => {
    process.env.DEVHUB_AI_PROVIDER = "cursor-cli";
    vi.mocked(isCursorAgentInstalled).mockReturnValue(false);
    vi.mocked(isOpenCodeConfigured).mockReturnValue(true);
    const r = resolveAiProvider();
    expect(r.provider).toBe("opencode");
    expect(r.configured).toBe("cursor-cli");
    expect(r.fallback).toBe(true);
    expect(r.setupHint).toMatch(/cursor-agent/i);
  });

  it("maps legacy DEVHUB_AGENT_CLI=cursor", () => {
    process.env.DEVHUB_AGENT_CLI = "cursor";
    vi.mocked(isCursorAgentInstalled).mockReturnValue(true);
    expect(readConfiguredAiProvider()).toBe("cursor-cli");
    expect(resolveAiProvider().provider).toBe("cursor-cli");
  });

  it("resolveAgentLaunchCli maps api to an available CLI", () => {
    vi.mocked(isNotesAiConfigured).mockReturnValue(true);
    vi.mocked(isCursorAgentInstalled).mockReturnValue(true);
    const r = resolveAiProvider({ prefer: "api" });
    expect(r.provider).toBe("api");
    expect(resolveAgentLaunchCli(r)).toBe("cursor");
  });
});
