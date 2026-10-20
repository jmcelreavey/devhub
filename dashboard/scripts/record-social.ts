#!/usr/bin/env tsx
/**
 * npm run demos:record -- social
 * Real DevHub UI, synthetic provider responses, one disposable fixture.
 * Shares the walkthrough CDP recorder, cursor, theme and hydration helpers.
 * DEMO_SOCIAL_EXPORT=1 removes this recorder's fixture label for social delivery only.
 * Existing walkthroughs and docs/assets/demos/overview.gif are never written here.
 */
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { chromium, expect as playwrightExpect, type Locator, type Page } from "@playwright/test";
import { clickOn, hydrated, MAC_USER_AGENT, OVERLAY_SCRIPT, startScreencast, THEME_PIN_SCRIPT } from "./demo-kit";
import { execExternal } from "../lib/exec-external";
import { assertSocialFixture, socialStubs, SOCIAL_TASK, SOCIAL_TITLE } from "./social-fixtures";
import { exportSocial, type Camera, type SocialShot } from "./social-export";

const expect = playwrightExpect.configure({ timeout: 60_000 });
const SIZE = { width: 1280, height: 900 };
const { origin, fixture } = assertSocialFixture();
const WORK = path.join(fixture, "social-frames");
const OUT = path.resolve(__dirname, "../../docs/assets/demos/social");
const OVERVIEW = path.resolve(OUT, "../overview.gif");
const shots: SocialShot[] = [];
const beat = (page: Page, ms: number) => page.waitForTimeout(ms);

async function centre(target: Locator, width = 650): Promise<Camera> {
  const box = await target.boundingBox();
  if (!box) throw new Error("No camera target: " + target);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, width };
}

/** Timed moves avoid Playwright's instant, event-count-only cursor jumps. */
async function glide(page: Page, target: Locator) {
  const camera = await centre(target);
  const start = await page.evaluate(() => JSON.parse(sessionStorage.getItem("demo-cursor") || '{"x":640,"y":400}') as { x: number; y: number });
  for (let i = 1; i <= 24; i++) {
    const t = i / 24;
    const eased = t * t * (3 - 2 * t);
    await page.mouse.move(start.x + (camera.x - start.x) * eased, start.y + (camera.y - start.y) * eased);
    await beat(page, 16);
  }
}

async function shot(page: Page, name: string, caption: string, seconds: number,
  from: Camera, to: Camera, action?: () => Promise<void>) {
  const stop = await startScreencast(page, SIZE);
  await beat(page, 150);
  if (action) await action();
  await beat(page, Math.max(1000, seconds * 1000 - 900));
  const capture = await stop();
  await page.screenshot({ path: path.join(WORK, name + ".png") });
  shots.push({ name, caption, seconds, from, to, ...capture });
  console.log("Captured " + name);
}

async function seedDiff() {
  const repo = path.join(fixture, "repos/payments-api");
  const file = path.join(repo, "src/webhooks.ts");
  const original = "export async function acceptWebhook(event: PaymentEvent) {\n  return receipts.create(event);\n}\n";
  const edited = "export async function acceptWebhook(event: PaymentEvent) {\n  const existing = await receipts.find(event.id);\n  if (existing) return existing;\n  return receipts.create(event);\n}\n";
  // Seed once. Reruns restore only our two synthetic files, never reset the fixture repo.
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, original);
    await execExternal("git", ["add", "src/webhooks.ts"], { cwd: repo });
    await execExternal("git", ["-c", "user.name=Demo", "-c", "user.email=demo@example.invalid",
      "commit", "-m", "chore: seed webhook recording example"], { cwd: repo });
  }
  fs.writeFileSync(file, edited);
  fs.writeFileSync(path.join(repo, "src/webhooks.test.ts"),
    'it("returns the existing receipt for a duplicate event", async () => {\n  const first = await acceptWebhook(event);\n  expect(await acceptWebhook(event)).toEqual(first);\n});\n');
}

async function main() {
  fs.mkdirSync(WORK, { recursive: true });
  // Prove the loopback server is serving this exact disposable tree before visiting it.
  const token = randomUUID();
  const marker = path.join(fixture, "devhub/dashboard/public/social-recording-token.txt");
  fs.writeFileSync(marker, token);
  try {
    const response = await fetch(new URL("/social-recording-token.txt", origin), { signal: AbortSignal.timeout(15_000) });
    if (!response.ok || (await response.text()) !== token) throw new Error("DEMO_URL does not serve this fixture");
  } finally {
    fs.unlinkSync(marker);
  }
  const overviewBefore = fs.readFileSync(OVERVIEW);
  await seedDiff();
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: SIZE, deviceScaleFactor: 1, colorScheme: "dark", userAgent: MAC_USER_AGENT, serviceWorkers: "block" });
  await context.addInitScript(THEME_PIN_SCRIPT);
  await context.addInitScript(OVERLAY_SCRIPT);
  await context.addInitScript(({ clean }) => {
    // A supported Today layout preference keeps the ticket in view while other cards load.
    const layout = ["jira", "main", "briefing", "calendar", "welcome", "github", "datadog"]
      .map((i, n) => ({ i, x: 0, y: n * 20, w: 12, h: i === "jira" ? 8 : 12 }));
    localStorage.setItem("devhub-today-grid-layouts-v10",
      JSON.stringify({ lg: layout, md: layout, sm: layout, xs: layout }));
    localStorage.setItem("devhub:pwa-dismissed", "1");
    localStorage.setItem("devhub:pwa-status-browser-hint-dismissed", "1");
    addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = "#demo-caption,[role=region][aria-label=Notifications]{display:none!important}#demo-cursor{width:15px;height:15px;margin:-7px;background:#fff;box-shadow:0 0 0 2px #111416,0 0 0 4px #9ed84a55}";
      document.head.append(style);
      if (!clean) {
        const label = document.createElement("div");
        label.textContent = "FIXTURE DATA / SIMULATED PROVIDERS";
        label.style.cssText = "position:fixed;bottom:8px;right:8px;z-index:2147483647;background:#111416;color:white;padding:8px;font:12px sans-serif";
        document.body.append(label);
      }
    });
  }, { clean: process.env.DEMO_SOCIAL_EXPORT === "1" });
  const state = await socialStubs(context);
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  const go = async (route: string) => {
    await page.goto(new URL(route, origin).href);
    await hydrated(page);
  };
  try {
    // Warm routes before starting any clock; compilation never becomes part of the film.
    for (const route of ["/", "/workflow?taskId=" + SOCIAL_TASK, "/repos/payments-api/git"]) await go(route);
    await go("/");
    await expect(page.getByText(SOCIAL_TITLE).first()).toBeVisible();
    await expect(page.getByText("Review search rewrite plan").first()).toBeVisible();
    await expect(page.getByText("Warming up the workbench…", { exact: true })).toBeHidden();
    await beat(page, 1500);
    const tickets = page.locator('[data-today-grid-slot="jira"]');
    await tickets.scrollIntoViewIfNeeded();
    await beat(page, 800);
    const ticket = tickets.getByRole("listitem").filter({ hasText: SOCIAL_TITLE });
    const ticketBox = await tickets.boundingBox();
    if (!ticketBox) throw new Error("My Tickets is not visible");
    const ticketCamera = { x: ticketBox.x + 310, y: ticketBox.y + 95, width: 650 };
    await shot(page, "ticket", "Start with a Jira ticket", 2, { ...ticketCamera, width: 850 }, ticketCamera,
      async () => { await glide(page, ticket); });
    await glide(page, ticket);
    await ticket.click({ button: "right" });
    const implement = page.getByRole("menuitem", { name: /Implement with Agent/ });
    await expect(implement).toBeVisible();
    const menuCamera = await centre(implement, 620);
    await shot(page, "implement", "Implement with an agent", 2, menuCamera, { ...menuCamera, width: 540 },
      async () => { await glide(page, implement); });
    await clickOn(page, implement);
    const dialog = page.getByRole("dialog", { name: "Implement with agent", exact: true });
    await expect(dialog.getByText("Ready to implement")).toBeVisible();
    const start = dialog.getByRole("button", { name: "Start chat", exact: true });
    await start.scrollIntoViewIfNeeded();
    const launchCamera = { ...(await centre(start, 700)), x: 640, y: 720 };
    await shot(page, "launch", "Implement with an agent", 2, { ...launchCamera, y: 400 }, launchCamera,
      async () => { await glide(page, start); await clickOn(page, start); });

    for (let i = 0; i < 3; i++) {
      state.progress();
      await go("/workflow?taskId=" + SOCIAL_TASK);
      const updates = page.locator("section").filter({ has: page.getByRole("heading", { name: "Updates", exact: true }) });
      await expect(updates.getByText(/Reading DEMO-142/)).toBeVisible();
      await updates.scrollIntoViewIfNeeded();
      const workCamera = await centre(updates.locator("li").first(), 460);
      await shot(page, "working-" + i, "The agent does the work", 2, workCamera, { ...workCamera, width: 440 },
        async () => { await glide(page, updates.getByRole("heading")); });
    }
    state.review();
    await go("/repos/payments-api/git");
    await clickOn(page, page.getByRole("tab", { name: /Changes/ }));
    const file = page.locator(".repo-git-file-main:visible").filter({ hasText: "src/webhooks.ts" }).first();
    await expect(file).toBeVisible();
    await clickOn(page, file);
    const added = page.getByText("const existing = await receipts.find(event.id);", { exact: false }).filter({ visible: true }).first();
    await expect(added).toBeVisible();
    const diffCamera = await centre(added, 700);
    await shot(page, "diff", "Review the finished diff", 4, { ...diffCamera, width: 790 }, { ...diffCamera, width: 660 },
      async () => { await glide(page, added); });
    await go("/workflow?taskId=" + SOCIAL_TASK);
    const checks = page.getByText("Checks passed", { exact: true }).filter({ visible: true });
    await expect(checks).toBeVisible();
    const checkCamera = await centre(checks.locator(".."), 680);
    await shot(page, "checks", "Checks pass. You decide.", 2, checkCamera, checkCamera,
      async () => { await glide(page, checks); });
    const approve = page.getByRole("button", { name: "Approve this proposal" });
    await approve.scrollIntoViewIfNeeded();
    const approval = { ...(await centre(approve, 680)), x: 576 };
    await shot(page, "approve", "Approve the draft PR", 4, { ...approval, y: approval.y - 60 }, approval,
      async () => { await beat(page, 650); await glide(page, approve); await clickOn(page, approve); });
    const result = page.getByText("Draft PR #142 created · DEMO-142 linked", { exact: true }).filter({ visible: true });
    await expect(result).toBeVisible();
    await result.scrollIntoViewIfNeeded();
    const resultCamera = await centre(result, 440);
    await shot(page, "draft-pr", "Draft PR created", 3, { ...resultCamera, width: 480 }, resultCamera,
      async () => { await glide(page, result); });
    state.assert();
    // Open on the payoff, then return to the beginning of the same workflow.
    const diff = shots.find(s => s.name === "diff")!;
    const hook: SocialShot = { ...diff, name: "hook", caption: "From ticket to draft PR", seconds: 3,
      from: { ...diff.to, width: 720 }, to: { ...diff.to, width: 610 }, frames: [...diff.frames] };
    shots.unshift(hook);
    fs.writeFileSync(path.join(WORK, "edit.json"), JSON.stringify(shots.map(({ frames, ...s }) => ({ ...s, frameCount: frames.length })), null, 2));
    await exportSocial(shots, OUT, WORK);
    if (!overviewBefore.equals(fs.readFileSync(OVERVIEW))) throw new Error("README overview changed");
    console.log("Exported 28 seconds, both aspect ratios and GIF; README overview unchanged.");
  } catch (error) {
    await page.screenshot({ path: path.join(WORK, "failure.png") });
    console.error(await page.locator("body").innerText());
    throw error;
  } finally {
    await browser.close();
  }
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
