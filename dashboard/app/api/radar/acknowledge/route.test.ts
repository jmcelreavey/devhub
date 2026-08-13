import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

let notesDir: string;

vi.mock("@/lib/notes/dir", () => ({
  getNotesDir: () => notesDir,
}));

const { DELETE, GET, POST } = await import("./route");
const { acknowledgementFor, readAcknowledgements } = await import(
  "@/lib/radar/acknowledgements"
);

function request(method: string, body: unknown): NextRequest {
  return new NextRequest("http://test/api/radar/acknowledge", {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  notesDir = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-ack-route-"));
});

afterEach(() => {
  fs.rmSync(notesDir, { recursive: true, force: true });
});

describe("POST /api/radar/acknowledge", () => {
  it("records an acknowledgement at the supplied watermark", async () => {
    const res = await POST(request("POST", { kind: "capability", id: "redis", watermark: 3 }));
    expect(res.status).toBe(200);
    expect(acknowledgementFor(readAcknowledgements(), "capability", "redis")?.watermark).toBe(3);
  });

  it("trusts the client's watermark rather than recomputing it", async () => {
    // The user acknowledges what they were shown. Re-deriving server-side would
    // silently record a different number if a rescan landed between render and
    // click, hiding the row at a level the user never saw.
    await POST(request("POST", { kind: "capability", id: "redis", watermark: 3 }));
    const stored = acknowledgementFor(readAcknowledgements(), "capability", "redis");
    expect(stored?.watermark).toBe(3);
  });

  it("rejects an unknown kind", async () => {
    const res = await POST(request("POST", { kind: "nonsense", id: "x", watermark: 1 }));
    expect(res.status).toBe(400);
  });

  it("rejects an empty id", async () => {
    const res = await POST(request("POST", { kind: "capability", id: "", watermark: 1 }));
    expect(res.status).toBe(400);
  });

  it("rejects a negative watermark", async () => {
    const res = await POST(request("POST", { kind: "capability", id: "x", watermark: -1 }));
    expect(res.status).toBe(400);
  });

  it("returns 400 rather than throwing on a malformed body", async () => {
    const res = await POST(
      new NextRequest("http://test/api/radar/acknowledge", { method: "POST", body: "{ not json" }),
    );
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/radar/acknowledge", () => {
  it("undoes an acknowledgement so a misclick is recoverable", async () => {
    await POST(request("POST", { kind: "capability", id: "redis", watermark: 3 }));
    const res = await DELETE(request("DELETE", { kind: "capability", id: "redis" }));
    expect(res.status).toBe(200);
    expect(acknowledgementFor(readAcknowledgements(), "capability", "redis")).toBeNull();
  });

  it("is a no-op for something never acknowledged", async () => {
    const res = await DELETE(request("DELETE", { kind: "capability", id: "ghost" }));
    expect(res.status).toBe(200);
  });
});

describe("GET /api/radar/acknowledge", () => {
  it("returns the whole store", async () => {
    await POST(request("POST", { kind: "release", id: "left-pad", watermark: 1 }));
    const res = await GET();
    const body = (await res.json()) as { acknowledgements: Record<string, unknown> };
    expect(Object.keys(body.acknowledgements)).toEqual(["release:left-pad"]);
  });
});
