import { describe, expect, it } from "vitest";
import { launchCliFromProvider, setAgentCliConfigCache, getAgentCliConfig } from "./cli-config";

describe("launchCliFromProvider", () => {
  it("maps provider ids to launch CLIs", () => {
    expect(launchCliFromProvider("cursor-cli", "opencode")).toBe("cursor");
    expect(launchCliFromProvider("chatgpt-cli", "opencode")).toBe("chatgpt");
    expect(launchCliFromProvider("opencode", "cursor")).toBe("opencode");
    expect(launchCliFromProvider("api", "cursor")).toBe("cursor");
    expect(launchCliFromProvider(null, "chatgpt")).toBe("chatgpt");
  });

  it("sanitize prefers provider over stale cli via cache", async () => {
    setAgentCliConfigCache({
      cli: "opencode",
      provider: "cursor-cli",
      opencodeModel: "",
      cursorModel: "cursor-grok-4.5-high",
      cursorAgentInstalled: true,
      chatgptCliInstalled: false,
      apiConfigured: false,
      opencodeInstalled: true,
    });
    const cfg = await getAgentCliConfig();
    expect(cfg.cli).toBe("cursor");
    expect(cfg.provider).toBe("cursor-cli");
    setAgentCliConfigCache(null);
  });
});
