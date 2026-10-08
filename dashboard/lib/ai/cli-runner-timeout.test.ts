import { describe, expect, it } from "vitest";
import {
  describeCliTimeout,
  execCapture,
  extractCursorStreamText,
  looksComplete,
} from "./cli-runner";

/**
 * Idle/ceiling timer behaviour lives in cli-runner-idle.test.ts (fake timers);
 * these use real processes only where no timer budget is involved.
 */
/** A stand-in CLI: `sh -c <script>` behaves however the test needs. */
const sh = (script: string) => ["-c", script];
const CWD = "/tmp";

describe("looksComplete", () => {
  it("accepts a finished document", () => {
    expect(looksComplete("<!doctype html><html><body>hi</body></html>")).toBe(true);
  });

  it("rejects one cut off mid-flight", () => {
    expect(looksComplete("<!doctype html><html><body><div class=")).toBe(false);
  });
});

describe("describeCliTimeout", () => {
  it("points at a stuck prompt when nothing came back", () => {
    expect(describeCliTimeout("cursor-agent", 90_000, 0)).toContain("no output in 90s");
  });

  it("reports how much of a partial reply arrived when it went quiet", () => {
    const msg = describeCliTimeout("cursor-agent", 120_000, 4_096, "idle");
    expect(msg).toContain("120s");
    expect(msg).toContain("4096 bytes");
  });

  it("does not accuse a still-working CLI of stopping when it hit the ceiling", () => {
    // The bug this fixes: eight PR reviews all died at exactly 240s while
    // still streaming, and each was reported as having stopped responding.
    const msg = describeCliTimeout("cursor-agent", 240_000, 952, "ceiling");
    expect(msg).toContain("time limit while still working");
    expect(msg).toContain("fewer generations at once");
    expect(msg).not.toContain("stopped responding");
  });
});

describe("execCapture", () => {
  it("returns output from a CLI that exits cleanly", async () => {
    await expect(execCapture("/bin/sh", sh("printf done"), 5_000, CWD)).resolves.toBe("done");
  });

  it("surfaces a missing binary clearly", async () => {
    await expect(execCapture("/nope/missing-cli", [], 2_000, CWD)).rejects.toThrow(/not found on PATH/);
  });

  it("honours an abort signal", async () => {
    const ac = new AbortController();
    const p = execCapture("/bin/sh", sh("sleep 30"), 10_000, CWD, ac.signal, 5_000);
    setTimeout(() => ac.abort(), 50);
    await expect(p).rejects.toThrow(/cancelled/i);
  });
});

describe("extractCursorStreamText", () => {
  const line = (o: unknown) => `${JSON.stringify(o)}\n`;

  it("prefers the terminal result event", () => {
    const raw =
      line({ type: "system", subtype: "init" }) +
      line({ type: "assistant", message: { content: [{ type: "text", text: "par" }] } }) +
      line({ type: "assistant", message: { content: [{ type: "text", text: "tial" }] } }) +
      line({ type: "result", subtype: "success", result: "the whole answer" });
    // Joining the deltas would double the text, because the last assistant
    // event repeats the full message.
    expect(extractCursorStreamText(raw)).toBe("the whole answer");
  });

  it("falls back to deltas when the run was cut off before the result", () => {
    const raw =
      line({ type: "assistant", message: { content: [{ type: "text", text: "<html>" }] } }) +
      line({ type: "assistant", message: { content: [{ type: "text", text: "hi</html>" }] } });
    expect(extractCursorStreamText(raw)).toBe("<html>hi</html>");
  });

  it("ignores thinking deltas", () => {
    const raw =
      line({ type: "thinking", subtype: "delta", text: "hmm" }) +
      line({ type: "result", subtype: "success", result: "answer" });
    expect(extractCursorStreamText(raw)).toBe("answer");
  });

  it("survives a torn final line from a killed process", () => {
    const raw =
      line({ type: "assistant", message: { content: [{ type: "text", text: "ok" }] } }) +
      '{"type":"assist';
    expect(extractCursorStreamText(raw)).toBe("ok");
  });

  it("passes plain text through untouched", () => {
    expect(extractCursorStreamText("just text, no json")).toBe("just text, no json");
  });
});
