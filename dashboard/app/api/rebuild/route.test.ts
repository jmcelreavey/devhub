import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadRebuildOffer, startCheckoutRebuild } from "@/lib/desktop/checkout-rebuild";
import { POST } from "./route";

vi.mock("@/lib/desktop/checkout-rebuild", () => ({
  loadRebuildOffer: vi.fn(),
  startCheckoutRebuild: vi.fn(),
}));

function request(body: string) {
  return new Request("http://127.0.0.1:1337/api/rebuild", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(loadRebuildOffer).mockResolvedValue({ available: true, mode: "service" } as never);
  vi.mocked(startCheckoutRebuild).mockResolvedValue({ ok: true, launcher: "detached" });
});

describe("POST /api/rebuild", () => {
  it("starts a pull and rebuild when asked to pull", async () => {
    const res = await POST(request(JSON.stringify({ pull: true })));
    expect(res.status).toBe(200);
    expect(startCheckoutRebuild).toHaveBeenCalledWith(expect.objectContaining({ mode: "service" }), true);
    expect((await res.json()).message).toMatch(/^Pull and rebuild started/);
  });

  it("rebuilds without pulling when pull is omitted", async () => {
    const res = await POST(request("{}"));
    expect(startCheckoutRebuild).toHaveBeenCalledWith(expect.anything(), false);
    expect((await res.json()).message).toMatch(/^Rebuild started/);
  });

  it.each(["service", "payload"])("describes an explicit no-pull rebuild in %s mode", async (mode) => {
    vi.mocked(loadRebuildOffer).mockResolvedValue({ available: true, mode } as never);
    const res = await POST(request(JSON.stringify({ pull: false })));
    expect(startCheckoutRebuild).toHaveBeenCalledWith(expect.anything(), false);
    expect((await res.json()).message).toMatch(/^Rebuild started/);
  });

  it("rejects anything but { pull?: boolean } and never starts a rebuild", async () => {
    for (const body of [JSON.stringify({ pull: "yes" }), JSON.stringify({ pull: true, checkout: "/tmp/elsewhere" }), "not json"]) {
      const res = await POST(request(body));
      expect(res.status).toBe(400);
    }
    expect(startCheckoutRebuild).not.toHaveBeenCalled();
  });

  it("passes a refusal through with its status", async () => {
    vi.mocked(startCheckoutRebuild).mockResolvedValue({ ok: false, status: 409, error: "A rebuild is already running." });
    const res = await POST(request(JSON.stringify({ pull: true })));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      ok: false,
      started: false,
      reason: "A rebuild is already running.",
      error: "A rebuild is already running.",
    });
  });
});
