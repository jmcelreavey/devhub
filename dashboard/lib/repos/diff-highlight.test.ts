import { describe, expect, it } from "vitest";
import { langForPath, highlightDiffLine } from "./diff-highlight";

describe("langForPath", () => {
  it("maps extensions to prism languages", () => {
    expect(langForPath("src/app/repo-git/GitDiffView.tsx")).toBe("tsx");
    expect(langForPath("lib/utils.ts")).toBe("typescript");
    expect(langForPath("package.json")).toBe("json");
    expect(langForPath("README.md")).toBe("markdown");
    expect(langForPath("scripts/setup.sh")).toBe("bash");
    expect(langForPath("config/settings.yaml")).toBe("yaml");
    expect(langForPath("styles/main.scss")).toBe("scss");
  });

  it("handles special filenames", () => {
    expect(langForPath("Dockerfile")).toBe("bash");
    expect(langForPath(".env.local")).toBe("bash");
    expect(langForPath("Cargo.toml")).toBe("ini");
  });

  it("returns null for unknown types", () => {
    expect(langForPath("assets/logo.xyz")).toBeNull();
    expect(langForPath("Makefile")).toBeNull();
  });
});

describe("highlightDiffLine", () => {
  it("returns token nodes for a known language", () => {
    const nodes = highlightDiffLine("const x = 1;", "typescript");
    expect(nodes).not.toBeNull();
    const html = JSON.stringify(nodes);
    expect(html).toContain('"keyword"');
    expect(html).toContain('"number"');
  });

  it("caches repeated lines", () => {
    expect(highlightDiffLine("const same = 1;", "typescript")).toBe(
      highlightDiffLine("const same = 1;", "typescript"),
    );
  });

  it("returns null for an unregistered language", () => {
    expect(highlightDiffLine("plain", "not-a-language")).toBeNull();
  });
});
