import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { RepoDomain } from "./types";
import { domainForPath } from "./domains";

describe("source encoding", () => {
  it("does not contain raw NUL bytes", () => {
    const buf = fs.readFileSync(fileURLToPath(new URL("./service.ts", import.meta.url)));
    expect(buf.includes(0)).toBe(false);
  });
});

describe("ownership domain lookup", () => {
  it("maps files to the most specific derived domain list", () => {
    const domains: RepoDomain[] = [
      { id: "api", label: "apps/api", paths: ["apps/api"], source: "workspace", codeowners: [] },
      { id: "web", label: "apps/web", paths: ["apps/web"], source: "workspace", codeowners: [] },
    ];
    expect(domainForPath(domains, "apps/api/src/index.ts")?.id).toBe("api");
    expect(domainForPath(domains, "README.md")).toBeNull();
  });

  it("prefers a nested domain over a root fallback", () => {
    const domains: RepoDomain[] = [
      { id: "root", label: "Root", paths: ["."], source: "directory", codeowners: [] },
      { id: "api", label: "apps/api", paths: ["apps/api"], source: "workspace", codeowners: [] },
    ];
    expect(domainForPath(domains, "apps/api/index.ts")?.id).toBe("api");
  });

  it("ranks by the matching prefix, not an unmatched longer path on the same domain", () => {
    const domains: RepoDomain[] = [
      {
        id: "src",
        label: "src",
        paths: ["src/unrelated/very/long/path/that/does/not/match", "src"],
        source: "directory",
        codeowners: [],
      },
      { id: "foo", label: "src/foo", paths: ["src/foo"], source: "workspace", codeowners: [] },
    ];
    expect(domainForPath(domains, "src/foo/bar.ts")?.id).toBe("foo");
  });
});
