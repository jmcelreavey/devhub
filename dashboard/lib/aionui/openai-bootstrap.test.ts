import { beforeEach, describe, expect, it, vi } from "vitest";

const listProviders = vi.fn(async () => [] as Array<{ id: string; platform: string; name: string }>);
const createProvider = vi.fn(async (body: { id: string }) => ({ id: body.id }));
const updateProvider = vi.fn(async () => undefined);

vi.mock("./client", () => ({
  AionClient: class {
    listProviders = listProviders;
    createProvider = createProvider;
    updateProvider = updateProvider;
  },
}));

vi.mock("@/lib/atomic-write", () => ({
  withMutex: async (_key: string, work: () => Promise<unknown>) => work(),
}));

const session = {
  origin: "http://127.0.0.1:25818", userId: "u", username: "admin",
  anchorConversationId: "a", accessToken: "t", csrfToken: "a".repeat(64),
  refreshToken: "r", authenticatedAt: Date.now(), defaultAssistantId: "x",
};

describe("ensureAionOpenAiBootstrap", () => {
  beforeEach(() => {
    vi.resetModules();
    listProviders.mockReset().mockResolvedValue([]);
    createProvider.mockReset().mockImplementation(async (body: { id: string }) => ({ id: body.id }));
    updateProvider.mockReset().mockResolvedValue(undefined);
    delete process.env.AI_API_KEY;
    delete process.env.AI_BASE_URL;
  });

  it("no-ops without AI_API_KEY", async () => {
    const { ensureAionOpenAiBootstrap } = await import("./openai-bootstrap");
    await expect(ensureAionOpenAiBootstrap(session)).resolves.toBeNull();
    expect(createProvider).not.toHaveBeenCalled();
  });

  it("creates the DevHub OpenAI provider with gpt-5.6-luna", async () => {
    process.env.AI_API_KEY = "sk-test";
    process.env.AI_BASE_URL = "https://api.openai.com/v1/";
    const { ensureAionOpenAiBootstrap, DEVHUB_AION_CLI_MODEL, DEVHUB_OPENAI_PROVIDER_ID } = await import("./openai-bootstrap");
    await expect(ensureAionOpenAiBootstrap(session)).resolves.toEqual({
      providerId: DEVHUB_OPENAI_PROVIDER_ID,
      model: DEVHUB_AION_CLI_MODEL,
    });
    expect(createProvider).toHaveBeenCalledWith(expect.objectContaining({
      id: DEVHUB_OPENAI_PROVIDER_ID,
      platform: "openai",
      base_url: "https://api.openai.com/v1",
      models: [DEVHUB_AION_CLI_MODEL],
    }));
  });
});
