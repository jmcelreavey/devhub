import { describe, expect, it } from "vitest";
import { extractPartialDraft, parseDraftJson, parseNdjsonChunk, type DraftEvent } from "./draft-events";

describe("draft progress events", () => {
  it("reads a title and description out of JSON that is still being written", () => {
    expect(extractPartialDraft('{"summary":"Ship the')).toEqual({ summary: "Ship the", description: "" });
    expect(extractPartialDraft('{"summary":"Ship the gate","description":"Line\\nnext')).toEqual({
      summary: "Ship the gate",
      description: "Line\nnext",
    });
  });

  it("parses a fenced reply and repairs raw line breaks inside strings", () => {
    expect(parseDraftJson('```json\n{"summary":"Title","description":"Body"}\n```')).toEqual({
      summary: "Title",
      description: "Body",
    });
    expect(parseDraftJson('{"summary":"Title","description":"Line one\nLine two"}')).toEqual({
      summary: "Title",
      description: "Line one\nLine two",
    });
    expect(() => parseDraftJson("not json")).toThrow();
  });

  it("splits complete lines and keeps an unfinished tail", () => {
    const first = parseNdjsonChunk('{"type":"step","step":"context","status":"running","at":1}\n{"type":"par');
    expect(first.events).toEqual([{ type: "step", step: "context", status: "running", at: 1 }]);
    expect(first.rest).toBe('{"type":"par');
    const second = parseNdjsonChunk(`${first.rest}tial","summary":"Title","description":""}\nnot-json\n`);
    expect(second.events.map((event) => event.type)).toEqual(["partial"]);
    expect(second.rest).toBe("");
  });

  it("keeps an error event after the steps that led to it", () => {
    const lines: DraftEvent[] = [
      { type: "step", step: "draft", status: "running", at: 4 },
      { type: "step", step: "draft", status: "error", at: 9, detail: "rate limited" },
      { type: "error", step: "draft", message: "rate limited", totalMs: 9 },
    ];
    const { events } = parseNdjsonChunk(`${lines.map((event) => JSON.stringify(event)).join("\n")}\n`);
    expect(events.map((event) => event.type === "step" ? event.status : event.type)).toEqual(["running", "error", "error"]);
    expect(events.at(-1)).toMatchObject({ type: "error", step: "draft", message: "rate limited" });
  });
});
