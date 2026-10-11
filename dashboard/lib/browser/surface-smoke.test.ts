import { randomUUID } from "node:crypto";
import { chromium } from "playwright-core";
import { it, expect, vi } from "vitest";
import { BrowserSurface } from "./surface";
import { BrowserLease } from "./lease";
import type { ManagedBrowser } from "./runtime";

it.skipIf(process.env.DEVHUB_BROWSER_SURFACE_SMOKE !== "1")("drives the real Chromium stream, input, popup and upload surface", async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const session: ManagedBrowser = {
    browser, context, page, controller: new AbortController(), done: Promise.resolve(), dir: "",
    view: { id: randomUUID(), taskId: "fixture", runId: "fixture", profile: "fixture", persistent: false, mode: "human", origins: ["https://example.com"], ready: true },
    lease: new BrowserLease(), handles: new Map(), signatures: new Map(),
  };
  const surface = new BrowserSurface(session);
  try {
    await surface.initialise();
    await context.route("https://example.com/**", (route) => route.fulfill({ contentType: "text/html", body: '<html><body><input aria-label="Message"><input type="file"><button onclick="window.open(\'/popup\')">Popup</button><div style="height:3000px">Scroll fixture</div></body></html>' }));
    await page.goto("https://example.com/fixture");
    let streamId = "", frames = 0;
    await surface.openStream((event, data) => { if (event === "ready") streamId = (data as { id: string }).id; if (event === "frame") frames++; return true; });
    await vi.waitFor(() => expect(frames).toBeGreaterThan(0), { timeout: 5000 });
    await surface.input(streamId, { kind: "resize", width: 800, height: 500, dpr: 2 });
    expect(await page.evaluate(() => [innerWidth, innerHeight, devicePixelRatio])).toEqual([800, 500, 2]);
    await surface.input(streamId, { kind: "click", x: 60, y: 18, button: "left", count: 1 });
    await surface.input(streamId, { kind: "text", text: "日本語 café 🦊" });
    expect(await page.locator('input[aria-label="Message"]').inputValue()).toBe("日本語 café 🦊");
    await surface.input(streamId, { kind: "scroll", x: 400, y: 250, deltaX: 0, deltaY: 400 });
    await vi.waitFor(async () => expect(await page.evaluate(() => scrollY)).toBeGreaterThan(0));
    await page.locator('input[type="file"]').click();
    await vi.waitFor(() => expect(session.view.transfer?.kind).toBe("upload"));
    await surface.upload(session.view.transfer!.id, { name: "fixture.txt", mimeType: "text/plain", buffer: Buffer.from("approved upload") });
    expect(await page.locator('input[type="file"]').evaluate((node) => (node as HTMLInputElement).files?.[0]?.name)).toBe("fixture.txt");
    await page.getByText("Popup", { exact: true }).click();
    await vi.waitFor(() => expect(session.view.tabs).toHaveLength(2));
    const popup = session.view.tabs!.find((tab) => tab.id !== session.view.activeTab)!;
    await surface.selectTab(popup.id);
    expect(session.page.url()).toContain("/popup");
    await expect(surface.input(streamId, { kind: "text", text: "stale" })).rejects.toThrow("live view changed");
    await surface.selectTab(popup.id, true);
    expect(session.view.tabs).toHaveLength(1);
  } finally { await surface.dispose(); await browser.close(); }
}, 30_000);
