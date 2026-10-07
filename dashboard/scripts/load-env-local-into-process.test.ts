import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveDashboardBindHost } from "./load-env-local-into-process";

afterEach(() => vi.unstubAllEnvs());

describe("dashboard bind address", () => {
  it("keeps an unconfigured checkout local", () => {
    vi.stubEnv("DEVHUB_BIND_HOST", undefined);
    expect(resolveDashboardBindHost()).toBe("127.0.0.1");
    vi.stubEnv("DEVHUB_BIND_HOST", "  ");
    expect(resolveDashboardBindHost()).toBe("127.0.0.1");
  });

  it("leaves LAN exposure to the proxy", () => {
    expect(resolveDashboardBindHost("auto")).toBe("127.0.0.1");
    expect(resolveDashboardBindHost(" LAN ")).toBe("127.0.0.1");
  });

  it("honours an explicit address", () => {
    vi.stubEnv("DEVHUB_BIND_HOST", " 0.0.0.0 ");
    expect(resolveDashboardBindHost()).toBe("0.0.0.0");
    expect(resolveDashboardBindHost("192.168.1.20")).toBe("192.168.1.20");
  });
});
