import { describe, expect, it } from "vitest";
import { dispatchRoute, matchRoute, sortRoutes, type RouteDefinition } from "./router";

describe("core route matching", () => {
  it("decodes dynamic segments separately and preserves catch-all arrays", () => {
    expect(matchRoute("/api/repos/[name]/[...path]", "/api/repos/a%2Fb/one/two%20words")).toEqual({ name: "a/b", path: ["one", "two words"] });
    expect(matchRoute("/api/repos/[name]/[...path]", "/api/repos/a")).toBeNull();
    expect(() => matchRoute("/api/repos/[name]", "/api/repos/%FF")).toThrow(URIError);
  });

  it("prefers static paths and does not fall through to a dynamic route on method mismatch", async () => {
    const handler = async (_req: Request, { params }: { params: Promise<Record<string, string | string[]>> }) => Response.json(await params);
    const definitions: RouteDefinition[] = [
      { pattern: "/api/repos/[name]", file: "dynamic", methods: ["GET", "POST"], load: async () => ({ GET: handler, POST: handler }) },
      { pattern: "/api/repos/apps", file: "static", methods: ["GET"], load: async () => ({ GET: handler }) },
    ];
    const routes = sortRoutes(definitions);
    const response = await dispatchRoute(new Request("http://localhost/api/repos/apps", { method: "POST" }), routes);
    expect(response?.status).toBe(405);
    expect(response?.headers.get("allow")).toContain("GET");
    const dynamic = await dispatchRoute(new Request("http://localhost/api/repos/a%20b"), routes);
    expect(await dynamic?.json()).toEqual({ name: "a b" });
  });
});
