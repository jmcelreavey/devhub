import { describe, expect, it } from "vitest";
import type { RepoDomain } from "./types";
import { domainForPath } from "./domains";

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
});
