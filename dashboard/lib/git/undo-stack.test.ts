/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";
import { clearUndo, peekUndo, popUndo, recordUndo } from "./undo-stack";

beforeEach(() => {
  window.sessionStorage.clear();
});

describe("undo stack", () => {
  it("records and peeks the latest entry", () => {
    recordUndo("web", {
      id: "commit:abc",
      label: 'commit "x"',
      headBefore: "abc",
      kind: "soft",
    });
    expect(peekUndo("web")?.id).toBe("commit:abc");
  });

  it("caps the stack at five and keeps newest first", () => {
    for (let i = 0; i < 7; i += 1) {
      recordUndo("web", {
        id: `a${i}`,
        label: `action ${i}`,
        headBefore: String(i),
        kind: "hard",
      });
    }
    expect(peekUndo("web")?.id).toBe("a6");
    let count = 0;
    while (popUndo("web")) count += 1;
    expect(count).toBe(5);
  });

  it("pops in LIFO order and is repo-scoped", () => {
    recordUndo("web", { id: "one", label: "one", headBefore: "1", kind: "soft" });
    recordUndo("web", { id: "two", label: "two", headBefore: "2", kind: "hard" });
    recordUndo("api", { id: "other", label: "other", headBefore: "3", kind: "hard" });
    expect(popUndo("web")?.id).toBe("two");
    expect(popUndo("web")?.id).toBe("one");
    expect(popUndo("web")).toBeNull();
    expect(peekUndo("api")?.id).toBe("other");
  });

  it("re-recording the same id replaces instead of duplicating", () => {
    recordUndo("web", { id: "x", label: "first", headBefore: "1", kind: "soft" });
    recordUndo("web", { id: "x", label: "second", headBefore: "2", kind: "soft" });
    expect(peekUndo("web")?.label).toBe("second");
    expect(popUndo("web")).toBeTruthy();
    expect(popUndo("web")).toBeNull();
  });

  it("clearUndo removes everything", () => {
    recordUndo("web", { id: "x", label: "x", headBefore: "1", kind: "soft" });
    clearUndo("web");
    expect(peekUndo("web")).toBeNull();
  });
});
