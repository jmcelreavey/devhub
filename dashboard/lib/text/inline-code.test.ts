import { describe, expect, it } from "vitest";
import { looksLikeCommand, splitInlineCode, stripAnsi } from "./inline-code";

describe("splitInlineCode", () => {
  it("turns backtick spans into code segments", () => {
    expect(splitInlineCode("Run `claude auth login` in DevHub's terminal, then retry.")).toEqual([
      { kind: "text", text: "Run " },
      { kind: "code", text: "claude auth login" },
      { kind: "text", text: " in DevHub's terminal, then retry." },
    ]);
  });
  it("handles several spans and leaves an unmatched backtick literal", () => {
    expect(splitInlineCode("`a b` and `c d`").map((s) => s.kind)).toEqual(["code", "text", "code"]);
    expect(splitInlineCode("odd ` tick")).toEqual([{ kind: "text", text: "odd ` tick" }]);
    expect(splitInlineCode("")).toEqual([]);
  });
});

describe("looksLikeCommand", () => {
  it("accepts a program with arguments, not prose or code", () => {
    expect(looksLikeCommand("claude auth login")).toBe(true);
    expect(looksLikeCommand("agent login")).toBe(true);
    expect(looksLikeCommand("sudo apt install git")).toBe(true);
    expect(looksLikeCommand("opencode.json")).toBe(false);
    expect(looksLikeCommand("foo(bar baz)")).toBe(false);
  });
});

describe("stripAnsi", () => {
  it("removes colour codes with and without the escape byte", () => {
    expect(stripAnsi("\u001b[91m\u001b[1mError: \u001b[0mbad")).toBe("Error: bad");
    expect(stripAnsi("[91m[1mError: [0mbad")).toBe("Error: bad");
    expect(stripAnsi("\u001b]8;;https://example.com\u0007link\u001b]8;;\u0007")).toBe("link");
  });
  it("keeps ordinary brackets", () => {
    expect(stripAnsi("see [1] and array[2]")).toBe("see [1] and array[2]");
  });
});
