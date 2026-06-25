import { afterEach, describe, expect, it } from "vitest";
import { cleanOpenChamberEnv, resolveOpenChamberBind } from "./openchamber-command";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("cleanOpenChamberEnv", () => {
  it("chains OpenChamber to shared OpenCode on OPENCODE_PORT", () => {
    process.env.OPENCODE_PORT = "1338";
    process.env.OPENCODE_HOST = "127.0.0.1";

    const env = cleanOpenChamberEnv();

    expect(env.OPENCODE_PORT).toBe("1338");
    expect(env.OPENCODE_SKIP_START).toBe("true");
    expect(env.OPENCODE_HOST).toBeUndefined();
  });

  it("defaults OPENCODE_PORT to 1338 when unset", () => {
    delete process.env.OPENCODE_PORT;
    delete process.env.OPENCODE_HOST;

    const env = cleanOpenChamberEnv();

    expect(env.OPENCODE_PORT).toBe("1338");
    expect(env.OPENCODE_SKIP_START).toBe("true");
  });
});

describe("resolveOpenChamberBind", () => {
  const base: Record<string, string | undefined> = {};

  it("falls back to loopback when 0.0.0.0 is requested without UI auth", () => {
    // OpenChamber >=1.13 exits with code 4 binding a LAN address unauthenticated.
    const bind = resolveOpenChamberBind({ ...base, OPENCHAMBER_HOST: "0.0.0.0" });
    expect(bind.host).toBe("127.0.0.1");
    expect(bind.probe).toBe("127.0.0.1");
    expect(bind.note).toMatch(/UI auth/i);
  });

  it("defaults to loopback fallback when OPENCHAMBER_HOST is unset", () => {
    const bind = resolveOpenChamberBind({ ...base });
    expect(bind.host).toBe("127.0.0.1");
    expect(bind.note).toBeDefined();
  });

  it("keeps the LAN bind when a UI password is configured", () => {
    const bind = resolveOpenChamberBind({
      ...base,
      OPENCHAMBER_HOST: "0.0.0.0",
      OPENCHAMBER_UI_PASSWORD: "hunter2",
    });
    expect(bind.host).toBe("0.0.0.0");
    expect(bind.probe).toBe("127.0.0.1");
    expect(bind.note).toBeUndefined();
  });

  it("keeps the LAN bind when unauthenticated LAN is explicitly allowed", () => {
    const bind = resolveOpenChamberBind({
      ...base,
      OPENCHAMBER_HOST: "0.0.0.0",
      OPENCHAMBER_ALLOW_UNAUTHENTICATED_LAN: "true",
    });
    expect(bind.host).toBe("0.0.0.0");
    expect(bind.note).toBeUndefined();
  });

  it("leaves an explicit loopback host untouched", () => {
    const bind = resolveOpenChamberBind({ ...base, OPENCHAMBER_HOST: "127.0.0.1" });
    expect(bind.host).toBe("127.0.0.1");
    expect(bind.note).toBeUndefined();
  });

  it("preserves a non-loopback LAN IP when authenticated", () => {
    const bind = resolveOpenChamberBind({
      ...base,
      OPENCHAMBER_HOST: "192.168.1.50",
      OPENCHAMBER_UI_PASSWORD: "pw",
    });
    expect(bind.host).toBe("192.168.1.50");
    expect(bind.probe).toBe("192.168.1.50");
  });
});
