import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const publish = vi.hoisted(() => vi.fn(() => 1));
vi.mock("@/lib/desktop/navigation", () => ({ publishDesktopNavigation: publish, subscribeToDesktopNavigation: vi.fn() }));
import { POST } from "./route";
beforeEach(() => publish.mockClear());
function request(headers: Record<string, string>) {
  return new NextRequest("http://localhost:1342/api/desktop/navigation", { method: "POST", headers: { host: "localhost:1342", origin: "http://localhost:1342", "content-type": "application/json", ...headers }, body: JSON.stringify({ href: "/notes/result", newTab: true }) });
}
describe("navigation ownership", () => {
  it("returns a link without publishing when an agent asks to open a note", async () => {
    const response = await POST(request({ "x-devhub-client": "mcp" }));
    expect(await response.json()).toMatchObject({ suppressed: true, delivered: 0, href: "/notes/result" });
    expect(publish).not.toHaveBeenCalled();
  });
  it("keeps explicit browser navigation working", async () => {
    expect((await POST(request({ "sec-fetch-site": "same-origin" }))).status).toBe(200);
    expect(publish).toHaveBeenCalledOnce();
  });
});
