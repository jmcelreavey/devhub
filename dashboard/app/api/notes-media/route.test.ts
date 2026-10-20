import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "./[name]/route";
import { POST } from "./route";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("x")]);
const ORIGIN = "http://127.0.0.1:1348";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "notes-media-route-"));
  process.env.DEVHUB_NOTE_MEDIA_DIR = dir;
  delete process.env.DEVHUB_API_SECRET;
});
afterEach(() => {
  delete process.env.DEVHUB_NOTE_MEDIA_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

function upload(bytes: Buffer, name = "shot.png", type = "image/png") {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(bytes)], name, { type }));
  return new NextRequest(`${ORIGIN}/api/notes-media`, {
    method: "POST",
    body: form,
    headers: { origin: ORIGIN, host: "127.0.0.1:1348" },
  });
}

const get = (name: string) =>
  GET(new NextRequest(`${ORIGIN}/api/notes-media/${name}`), { params: Promise.resolve({ name }) });

describe("/api/notes-media", () => {
  it("stores an upload outside the vault and serves it back with nosniff", async () => {
    const res = await POST(upload(PNG));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { url: string; name: string };
    expect(body.url).toBe(`/api/notes-media/${body.name}`);
    expect(fs.existsSync(path.join(dir, body.name))).toBe(true);

    const served = await get(body.name);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
    expect(served.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await served.arrayBuffer()).equals(PNG)).toBe(true);
  });

  it("returns 200 for a duplicate upload", async () => {
    await POST(upload(PNG));
    expect((await POST(upload(PNG))).status).toBe(200);
  });

  it("rejects SVG bytes even when labelled image/png", async () => {
    const res = await POST(upload(Buffer.from("<svg onload=alert(1)/>"), "x.png", "image/png"));
    expect(res.status).toBe(400);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("rejects oversized images", async () => {
    const res = await POST(upload(Buffer.concat([PNG, Buffer.alloc(8_000_000)])));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/8 MB max/);
  });

  it("requires same-origin auth", async () => {
    const form = new FormData();
    form.append("file", new File([new Uint8Array(PNG)], "a.png", { type: "image/png" }));
    const res = await POST(new NextRequest(`${ORIGIN}/api/notes-media`, { method: "POST", body: form }));
    expect(res.status).toBe(403);
  });

  it("404s on traversal, bad names and missing blobs", async () => {
    for (const name of ["..%2Fsecret.png", "../x.png", "evil.svg", `${"a".repeat(64)}.png`]) {
      expect((await get(name)).status, name).toBe(404);
    }
  });
});
