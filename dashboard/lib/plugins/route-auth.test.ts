import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

afterEach(() => vi.unstubAllEnvs());

const root = path.resolve("app/api/plugins");
const routes = fs.readdirSync(root, { recursive: true }).filter((file): file is string => typeof file === "string" && file.endsWith("route.ts"));

describe("every sensitive plugin route authenticates before accessing data", () => {
  it.each(routes)("%s", async (route) => {
    vi.stubEnv("DEVHUB_BOOTSTRAP_TOKEN", "");
    vi.stubEnv("DEVHUB_API_SECRET", "");
    vi.stubEnv("DEVHUB_BIND_HOST", "0.0.0.0");
    const handlers = await import(/* @vite-ignore */ path.join(root, route)) as Record<string, (req: NextRequest, context: { params: Promise<{ id: string }> }) => Promise<Response>>;
    for (const method of ["GET", "POST", "DELETE", "PATCH", "PUT"]) {
      if (!handlers[method]) continue;
      const url = `http://localhost:14567/api/plugins/${route.replace(/route\.ts$/, "")}`;
      const req = new NextRequest(url, { method, headers: { host: "localhost:14567", origin: "http://localhost:14567" } });
      const response = await handlers[method](req, { params: Promise.resolve({ id: "unknown" }) });
      expect(response.status).toBe(403);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    }
  });
});
