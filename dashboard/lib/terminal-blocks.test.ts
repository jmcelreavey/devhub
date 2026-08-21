import { describe, expect, it } from "vitest";
import {
  applyTypedInput,
  capBlockOutput,
  commandFromPromptLine,
  dataTransferHasTerminalSelection,
  formatBlockForAgent,
  lastNonEmptyLine,
  looksLikePromptLine,
  parseOsc133,
  parseStructuredExit,
  previewBlockCommand,
  readTerminalSelection,
  setTerminalSelectionDrag,
  shouldRecordTypedCommand,
  sliceNewOutput,
  stripCommandEcho,
  stripRightPrompt,
  terminalBufferMarker,
  TERMINAL_SELECTION_MIME,
} from "./terminal-blocks";

describe("sliceNewOutput", () => {
  it("takes the suffix after the start marker", () => {
    expect(sliceNewOutput("prompt\n", "prompt\nls\nfile.txt\n")).toBe("ls\nfile.txt\n");
  });

  it("falls back to the last block when the marker is gone", () => {
    const out = sliceNewOutput("ancient-scrollback", "a\nb\nc\nd");
    expect(out.split("\n").length).toBeLessThanOrEqual(80);
    expect(out).toContain("d");
  });

  it("returns the whole buffer when there is no marker", () => {
    expect(sliceNewOutput("", "hello")).toBe("hello");
  });
});

describe("terminalBufferMarker", () => {
  it("keeps short buffers intact", () => {
    expect(terminalBufferMarker("abc")).toBe("abc");
  });

  it("clips long buffers to the tail", () => {
    const huge = "x".repeat(9_000);
    const marker = terminalBufferMarker(huge);
    expect(marker.length).toBe(4_000);
    expect(huge.endsWith(marker)).toBe(true);
  });
});

describe("stripCommandEcho / cap / exit", () => {
  it("drops the echoed command line", () => {
    expect(stripCommandEcho("ls", "ls\nfile.txt\n")).toBe("file.txt\n");
    expect(stripCommandEcho("ls", "❯ ls\nfile.txt")).toBe("file.txt");
  });

  it("caps giant output", () => {
    const capped = capBlockOutput("y".repeat(30_000), 100);
    expect(capped.length).toBeLessThan(120);
    expect(capped.endsWith("…")).toBe(true);
  });

  it("parses structured exit banners", () => {
    expect(parseStructuredExit("hi\n── exit 0 ──\n")).toBe(0);
    expect(parseStructuredExit("── exit 12 ──")).toBe(12);
    expect(parseStructuredExit("nope")).toBeNull();
  });
});

describe("formatBlockForAgent", () => {
  it("includes command and output", () => {
    expect(formatBlockForAgent({ command: "ls", output: "a\nb" })).toBe("$ ls\na\nb");
    expect(formatBlockForAgent({ command: "pwd", output: "" })).toBe("$ pwd");
  });
});

describe("typed command detection", () => {
  it("submits on enter and handles backspace", () => {
    let acc = "";
    acc = applyTypedInput(acc, "l").accum;
    acc = applyTypedInput(acc, "s").accum;
    acc = applyTypedInput(acc, "\x7f").accum;
    acc = applyTypedInput(acc, "s").accum;
    const done = applyTypedInput(acc, "\r");
    expect(done.submitted).toBe("ls");
    expect(done.accum).toBe("");
  });

  it("resets on CSI so arrows don't become fake commands", () => {
    let acc = applyTypedInput("", "git ").accum;
    acc = applyTypedInput(acc, "\x1b[A").accum;
    expect(acc).toBe("");
    expect(applyTypedInput("echo hi", "\r").submitted).toBe("echo hi");
  });

  it("records enter on a prompt or echoed command line", () => {
    expect(shouldRecordTypedCommand("ls", "❯ ls")).toBe(true);
    expect(shouldRecordTypedCommand("ls", "~ %")).toBe(true);
    expect(shouldRecordTypedCommand("ls", "❯ ls                    10:41")).toBe(true);
    expect(shouldRecordTypedCommand("q", "-- INSERT --")).toBe(false);
    expect(shouldRecordTypedCommand("please fix this", "❯ please fix this")).toBe(false);
  });

  it("submits when enter is batched with the command", () => {
    const done = applyTypedInput("", "ls\r");
    expect(done.submitted).toBe("ls");
    expect(done.accum).toBe("");
  });

  it("strips RPROMPT and reads OSC 133 execute", () => {
    expect(stripRightPrompt("❯ git status          6:41PM")).toBe("❯ git status");
    expect(commandFromPromptLine("❯ echo hi                    master")).toBe("echo hi");
    expect(parseOsc133("C")).toEqual({ kind: "C" });
    expect(parseOsc133("D;0")).toEqual({ kind: "D", exitCode: 0 });
    expect(parseOsc133("D;127")).toEqual({ kind: "D", exitCode: 127 });
    expect(parseOsc133("D;notacode")).toEqual({ kind: "D" });
    expect(parseOsc133("nope")).toBeNull();
  });

  it("looks like a prompt only when the glyph is at the end", () => {
    expect(looksLikePromptLine("❯ ")).toBe(true);
    expect(looksLikePromptLine("user@host %")).toBe(true);
    expect(looksLikePromptLine("❯ ls")).toBe(false);
  });

  it("lastNonEmptyLine skips trailing blanks", () => {
    expect(lastNonEmptyLine("a\n\n❯ ls\n\n")).toBe("❯ ls");
  });
});

describe("previewBlockCommand", () => {
  it("ellipsizes", () => {
    expect(previewBlockCommand("short")).toBe("short");
    expect(previewBlockCommand("x".repeat(80), 20).endsWith("…")).toBe(true);
  });
});

describe("terminal selection drag mime", () => {
  it("ignores file drags and reads the custom type first", () => {
    setTerminalSelectionDrag(false);
    const files = { types: ["Files", "text/plain"], getData: () => "nope" } as unknown as DataTransfer;
    expect(dataTransferHasTerminalSelection(files)).toBe(false);
    const term = {
      types: [TERMINAL_SELECTION_MIME, "text/plain"],
      getData: (type: string) => (type === TERMINAL_SELECTION_MIME ? "sel\n" : "plain"),
    } as unknown as DataTransfer;
    expect(dataTransferHasTerminalSelection(term)).toBe(true);
    expect(readTerminalSelection(term)).toBe("sel");
  });

  it("treats a live xterm drag as a match even when Chromium hides types", () => {
    setTerminalSelectionDrag(true, "pwd\n");
    const hidden = {
      types: [],
      getData: () => "",
    } as unknown as DataTransfer;
    expect(dataTransferHasTerminalSelection(hidden)).toBe(true);
    expect(readTerminalSelection(hidden)).toBe("pwd");
    setTerminalSelectionDrag(false);
    expect(dataTransferHasTerminalSelection(hidden)).toBe(false);
  });
});

describe("stripRightPrompt with an indented prompt", () => {
  // Regression: the separator search used to start at index 0, so a theme that
  // indents its prompt (powerlevel10k's default frame) matched on the leading
  // indent and the whole line was discarded. Every gate below then decided
  // there was no prompt on screen, silently disabling typed-command blocks.
  // Indentation is now preserved — only text past the prompt glyph is trimmed.
  const indented = "   ~/Developer \u276f echo hello";

  it("keeps the prompt body when the line starts with indentation", () => {
    expect(stripRightPrompt(indented)).toBe(indented);
  });

  it("still drops a real right prompt after the wide gap", () => {
    expect(stripRightPrompt("   ~/Developer \u276f ls        main at 08:16 PM")).toBe(
      "   ~/Developer \u276f ls",
    );
  });

  it("treats an indented bare prompt as a prompt line", () => {
    expect(looksLikePromptLine("   ~/Developer \u276f          main at 08:16 PM")).toBe(true);
  });

  it("recovers the command typed after an indented prompt", () => {
    expect(commandFromPromptLine(indented)).toBe("echo hello");
  });

  it("records a typed command sitting on an indented prompt line", () => {
    expect(shouldRecordTypedCommand("echo hello", indented)).toBe(true);
  });
});

describe("shouldRecordTypedCommand with autosuggestion ghost text", () => {
  // zsh-autosuggestions renders the completion inline, so the prompt line
  // holds more than was typed. Requiring an exact match dropped the block.
  it("accepts a typed prefix of the suggestion on screen", () => {
    expect(shouldRecordTypedCommand("ab", "   ~/Developer \u276f abacus")).toBe(true);
  });

  it("accepts a longer command with a ghosted flag", () => {
    expect(
      shouldRecordTypedCommand("git stat", "   ~/Developer \u276f git status --short"),
    ).toBe(true);
  });

  it("still rejects a command that is not on the prompt line", () => {
    expect(shouldRecordTypedCommand("rm -rf /", "   ~/Developer \u276f ls")).toBe(false);
  });
});

describe("stripRightPrompt with an icon (Nerd Font) prompt", () => {
  // Real powerlevel10k line: PUA icon glyphs and double spaces before the path,
  // then the command, then a wide gap and the right prompt.
  const p10k =
    "\uf179 \uf07c  ~/Developer \u276f echo hi                    macos-mcp at   08:37:48 PM";

  it("keeps the command instead of cutting at the icon gap", () => {
    expect(stripRightPrompt(p10k).endsWith("echo hi")).toBe(true);
  });

  it("records the typed command from an icon prompt", () => {
    expect(shouldRecordTypedCommand("echo hi", p10k)).toBe(true);
  });

  it("still sees a bare icon prompt as a prompt line", () => {
    expect(
      looksLikePromptLine("\uf179 \uf07c  ~/Developer \u276f          macos-mcp at 08:37 PM"),
    ).toBe(true);
  });

  it("does not mistake a redirect for the prompt glyph", () => {
    expect(shouldRecordTypedCommand("echo hi > out.txt", `${"\uf07c  ~/dev \u276f"} echo hi > out.txt`)).toBe(true);
  });
});
