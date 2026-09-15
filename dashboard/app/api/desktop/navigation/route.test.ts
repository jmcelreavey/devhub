import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { subscribeToDesktopNavigation } from "@/lib/desktop/navigation";
import { GET, POST } from "./route";

const cleanups: Array<() => void> = [];

function request(body: unknown, origin = "http://test"): NextRequest {
  return new NextRequest("http://test/api/desktop/navigation", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", Host: "test", Origin: origin },
  });
}

function streamRequest(signal: AbortSignal): NextRequest {
  return new NextRequest("http://test/api/desktop/navigation", {
    headers: { Host: "test", Origin: "http://test" },
    signal,
  });
}

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
});

describe("POST /api/desktop/navigation", () => {
  it("publishes navigation to the connected desktop", async () => {
    const listener = vi.fn();
    cleanups.push(subscribeToDesktopNavigation(listener));
    const navigation = { href: "/notes/discovery/example", newTab: true } as const;

    const response = await POST(request(navigation));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ delivered: 1 });
    expect(listener).toHaveBeenCalledWith(navigation);
  });

  it("reports when no desktop app is connected", async () => {
    const response = await POST(request({ href: "/notes/example", newTab: true }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "The DevHub desktop app is not connected." });
  });

  it("rejects external navigation", async () => {
    const response = await POST(request({ href: "https://example.com", newTab: true }));
    expect(response.status).toBe(400);
  });

  it("requires an authenticated local caller", async () => {
    const response = await POST(request({ href: "/notes/example", newTab: true }, "https://example.com"));
    expect(response.status).toBe(403);
  });
});

describe("GET /api/desktop/navigation", () => {
  it("streams published navigation to a connected desktop", async () => {
    const abortController = new AbortController();
    const response = await GET(streamRequest(abortController.signal));
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    if (!reader) throw new Error("Expected the desktop navigation stream to have a body.");

    const decoder = new TextDecoder();
    const connected = await reader.read();
    expect(decoder.decode(connected.value)).toBe(": connected\n\n");

    const navigation = { href: "/notes/discovery/example", newTab: true } as const;
    const publishResponse = await POST(request(navigation));
    expect(publishResponse.status).toBe(200);

    const published = await reader.read();
    expect(decoder.decode(published.value)).toBe(`data: ${JSON.stringify(navigation)}\n\n`);

    await reader.cancel();
    abortController.abort();
  });
});
