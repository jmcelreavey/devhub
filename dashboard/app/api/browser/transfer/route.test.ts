import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  upload: vi.fn(async () => undefined),
  transferId: "c9c00000-0000-4000-8000-000000000002",
}));
vi.mock("@/lib/browser/access", () => ({
  browserHumanRequest: () => undefined,
  browserError: () => new Response(null, { status: 409 }),
}));
vi.mock("@/lib/browser/runtime", () => ({
  currentBrowser: () => ({
    surface: { upload: runtime.upload },
    view: { transfer: { id: runtime.transferId, kind: "upload" } },
  }),
}));
import { POST } from "./route";

beforeEach(() => vi.clearAllMocks());

it.each(["image/png", "application/pdf", undefined])("preserves upload type %s with an opaque-binary fallback", async (mimeType) => {
  const headers: Record<string, string> = { "x-file-name": encodeURIComponent("fixture.png") };
  if (mimeType) headers["content-type"] = mimeType;
  const bytes = new Uint8Array([1, 2, 3]);
  const response = await POST(new NextRequest(
    "http://localhost/api/browser/transfer?session=c9c00000-0000-4000-8000-000000000001&transfer=" + runtime.transferId,
    { method: "POST", headers, body: bytes },
  ));
  expect(response.status).toBe(200);
  expect(runtime.upload).toHaveBeenCalledWith(runtime.transferId, {
    name: "fixture.png", mimeType: mimeType ?? "application/octet-stream", buffer: Buffer.from(bytes),
  });
});

it("rejects malformed file types before passing bytes to Chrome", async () => {
  const response = await POST(new NextRequest(
    "http://localhost/api/browser/transfer?session=c9c00000-0000-4000-8000-000000000001&transfer=" + runtime.transferId,
    { method: "POST", headers: { "x-file-name": "fixture.png", "content-type": "not a MIME type" }, body: new Uint8Array([1]) },
  ));
  expect(response.status).toBe(409);
  expect(runtime.upload).not.toHaveBeenCalled();
});
