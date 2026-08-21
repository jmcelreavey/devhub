import { describe, expect, it } from "vitest";
import { buildRebaseTodo, stepToLines, type RebaseStep } from "./rebase-todo";

const msgPath = (sha: string) => `/tmp/rebase-msg-${sha}`;

describe("buildRebaseTodo", () => {
  it("emits pick lines for a plain ordered plan", () => {
    const steps: RebaseStep[] = [
      { commit: "aaaaaaa", op: "pick" },
      { commit: "bbbbbbb", op: "pick" },
    ];
    const result = buildRebaseTodo(steps, msgPath);
    expect(result).toEqual({ ok: true, todo: "pick aaaaaaa\npick bbbbbbb\n" });
  });

  it("maps reword to pick + exec amend with the message file", () => {
    const steps: RebaseStep[] = [{ commit: "aaaaaaa", op: "reword", message: "new subject" }];
    const result = buildRebaseTodo(steps, msgPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.todo).toBe(
        "pick aaaaaaa\nexec git commit --amend --no-verify -F '/tmp/rebase-msg-aaaaaaa'\n",
      );
    }
  });

  it("uses native fixup/squash verbs and amends only when a message is given", () => {
    const fixup = stepToLines({ commit: "ccccccc", op: "fixup" }, 1, msgPath);
    expect(fixup).toEqual(["fixup ccccccc"]);
    const squashMsg = stepToLines({ commit: "ddddddd", op: "squash", message: "combined" }, 1, msgPath);
    expect(squashMsg[0]).toBe("squash ddddddd");
    expect(squashMsg[1]).toContain("--amend");
  });

  it("rejects squash/fixup as the first step", () => {
    const result = buildRebaseTodo([{ commit: "eeeeeee", op: "fixup" }], msgPath);
    expect(result.ok).toBe(false);
  });

  it("rejects dropping every commit", () => {
    const result = buildRebaseTodo(
      [
        { commit: "ffffff1", op: "drop" },
        { commit: "ffffff2", op: "drop" },
      ],
      msgPath,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects duplicate commits and missing reword messages", () => {
    expect(buildRebaseTodo([{ commit: "aaaaaaa", op: "pick" }, { commit: "aaaaaaa", op: "pick" }], msgPath).ok).toBe(false);
    expect(buildRebaseTodo([{ commit: "bbbbbbb", op: "reword" }], msgPath).ok).toBe(false);
    expect(buildRebaseTodo([{ commit: "not-a-sha", op: "pick" }], msgPath).ok).toBe(false);
    expect(buildRebaseTodo([], msgPath).ok).toBe(false);
  });
});
