import { afterEach, describe, expect, it } from "vitest";
import net from "node:net";
import {
  PINNED_OPENCODE_PORTS,
  getDevHubOpenCodePort,
  opencodeSpawnEnv,
  stopDevHubOpenCode,
} from "./listen";
import { reserveEphemeralPort } from "@/lib/port-probe";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  stopDevHubOpenCode();
});

describe("DevHub OpenCode listen", () => {
  it("never uses Chamber-pinned ports", () => {
    expect(PINNED_OPENCODE_PORTS).toContain(1338);
    expect(PINNED_OPENCODE_PORTS).toContain(4096);
  });

  it("starts with no tracked port", () => {
    expect(getDevHubOpenCodePort()).toBeNull();
  });

  it("strips skip-start and pinned-port env from the OpenCode spawn", () => {
    process.env.OPENCODE_PORT = "1338";
    process.env.OPENCODE_HOST = "http://127.0.0.1:1338";
    process.env.OPENCODE_SKIP_START = "true";
    process.env.OPENCHAMBER_OPENCODE_PORT = "1338";
    process.env.OPENCHAMBER_SKIP_OPENCODE_START = "true";

    const env = opencodeSpawnEnv();
    expect(env.OPENCODE_PORT).toBeUndefined();
    expect(env.OPENCODE_HOST).toBeUndefined();
    expect(env.OPENCODE_SKIP_START).toBeUndefined();
    expect(env.OPENCHAMBER_OPENCODE_PORT).toBeUndefined();
    expect(env.OPENCHAMBER_SKIP_OPENCODE_START).toBeUndefined();
  });
  it("reserves a loopback port that is not 1338", async () => {
    const port = await reserveEphemeralPort("127.0.0.1");
    expect(port).toBeGreaterThan(0);
    expect(port).not.toBe(1338);
    expect(PINNED_OPENCODE_PORTS).not.toContain(port);

    const server = net.createServer();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => resolve());
    });
    server.close();
  });
});
