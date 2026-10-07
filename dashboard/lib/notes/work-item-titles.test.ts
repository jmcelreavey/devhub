import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateAiText } from "@/lib/ai/generate";
import { suggestWorkItemTitles } from "./work-item-titles";
import type { PlanWorkItem } from "./create-tasks-from";

vi.mock("@/lib/ai/generate", () => ({ generateAiText: vi.fn() }));
vi.mock("@/lib/ai/writing-voice", () => ({
  getWritingVoicePrompt: () => "my-voice full-voice guidance",
}));

const source: PlanWorkItem[] = [
  { id: "item-1", title: "icon chopped", summary: "icon chopped", description: "The splash icon is cropped.", repoHint: "android" },
  { id: "item-2", title: "feedback blank", summary: "feedback blank", description: "Open Send feedback." },
];

function respond(workItems: { id: string; summary: string }[]) {
  vi.mocked(generateAiText).mockResolvedValue({
    text: JSON.stringify({ workItems }),
    provider: "api",
  });
}

beforeEach(() => vi.clearAllMocks());

describe("suggestWorkItemTitles", () => {
  it("uses voice guidance and preserves source details and order when the model reorders items", async () => {
    respond([
      { id: "item-2", summary: "Send feedback opens a blank screen" },
      { id: "item-1", summary: "Android splash icon is cropped" },
    ]);

    const result = await suggestWorkItemTitles("Android testing", source);
    expect(result).toEqual([
      { ...source[0], summary: "Android splash icon is cropped" },
      { ...source[1], summary: "Send feedback opens a blank screen" },
    ]);
    expect(source[0].summary).toBe("icon chopped");
    expect(generateAiText).toHaveBeenCalledWith(expect.objectContaining({
      system: expect.stringContaining("my-voice full-voice guidance"),
      prompt: expect.stringContaining("Android testing"),
      timeoutMs: 180_000,
      idleTimeoutMs: 90_000,
    }));
  });

  it.each([
    [{ id: "item-1", summary: "Only one" }],
    [{ id: "item-1", summary: "One" }, { id: "item-1", summary: "Duplicate" }],
    [{ id: "item-1", summary: "One" }, { id: "invented", summary: "Extra" }],
    [{ id: "item-1", summary: " " }, { id: "item-2", summary: "Two" }],
    [{ id: "item-1", summary: "x".repeat(256) }, { id: "item-2", summary: "Two" }],
  ])("rejects invalid or mismatched suggestions", async (...items) => {
    respond(items);
    await expect(suggestWorkItemTitles("Android testing", source)).rejects.toThrow();
  });

  it("rejects malformed output instead of dropping source items", async () => {
    vi.mocked(generateAiText).mockResolvedValue({ text: "Not JSON", provider: "api" });
    await expect(suggestWorkItemTitles("Android testing", source)).rejects.toThrow();
  });

  it("does not call a model for an empty list", async () => {
    expect(await suggestWorkItemTitles("Empty", [])).toEqual([]);
    expect(generateAiText).not.toHaveBeenCalled();
  });
});
