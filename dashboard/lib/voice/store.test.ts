import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VOICE_SCENARIOS } from "./scenarios";
import { markTrained, pendingAnswers, readAnswers, saveAnswer, staleRefs } from "./store";
import { MAX_ANSWER_CHARS } from "./types";

vi.mock("@/lib/content/dirs", () => ({ getNotesDir: () => "/unused" }));

const [first, second] = VOICE_SCENARIOS;
const t0 = new Date("2026-10-01T09:00:00.000Z");
const t1 = new Date("2026-10-01T10:00:00.000Z");
const t2 = new Date("2026-10-01T11:00:00.000Z");

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "voice-store-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("voice answer store", () => {
  it("reads as empty before anything is saved", () => {
    expect(readAnswers(dir)).toEqual([]);
  });

  it("saves a trimmed answer and reads it back", () => {
    saveAnswer(first.id, "  Sounds good, cheers  ", dir, t0);
    expect(readAnswers(dir)).toEqual([
      { scenarioId: first.id, answer: "Sounds good, cheers", answeredAt: t0.toISOString() },
    ]);
  });

  it("replaces an edited answer and queues it for training again", () => {
    saveAnswer(first.id, "v1", dir, t0);
    markTrained([{ scenarioId: first.id, answeredAt: t0.toISOString() }], dir, t1);
    saveAnswer(first.id, "v2", dir, t2);

    const [answer] = readAnswers(dir);
    expect(answer).toEqual({ scenarioId: first.id, answer: "v2", answeredAt: t2.toISOString() });
    expect(pendingAnswers(readAnswers(dir))).toHaveLength(1);
  });

  it("keeps trained state when the same text is saved again", () => {
    saveAnswer(first.id, "same", dir, t0);
    markTrained([{ scenarioId: first.id, answeredAt: t0.toISOString() }], dir, t1);
    saveAnswer(first.id, "same", dir, t2);

    expect(pendingAnswers(readAnswers(dir))).toEqual([]);
  });

  it("clears an answer when the text is blank", () => {
    saveAnswer(first.id, "something", dir, t0);
    saveAnswer(second.id, "else", dir, t0);
    saveAnswer(first.id, "   ", dir, t1);

    expect(readAnswers(dir).map((a) => a.scenarioId)).toEqual([second.id]);
  });

  it("rejects unknown scenarios and over-long answers", () => {
    expect(() => saveAnswer("nope", "x", dir)).toThrow("Unknown scenario");
    expect(() => saveAnswer(first.id, "x".repeat(MAX_ANSWER_CHARS + 1), dir)).toThrow("characters");
    expect(readAnswers(dir)).toEqual([]);
  });

  it("refuses to read a corrupt file as empty, since the next save would overwrite it", () => {
    fs.writeFileSync(path.join(dir, "answers.json"), JSON.stringify({ answers: [{ scenarioId: 1 }] }));
    expect(() => readAnswers(dir)).toThrow("not valid voice data");
    expect(() => saveAnswer(first.id, "x", dir)).toThrow("not valid voice data");
  });

  it("leaves no temp file behind after a write", () => {
    saveAnswer(first.id, "x", dir, t0);
    expect(fs.readdirSync(dir)).toEqual(["answers.json"]);
  });

  it("ignores answers to retired scenarios when counting pending work", () => {
    const orphan = { scenarioId: "long-gone", answer: "x", answeredAt: t0.toISOString() };
    expect(pendingAnswers([orphan])).toEqual([]);
  });
});

describe("markTrained", () => {
  it("marks only the exact versions it is given", () => {
    saveAnswer(first.id, "a", dir, t0);
    saveAnswer(second.id, "b", dir, t0);
    markTrained([{ scenarioId: first.id, answeredAt: t0.toISOString() }], dir, t1);

    const byId = Object.fromEntries(readAnswers(dir).map((a) => [a.scenarioId, a]));
    expect(byId[first.id].trainedAt).toBe(t1.toISOString());
    expect(byId[second.id].trainedAt).toBeUndefined();
  });

  it("throws, and changes nothing, when an answer was edited after the draft", () => {
    saveAnswer(first.id, "before", dir, t0);
    saveAnswer(first.id, "after", dir, t1);

    expect(() => markTrained([{ scenarioId: first.id, answeredAt: t0.toISOString() }], dir, t2)).toThrow(
      "Answers changed",
    );
    expect(readAnswers(dir)[0].trainedAt).toBeUndefined();
  });

  it("reports stale refs for answers that are cleared or already trained", () => {
    saveAnswer(first.id, "a", dir, t0);
    const ref = { scenarioId: first.id, answeredAt: t0.toISOString() };
    expect(staleRefs([ref], readAnswers(dir))).toEqual([]);

    markTrained([ref], dir, t1);
    expect(staleRefs([ref], readAnswers(dir))).toEqual([ref]);
  });
});
