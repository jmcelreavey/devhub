import { expect, it, vi } from "vitest";
import { isNotesAiConfigured } from "../../../../../lib/notes-ai/config";
import { POST } from "./tutor/route";

vi.mock("ai", () => ({
  convertToModelMessages: vi.fn().mockResolvedValue([]),
  streamText: vi.fn().mockReturnValue({ toUIMessageStreamResponse: () => new Response("fixture stream", { headers: { "content-type": "text/event-stream" } }) }),
}));
vi.mock("../../../../../lib/notes-ai/config", () => ({ isNotesAiConfigured: vi.fn().mockReturnValue(true) }));
vi.mock("../../../../../lib/repos/learn-resolve", () => ({ resolveRepoPath: (name: string) => name === "demo" ? "/fixture/demo" : null }));
vi.mock("../../../../../lib/repos/learn-ai", () => ({ buildTutorSystemPrompt: () => "fixture" }));
vi.mock("../../../../../lib/repos/learn-tutor-context", () => ({ getRepoContextForTutor: vi.fn().mockResolvedValue({}) }));
vi.mock("../../../../../lib/ai/provider", () => ({ getNotesAiModel: () => ({}), getNotesAiCallOptions: () => ({}) }));

it("preserves tutor stream headers, body and configuration guards", async () => {
  const request = () => new Request("http://localhost:1447/api/repos/demo/learn/tutor", { method: "POST", body: JSON.stringify({ messages: [] }) });
  const params = { params: Promise.resolve({ name: "demo" }) };
  const result = await POST(request(), params);
  expect(result.headers.get("content-type")).toBe("text/event-stream");
  expect(await result.text()).toBe("fixture stream");
  vi.mocked(isNotesAiConfigured).mockReturnValueOnce(false);
  expect((await POST(request(), params)).status).toBe(503);
  expect((await POST(request(), { params: Promise.resolve({ name: "missing" }) })).status).toBe(404);
});
