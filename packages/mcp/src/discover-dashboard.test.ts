import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveDashboard, type DashboardRuntimeInfo } from "./discover-dashboard.ts";

describe("resolveDashboard", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  function advertise(info: Partial<DashboardRuntimeInfo>): string {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-discover-"));
    const file = path.join(dir, "dashboard.json");
    fs.writeFileSync(
      file,
      JSON.stringify({ port: 1342, startedAt: 0, kind: "checkout", features: [], ...info }),
    );
    return file;
  }

  it("follows a live advertisement", () => {
    const file = advertise({ baseUrl: "http://127.0.0.1:1342", pid: process.pid });
    expect(resolveDashboard({}, file)).toMatchObject({ baseUrl: "http://127.0.0.1:1342", source: "advertised" });
  });

  it("falls back to 1337 when the advertiser has exited", () => {
    // Far above any real pid limit, so it can't belong to a live process.
    const file = advertise({ baseUrl: "http://127.0.0.1:1342", pid: 2 ** 30 });
    expect(resolveDashboard({}, file)).toEqual({ baseUrl: "http://localhost:1337", source: "default", runtime: null });
  });

  it("lets an explicit DEVHUB_BASE_URL win over the advertisement", () => {
    const file = advertise({ baseUrl: "http://127.0.0.1:1342", pid: process.pid });
    expect(resolveDashboard({ DEVHUB_BASE_URL: "http://127.0.0.1:4000" }, file)).toMatchObject({
      baseUrl: "http://127.0.0.1:4000",
      source: "env",
    });
  });
});
