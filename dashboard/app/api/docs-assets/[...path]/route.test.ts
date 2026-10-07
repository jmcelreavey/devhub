import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const docsDir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-assets-"));
vi.mock("@/lib/content/dirs", () => ({ getDocsDir: () => docsDir }));

const { GET } = await import("./route");

function get(rel: string, range?: string) {
  const req = new NextRequest(`http://localhost/api/docs-assets/${rel}`, {
    headers: range ? { range } : {},
  });
  return GET(req, { params: Promise.resolve({ path: rel.split("/") }) });
}

describe("GET /api/docs-assets", () => {
  beforeAll(() => {
    fs.mkdirSync(path.join(docsDir, "assets"), { recursive: true });
    fs.writeFileSync(path.join(docsDir, "assets", "clip.mp4"), Buffer.from("0123456789"));
  });
  afterAll(() => fs.rmSync(docsDir, { recursive: true, force: true }));

  it("serves the whole file and advertises ranges", async () => {
    const res = await get("assets/clip.mp4");
    expect(res.status).toBe(200);
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(await res.text()).toBe("0123456789");
  });

  it("serves a byte range with 206, as WebKit video playback requires", async () => {
    const res = await get("assets/clip.mp4", "bytes=2-5");
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(await res.text()).toBe("2345");
  });

  it("handles open-ended and suffix ranges", async () => {
    expect(await (await get("assets/clip.mp4", "bytes=7-")).text()).toBe("789");
    expect(await (await get("assets/clip.mp4", "bytes=-3")).text()).toBe("789");
  });

  it("falls back to the whole file for an unsatisfiable range", async () => {
    const res = await get("assets/clip.mp4", "bytes=50-60");
    expect(res.status).toBe(200);
  });

  it("refuses paths outside the docs dir", async () => {
    const res = await get("../secret.mp4");
    expect(res.status).toBe(404);
  });
});
