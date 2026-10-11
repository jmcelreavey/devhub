import fs from "node:fs/promises";
import path from "node:path";
import { chromium, expect, type Page } from "@playwright/test";
import { clickOn, encodeGif, hydrated, MAC_USER_AGENT, OVERLAY_SCRIPT, requiredEnv, setCaption, startScreencast, THEME_PIN_SCRIPT, VIEWPORT } from "./demo-kit";
import { browserStubs, editorStubs, integrationStubs, telegramStubs } from "./record-new-features";

const baseUrl = requiredEnv("DEMO_URL");
const output = requiredEnv("DEMO_OUT");
const framesDirectory = requiredEnv("DEMO_FRAMES_DIR");
const selection = "a2d11234-2222-4222-8222-222222222222";

async function pause(page: Page, milliseconds = 1500): Promise<void> {
  await page.waitForTimeout(milliseconds);
}
async function capture(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(framesDirectory, `overview-${name}.png`) });
}
async function navigate(page: Page, route: string): Promise<void> {
  await page.goto(new URL(route, baseUrl).toString());
  await hydrated(page);
}

async function main(): Promise<void> {
  const origin = new URL(baseUrl);
  if (!["127.0.0.1", "localhost"].includes(origin.hostname) || ["1337", "1339"].includes(origin.port)) throw new Error("Only a disposable loopback fixture can be recorded");
  await fs.mkdir(framesDirectory, { recursive: true });
  await fs.mkdir(path.dirname(output), { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: VIEWPORT, colorScheme: "dark", userAgent: MAC_USER_AGENT });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  try {
    await context.addInitScript(THEME_PIN_SCRIPT);
    await context.addInitScript(OVERLAY_SCRIPT);
    await context.route("**/api/status/lan", (route) => route.fulfill({ json: { addresses: [] } }));
    await integrationStubs(context);
    await browserStubs(context);
    await editorStubs(context);
    await context.route("**/api/release-notes", (route) => route.fulfill({ json: {
      currentVersion: "2.1.0", releases: [{ version: "2.1.0", date: "2026-10-11", markdown: "### Added\n\n- Theme effects and a soft cursor follower.\n- Managed task browser with explicit approvals.\n- Reviewed integration proposals and opt-in Telegram tests.\n- Editor selection discussions and durable task reviews.\n\n### Fixed\n\n- Resize cards from every edge and corner.\n- Dismiss What's new until the next version.", highlights: [] }],
    } }));
    for (const route of ["/browser", "/integrations", `/editor?workspace=payments-api&selection=${selection}`, "/"]) await navigate(page, route);
    await expect(page.getByText("Review search rewrite plan").first()).toBeVisible();
    await setCaption(page, "DevHub 2.1.0 · Graphite Neon (Default) · disposable demo data");
    const stop = await startScreencast(page, VIEWPORT);
    await page.mouse.move(420, 180, { steps: 25 });
    await page.mouse.move(680, 230, { steps: 30 });
    await pause(page, 2500);
    await clickOn(page, page.getByRole("button", { name: /appearance/i }).first());
    await clickOn(page, page.getByRole("button", { name: "Theme effects", exact: true }));
    await setCaption(page, "One effects tab · live previews · cursor follower");
    await clickOn(page, page.getByRole("button", { name: "Try task done", exact: true }));
    await pause(page, 3500);
    await capture(page, "effects");
    await page.keyboard.press("Escape");
    await clickOn(page, page.getByRole("button", { name: "What's new", exact: true }).first());
    await expect(page.getByRole("dialog", { name: "What's new in v2.1.0" })).toBeVisible();
    await setCaption(page, "What's new after an update · dismiss it for this version");
    await pause(page, 3500);
    await capture(page, "whats-new");
    await clickOn(page, page.getByRole("button", { name: "Done", exact: true }));
    await navigate(page, "/browser");
    await expect(page.getByAltText("Live page in the task browser")).toBeVisible();
    await page.getByRole("region", { name: "Live browser", exact: true }).scrollIntoViewIfNeeded();
    await setCaption(page, "Task browser · your control · explicit site and file approvals");
    await pause(page, 3500);
    await capture(page, "browser");
    await integrationStubs(context);
    await navigate(page, "/integrations");
    await clickOn(page, page.getByRole("link", { name: "Write actions", exact: true }));
    await page.getByLabel("Project key", { exact: true }).fill("DEMO");
    await page.getByLabel("Title", { exact: true }).fill("Add webhook idempotency");
    await page.getByLabel("Description", { exact: true }).fill("Reject duplicate payment events before writing another receipt.");
    await clickOn(page, page.getByRole("button", { name: "Review action…", exact: true }));
    const review = page.getByRole("dialog", { name: "Review this action" });
    await expect(review).toBeVisible();
    await setCaption(page, "Review the exact account, destination and content · no provider write");
    await pause(page, 3500);
    await capture(page, "proposal");
    await clickOn(page, review.getByRole("button", { name: "Cancel action" }));
    await telegramStubs(context);
    await navigate(page, "/integrations");
    const alerts = page.locator("#alerts");
    await clickOn(page, alerts.getByText("Enable a destination", { exact: true }));
    await alerts.getByRole("combobox", { name: /^Channel/ }).selectOption("telegram");
    await alerts.getByLabel("Destination label").fill("Demo work phone");
    await alerts.getByLabel("Bot token variable name").fill("DEVHUB_TELEGRAM_TOKEN");
    await alerts.getByLabel("Telegram chat ID", { exact: false }).fill("123456");
    await alerts.getByLabel(/I approve these event templates/).check();
    await clickOn(page, alerts.getByRole("button", { name: "Enable alerts", exact: true }));
    await clickOn(page, alerts.getByRole("button", { name: "Send test message" }));
    await expect(alerts.getByRole("status")).toContainText("Test message sent to Demo work phone");
    await alerts.getByRole("status").scrollIntoViewIfNeeded();
    await setCaption(page, "Telegram · one explicit test send · provider acceptance is simulated");
    await pause(page, 3800);
    await capture(page, "telegram");
    await editorStubs(context);
    await navigate(page, `/editor?workspace=payments-api&selection=${selection}`);
    const discussion = page.getByRole("dialog", { name: "Ask AI about selection" });
    await expect(discussion).toBeVisible();
    await discussion.getByLabel("Your question").fill("Where could two deliveries race, and how would you test that?");
    await discussion.evaluate((panel) => {
      const caption = document.getElementById("demo-caption");
      const cursor = document.getElementById("demo-cursor");
      if (!caption || !cursor) throw new Error("Missing recording overlay");
      panel.append(caption, cursor);
      Object.assign(caption.style, { position: "absolute", left: "24px", right: "24px", top: "106px", bottom: "auto", whiteSpace: "normal", fontSize: "14px", transform: "none" });
    });
    await setCaption(page, "Editor Ask AI · captured lines and a question · no AI dispatch");
    await pause(page, 3500);
    await capture(page, "editor");
    await page.evaluate(() => {
      const caption = document.getElementById("demo-caption");
      const cursor = document.getElementById("demo-cursor");
      if (!caption || !cursor) throw new Error("Missing recording overlay");
      caption.removeAttribute("style");
      document.body.append(caption, cursor);
    });
    await clickOn(page, discussion.getByRole("button", { name: "Cancel", exact: true }));
    await navigate(page, "/");
    await clickOn(page, page.getByRole("button", { name: "Collapse sidebar", exact: true }));
    await pause(page, 600);
    await page.evaluate(() => window.scrollTo(0, 0));
    const card = page.locator('[data-today-grid-slot="calendar"]').first();
    await expect(card).toBeInViewport();
    const resizeHandle = card.locator('[data-resize-axis="sw"]').first();
    await resizeHandle.hover();
    const previousBounds = await card.boundingBox();
    if (!previousBounds) throw new Error("Missing visible card bounds");
    const handle = await resizeHandle.boundingBox();
    if (!handle) throw new Error("Missing card resize handle");
    await setCaption(page, "Resize cards and floating panels from every edge and corner");
    await page.mouse.down();
    await expect(page.locator("body")).toHaveAttribute("data-grid-resizing", "true");
    await page.mouse.move(handle.x + handle.width / 2 - 80, handle.y + handle.height / 2 + 120, { steps: 30 });
    await page.mouse.up();
    await expect.poll(async () => (await card.boundingBox())?.height ?? 0).toBeGreaterThan(previousBounds.height + 40);
    await pause(page, 3800);
    await capture(page, "resize");
    await setCaption(page, "DevHub 2.1.0 · one workspace, with you in control");
    await pause(page, 2500);
    const { frames, stoppedAt } = await stop();
    const count = await encodeGif(frames, stoppedAt, output);
    console.log(`Overview: ${count} GIF frames → ${output}`);
  } catch (error) {
    await capture(page, "failure");
    throw error;
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
