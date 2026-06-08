import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { canBindPort, canConnect, waitForPortListening } from "./port-probe";

describe("port-probe", () => {
  let server: net.Server | undefined;

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      if (!server) {
        resolve();
        return;
      }
      server.close(() => resolve());
    });
    server = undefined;
  });

  it("canConnect succeeds when a server is listening", async () => {
    server = net.createServer();
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("expected address");

    expect(await canConnect(addr.port, "127.0.0.1")).toBe(true);
    expect(await canBindPort(addr.port, "127.0.0.1")).toBe(false);
  });

  it("waitForPortListening resolves when the port opens", async () => {
    const port = 19_876;
    expect(await canConnect(port)).toBe(false);

    const waitPromise = waitForPortListening(port, 5_000);
    server = net.createServer();
    await new Promise<void>((resolve) => server!.listen(port, "127.0.0.1", resolve));

    expect(await waitPromise).toBe(true);
  });
});
