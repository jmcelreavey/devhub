import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

afterEach(() => vi.unstubAllEnvs());

describe("release notes API", () => {
  it("serves the bundled changelog and uses the installed version at request time", async () => {
    vi.stubEnv("DEVHUB_VERSION", "2.0.4");
    const response = GET(new Request("http://localhost/api/release-notes"));
    const body = await response.json();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.currentVersion).toBe("2.0.4");
    expect(body.releases.some((entry: { version: string }) => entry.version === "2.0.5")).toBe(true);
    vi.stubEnv("DEVHUB_VERSION", "2.0.5");
    expect((await GET(new Request("http://localhost/api/release-notes?version=v2.0.5")).json()).releases).toHaveLength(1);
  });
  it("returns an honest empty selection and rejects unsafe version values", async () => {
    expect((await GET(new Request("http://localhost/api/release-notes?version=99.0.0")).json()).releases).toEqual([]);
    expect(GET(new Request("http://localhost/api/release-notes?version=../../secret")).status).toBe(400);
    expect(GET(new Request("http://localhost/api/release-notes?version=Unreleased")).status).toBe(400);
  });
  it("falls back to the source version for web launches", async () => {
    vi.stubEnv("DEVHUB_VERSION", "");
    expect((await GET(new Request("http://localhost/api/release-notes")).json()).currentVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
