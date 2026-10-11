import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const runtime = vi.hoisted(() => ({ openStream: vi.fn(), stop: vi.fn(async () => undefined), rejectTransfer: vi.fn(), transferId: "c9c00000-0000-4000-8000-000000000002" }));
vi.mock("@/lib/browser/access", () => ({ browserHumanRequest: () => undefined, browserError: () => new Response(null, { status: 409 }) }));
vi.mock("@/lib/browser/runtime", () => ({ currentBrowser: () => ({ surface: { openStream: runtime.openStream, rejectTransfer: runtime.rejectTransfer }, view: { transfer: { id: runtime.transferId } } }), browserStatus: () => ({}) }));
import { POST } from "./route";

function request(signal?: AbortSignal) {
  return new NextRequest("http://localhost/api/browser/surface", { method: "POST", signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "stream", sessionId: "c9c00000-0000-4000-8000-000000000001" }) });
}
describe("live stream delivery", () => {
  beforeEach(() => vi.clearAllMocks());
  it("does not let a delayed rejection cancel a newer file request", async () => {
    const reject = (transferId: string) => POST(new NextRequest("http://localhost/api/browser/surface", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reject-transfer", sessionId: "c9c00000-0000-4000-8000-000000000001", transferId }),
    }));
    expect((await reject("c9c00000-0000-4000-8000-000000000003")).status).toBe(409);
    expect(runtime.rejectTransfer).not.toHaveBeenCalled();
    expect((await reject(runtime.transferId)).status).toBe(200);
    expect(runtime.rejectTransfer).toHaveBeenCalledOnce();
  });
  it("delivers the final static frame after backpressure without queuing old frames or heartbeats", async () => {
    runtime.openStream.mockImplementation(async (send: (event: string, data: unknown) => boolean) => {
      send("ready", { id: "stream" });
      for (let index = 0; index < 100; index++) { send("frame", { data: "frame-" + index }); send("heartbeat", {}); }
      return runtime.stop;
    });
    const response = await POST(request());
    const reader = response.body!.getReader(), decoder = new TextDecoder();
    expect(decoder.decode((await reader.read()).value)).toContain("event: ready");
    expect(decoder.decode((await reader.read()).value)).toContain('"data":"frame-99"');
    await reader.cancel();
    expect(runtime.stop).toHaveBeenCalledOnce();
  });
  it("closes a stream disconnected while Chrome is still connecting", async () => {
    let finish: (stop: () => Promise<void>) => void = () => undefined;
    runtime.openStream.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const controller = new AbortController();
    const response = await POST(request(controller.signal));
    controller.abort(); finish(runtime.stop);
    expect((await response.body!.getReader().read()).done).toBe(true);
    await vi.waitFor(() => expect(runtime.stop).toHaveBeenCalledOnce());
  });
});
