import { setImmediate } from "node:timers/promises";
import { expect, it, vi } from "vitest";
import { generateRepoLearnArtifacts } from "./learn-ai";
import { loadRepoLearn } from "./learn-service";

vi.mock("../ai/preference", () => ({ resolveAiProvider: async () => ({ provider: "chatgpt" }) }));
vi.mock("./context", () => ({
  scanRepoContext: async () => ({ repoName: "fixture" }),
  getGitHead: async () => "fixture-head",
}));
vi.mock("./learn-ai", () => ({ generateRepoLearnArtifacts: vi.fn() }));
vi.mock("./learn-cache", () => ({
  readRepoLearnCache: () => null,
  writeRepoLearnCache: async () => {},
}));

it("reports a generation failure without an unhandled rejection and permits retry", async () => {
  vi.mocked(generateRepoLearnArtifacts)
    .mockRejectedValueOnce(new Error("CLI unavailable"))
    .mockResolvedValueOnce({ briefMarkdown: "Fixture brief", packFiles: [] });

  await expect(loadRepoLearn("/fixture", false)).resolves.toMatchObject({
    code: "error", message: "CLI unavailable", artifacts: null,
  });
  // Let an orphaned cleanup rejection surface before exercising the retry.
  await setImmediate();
  await expect(loadRepoLearn("/fixture", false)).resolves.toMatchObject({
    artifacts: { briefMarkdown: "Fixture brief", cached: false },
  });
  expect(generateRepoLearnArtifacts).toHaveBeenCalledTimes(2);
});
