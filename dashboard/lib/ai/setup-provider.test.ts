import { describe, expect, it } from "vitest";
import { pickInstalledAiProvider } from "./setup-provider";

describe("pickInstalledAiProvider", () => {
  it("does not preselect a provider that is not installed", () => {
    expect(pickInstalledAiProvider({
      saved: "cursor-cli",
      installed: { "cursor-cli": false, opencode: false, api: false },
    })).toBeNull();
    expect(pickInstalledAiProvider({
      saved: null,
      installed: {},
    })).toBeNull();
  });

  it("keeps a saved provider only when it is installed, otherwise the first installed one", () => {
    expect(pickInstalledAiProvider({
      saved: "opencode",
      installed: { opencode: true, "cursor-cli": true },
    })).toBe("opencode");
    expect(pickInstalledAiProvider({
      saved: null,
      installed: { "chatgpt-cli": true },
    })).toBe("chatgpt-cli");
  });
});
