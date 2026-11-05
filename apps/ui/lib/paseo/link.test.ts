import { describe, expect, it } from "vitest";
import { resolvePaseoLink } from "./link";

describe("links from the embedded agent", () => {
  it("routes dashboard links and same-port loopback aliases into the app", () => {
    expect(resolvePaseoLink("http://localhost:1337/notes/plans/a?view=full#next", "http://127.0.0.1:1337"))
      .toEqual({ kind: "internal", href: "/notes/plans/a?view=full#next" });
    expect(resolvePaseoLink("/work?tab=board", "http://localhost:1337"))
      .toEqual({ kind: "internal", href: "/work?tab=board" });
  });

  it("keeps other origins in the browser and rejects unsafe links", () => {
    expect(resolvePaseoLink("http://localhost:6767/notes/a", "http://localhost:1337"))
      .toEqual({ kind: "external", href: "http://localhost:6767/notes/a" });
    expect(resolvePaseoLink("https://github.com/example/repo", "http://localhost:1337"))
      .toEqual({ kind: "external", href: "https://github.com/example/repo" });
    expect(resolvePaseoLink("javascript:alert(1)", "http://localhost:1337")).toBeNull();
    expect(resolvePaseoLink("http://user:password@localhost:1337/notes/a", "http://localhost:1337")).toBeNull();
    expect(resolvePaseoLink("x".repeat(4097), "http://localhost:1337")).toBeNull();
  });
});
