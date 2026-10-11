import http from "node:http";
import net from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserProxy, type BrowserProxy } from "./network";
import { browserPlatformReason } from "./platform";
import { downloadName, SurfaceInputSchema } from "./surface";

describe("browser network boundary", () => {
  let proxy: BrowserProxy | undefined;
  afterEach(async () => { await proxy?.close(); vi.restoreAllMocks(); });
  it("rejects private pins before listening", async () => {
    await expect(createBrowserProxy(["https://example.com"], [["127.0.0.1"]])).rejects.toThrow("public");
    await expect(createBrowserProxy(["https://example.com"], [["93.184.215.14", "10.0.0.1"]])).rejects.toThrow("public");
  });
  it("refuses local, unknown, alternate-port CONNECTs and plain HTTP without a socket dial", async () => {
    proxy = await createBrowserProxy(["https://example.com"], [["93.184.215.14"]]);
    const connect = vi.spyOn(net, "connect");
    for (const target of ["127.0.0.1:1337", "example.com:80", "example.com:444", "evil.example:443", "example.com:443@127.0.0.1:443"]) {
      const status = await new Promise<number>((resolve, reject) => {
        const request = http.request({ host: "127.0.0.1", port: proxy!.port, method: "CONNECT", path: target });
        request.on("connect", (response, socket) => { socket.destroy(); resolve(response.statusCode!); });
        request.on("error", reject); request.end();
      });
      expect(status).toBe(403);
    }
    expect(connect).not.toHaveBeenCalled();
    const response = await fetch("http://127.0.0.1:" + proxy.port + "/http://example.com");
    expect(response.status).toBe(403);
  });
});
describe("platform and input boundaries", () => {
  it("disables Windows and both WSL markers before launch", () => {
    expect(browserPlatformReason("win32", "", {})).toContain("disabled");
    expect(browserPlatformReason("linux", "microsoft-standard-WSL2", { DISPLAY: ":0" })).toContain("disabled");
    expect(browserPlatformReason("linux", "custom", { DISPLAY: ":0", WSL_INTEROP: "/run/WSL/1" })).toContain("disabled");
    expect(browserPlatformReason("linux", "custom", { DISPLAY: ":0" })).toBeUndefined();
    expect(browserPlatformReason("linux", "custom", { WAYLAND_DISPLAY: "wayland-0" })).toBeUndefined();
    expect(browserPlatformReason("darwin", "", {})).toBeUndefined();
    expect(browserPlatformReason("linux", "", {})).toContain("display");
  });
  it("bounds input and never accepts arbitrary key commands or paths", () => {
    expect(SurfaceInputSchema.safeParse({ kind: "key", key: "Meta+L" }).success).toBe(false);
    expect(SurfaceInputSchema.safeParse({ kind: "resize", width: 99999, height: 500, dpr: 10 }).success).toBe(false);
    expect(downloadName("../../secret\r\n.txt")).toBe("_.._secret__.txt");
  });
});
