import { describe, expect, it } from "vitest";
import { resolveTaskInput } from "./resolve-task-input";
import type { EntityRef } from "@/lib/entity-note";

const repo: EntityRef = { kind: "repo", id: "app", label: "app" };
const manual: EntityRef = { kind: "note", id: "manual", label: "Manual note" };

describe("resolveTaskInput", () => {
  it("turns exact repo mentions into the same refs as a picker selection", () => {
    expect(resolveTaskInput("Ship @app", [], ["app"])).toEqual({ text: "Ship", links: [repo] });
    expect(resolveTaskInput("Ship", [repo], ["app"])).toEqual({ text: "Ship", links: [repo] });
  });

  it("keeps manual and previous repo links when the mention changes", () => {
    expect(resolveTaskInput("Ship @api", [manual, repo], ["app", "api"])).toEqual({
      text: "Ship", links: [manual, repo, { kind: "repo", id: "api", label: "api" }],
    });
  });

  it.each(["Ship @missing", "Email john@app", "Plain title", "Ship @app-extra"])("preserves unresolved text: %s", (text) => {
    expect(resolveTaskInput(text, [manual], ["app"])).toEqual({ text, links: [manual] });
  });

  it("detects Jira keys without changing their title text or duplicating picked links", () => {
    const jira: EntityRef = { kind: "jira", id: "PTF-5260", label: "Ticket summary", href: "https://jira.example/browse/PTF-5260" };
    expect(resolveTaskInput("PTF-5260 Ship PTF-5260", [manual, jira])).toEqual({
      text: "PTF-5260 Ship PTF-5260", links: [manual, jira],
    });
  });

  it("is idempotent for repeated mentions and repeated saves", () => {
    const once = resolveTaskInput("PTF-5260 Ship @app @app", [manual], ["app"]);
    expect(once.links).toHaveLength(3);
    expect(resolveTaskInput("PTF-5260 Ship @app @app", once.links, ["app"])).toEqual(once);
    expect(resolveTaskInput(once.text, once.links, ["app"])).toEqual(once);
  });

  it("keeps a nonempty title when it consists only of a repo mention", () => {
    expect(resolveTaskInput("@app", [], ["app"])).toEqual({ text: "@app", links: [repo] });
  });
});
