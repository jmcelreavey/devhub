import { describe, expect, it } from "vitest";
import {
  AGENT_ATTACH_MAX_BYTES,
  bytesToDataUrl,
  classifyAgentBytes,
  cliCannotUseImages,
  fileExt,
  formatAttachSize,
  isProbablyBinary,
  mergeAttachmentsIntoPrompt,
  parseAgentAttachPayload,
  rejectAttachMessage,
} from "./agent-attach";

function bytesFrom(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe("classifyAgentBytes", () => {
  it("inlines text and markdown", () => {
    const a = classifyAgentBytes({
      name: "notes.md",
      mime: "text/markdown",
      size: 12,
      bytes: bytesFrom("# hello\n"),
    });
    expect(a.kind).toBe("text");
    if (a.kind === "text") expect(a.text).toContain("hello");
  });

  it("treats known code extensions as text even with a generic mime", () => {
    const a = classifyAgentBytes({
      name: "Dock.tsx",
      mime: "application/octet-stream",
      size: 20,
      bytes: bytesFrom("export const x = 1;\n"),
    });
    expect(a.kind).toBe("text");
  });

  it("accepts png images", () => {
    const a = classifyAgentBytes({
      name: "shot.png",
      mime: "image/png",
      size: 8,
      bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    });
    expect(a).toEqual({ kind: "image", mime: "image/png" });
  });

  it("rejects empty and oversized files", () => {
    expect(
      classifyAgentBytes({ name: "a.txt", mime: "text/plain", size: 0, bytes: new Uint8Array() }).kind,
    ).toBe("rejected");
    const huge = new Uint8Array(8);
    expect(
      classifyAgentBytes({
        name: "big.txt",
        mime: "text/plain",
        size: AGENT_ATTACH_MAX_BYTES + 1,
        bytes: huge,
      }),
    ).toMatchObject({ kind: "rejected", reason: "too-large" });
  });

  it("rejects binary blobs", () => {
    const a = classifyAgentBytes({
      name: "blob.bin",
      mime: "application/octet-stream",
      size: 4,
      bytes: new Uint8Array([0, 1, 2, 3]),
    });
    expect(a).toMatchObject({ kind: "rejected", reason: "binary" });
  });
});

describe("isProbablyBinary / helpers", () => {
  it("flags NULs and accepts utf-8", () => {
    expect(isProbablyBinary(new Uint8Array([65, 0, 66]))).toBe(true);
    expect(isProbablyBinary(bytesFrom("plain text"))).toBe(false);
  });

  it("formats sizes and extensions", () => {
    expect(fileExt("Foo.TSX")).toBe("tsx");
    expect(formatAttachSize(200)).toBe("200 B");
    expect(rejectAttachMessage({ name: "x.bin", reason: "binary" })).toContain("x.bin");
  });

  it("builds a data URL for small buffers", () => {
    const url = bytesToDataUrl(bytesFrom("hi"), "text/plain");
    expect(url.startsWith("data:text/plain;base64,")).toBe(true);
  });
});

describe("mergeAttachmentsIntoPrompt", () => {
  it("fences text files and notes skipped CLI images", () => {
    const merged = mergeAttachmentsIntoPrompt({
      text: "look at this",
      attachments: [
        { name: "a.ts", kind: "text", text: "const x = 1;" },
        { name: "shot.png", kind: "image", dataUrl: "data:image/png;base64,abc" },
      ],
      imageMode: "cli",
    });
    expect(merged.prompt).toContain("look at this");
    expect(merged.prompt).toContain("Attached a.ts");
    expect(merged.prompt).toContain("const x = 1;");
    expect(merged.images).toEqual([]);
    expect(merged.skippedImages).toEqual(["shot.png"]);
    expect(merged.prompt).toMatch(/CLI print may not/i);
  });

  it("keeps images for the HTTP API path", () => {
    const merged = mergeAttachmentsIntoPrompt({
      text: "what is this",
      attachments: [{ name: "shot.png", kind: "image", dataUrl: "data:image/png;base64,abc" }],
      imageMode: "api",
    });
    expect(merged.images).toEqual([{ name: "shot.png", dataUrl: "data:image/png;base64,abc" }]);
    expect(merged.skippedImages).toEqual([]);
    expect(merged.prompt).toContain("Attached image: shot.png");
  });
});

describe("parseAgentAttachPayload", () => {
  it("drops garbage and keeps text/image payloads", () => {
    const parsed = parseAgentAttachPayload([
      { name: "a.md", kind: "text", text: "# hi" },
      { name: "b.png", kind: "image", dataUrl: "data:image/png;base64,abc" },
      { name: "nope", kind: "image", dataUrl: "http://evil" },
      { kind: "text", text: "missing name" },
      "nope",
    ]);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.name).toBe("a.md");
    expect(parsed[1]?.kind).toBe("image");
  });
});

describe("cliCannotUseImages", () => {
  it("treats CLI print modes as image-blind", () => {
    expect(cliCannotUseImages("cursor-cli")).toBe(true);
    expect(cliCannotUseImages("opencode")).toBe(true);
    expect(cliCannotUseImages("api")).toBe(false);
  });
});
