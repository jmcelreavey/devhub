import { describe, expect, it, vi } from "vitest";
import { createJevChooser } from "./jev-choice";

const options = [{ id: "tool:a", description: "A" }, { id: "tool:b", description: "B" }];
const question = { goal: "do a", context: "ctx", instructions: "pick", options };
const reply = (answer: unknown, usage: unknown = { input_tokens: 1000 }) => vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ answers: { pick: answer }, usage }) }) as unknown as Response);

describe("createJevChooser", () => {
  it("sends the TypeSafe wire contract and returns the choice, probabilities and cost", async () => {
    const fetch = reply({ type: "choice", choice: "tool:a", confidence: 0.8, probabilities: { "tool:a": 0.8, "tool:b": 0.2 } }, { input_tokens: 1_000_000 });
    const choice = await createJevChooser({ apiKey: () => "key-fake", fetch })(question);
    expect(choice).toEqual({ id: "tool:a", confidence: 0.8, probabilities: { "tool:a": 0.8, "tool:b": 0.2 }, costUsd: 0.042 });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer key-fake");
    const body = JSON.parse(init.body as string);
    expect(body.state.goal).toBe("do a");
    expect(body.questions.pick.criteria).toEqual({ "tool:a": "A", "tool:b": "B" });
  });
  it("does not silently drop later tool families from category descriptions", async () => {
    const description = "early_family ".repeat(40) + "late_nested_family";
    const fetch = reply({ type: "choice", choice: "tool:a", confidence: 0.8, probabilities: { "tool:a": 0.8, "tool:b": 0.2 } });
    await createJevChooser({ apiKey: () => "test", fetch })({ ...question, options: [{ id: "tool:a", description }, options[1]] });
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string).questions.pick.criteria["tool:a"]).toBe(description);
  });
  it("needs a key and 1–255 options", async () => {
    await expect(createJevChooser({ apiKey: () => undefined, fetch: reply({}) })(question)).rejects.toThrow("TYPESAFE_API_KEY");
    await expect(createJevChooser({ apiKey: () => "k", fetch: reply({}) })({ ...question, options: [] })).rejects.toThrow("1–255");
    const many = Array.from({ length: 256 }, (_, i) => ({ id: `o${i}`, description: "" }));
    await expect(createJevChooser({ apiKey: () => "k", fetch: reply({}) })({ ...question, options: many })).rejects.toThrow("1–255");
  });
  it("rejects an unoffered choice or incomplete probabilities", async () => {
    await expect(createJevChooser({ apiKey: () => "k", fetch: reply({ type: "choice", choice: "tool:zzz", confidence: 0.9, probabilities: { "tool:a": 0.5, "tool:b": 0.5 } }) })(question)).rejects.toThrow("invalid");
    await expect(createJevChooser({ apiKey: () => "k", fetch: reply({ type: "choice", choice: "tool:a", confidence: 0.9, probabilities: { "tool:a": 1 } }) })(question)).rejects.toThrow("invalid");
  });
  it("never leaks the response body or key in errors, and reports unknown cost as null", async () => {
    const failing = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ echo: "key-fake" }) }) as unknown as Response);
    await expect(createJevChooser({ apiKey: () => "key-fake", fetch: failing })(question)).rejects.toThrow(/^TypeSafe returned HTTP 500\.$/);
    const noUsage = await createJevChooser({ apiKey: () => "k", fetch: reply({ type: "choice", choice: "tool:a", confidence: 0.9, probabilities: { "tool:a": 0.9, "tool:b": 0.1 } }, {}) })(question);
    expect(noUsage.costUsd).toBeNull();
  });
});
