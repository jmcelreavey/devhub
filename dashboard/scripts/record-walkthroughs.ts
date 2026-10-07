#!/usr/bin/env tsx
/**
 * Records the feature walkthrough clips embedded in docs (docs/assets/demos/*.mp4) and the
 * README (docs/assets/demos/*.gif).
 *
 * Run it through `npm run demos:walkthroughs` (scripts/demos/record.sh), which builds the
 * disposable fixture and starts the dashboard against it. Never point DEMO_URL at a
 * dashboard you use: the walks add and complete tasks and edit notes.
 *
 * Each clip is a CDP screencast. The MP4 is resampled to a fixed frame rate and piped to
 * ffmpeg as H.264, so it plays inline in DevHub's docs viewer; the GIF is what GitHub shows
 * in the README. A clip with `mp4: false` is README-only.
 * DEMO_ONLY=today,notes records a subset while working on a walk.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import {
  clickOn,
  encodeGif,
  type Frame,
  hydrated,
  OVERLAY_SCRIPT,
  pointAt,
  requiredEnv,
  setCaption,
  sidebarLink,
  startScreencast,
  VIEWPORT,
} from "./demo-kit";

const BASE_URL = requiredEnv("DEMO_URL");
const OUT_DIR = requiredEnv("DEMO_OUT_DIR");
const FRAMES_DIR = requiredEnv("DEMO_FRAMES_DIR");
const ONLY = (process.env.DEMO_ONLY ?? "").split(",").map((s) => s.trim()).filter(Boolean);

const FPS = 25;

/** localStorage keys PWAInstallPrompt reads; set so its hint never covers a shot. */
const PWA_HINT_KEYS = ["devhub:pwa-dismissed", "devhub:pwa-status-browser-hint-dismissed"] as const;

interface Clip {
  /** Output file stem: docs/assets/demos/<name>.mp4 and <name>.gif */
  name: string;
  /** Set to false for a clip only the README shows, so no MP4 sits unlinked in the docs. */
  mp4?: false;
  /** Set to false for a clip only the docs show, so no GIF sits unlinked. */
  gif?: false;
  /** Stub API responses that would otherwise need a real account or local sign-in. */
  stubs?: (context: BrowserContext) => Promise<void>;
  /** Route the clip opens on. */
  start: string;
  /** Text that proves the start route has rendered its data, not a skeleton. */
  ready: RegExp | string;
  /** Caption shown from the first frame. */
  caption: string;
  /** Other routes the walk visits, warmed first so the clip shows pages, not spinners. */
  warm: string[];
  walk: (page: Page) => Promise<void>;
}

async function beat(page: Page, ms = 1200): Promise<void> {
  await page.waitForTimeout(ms);
}

async function keyFrame(page: Page, clip: string, name: string): Promise<void> {
  await page.screenshot({ path: path.join(FRAMES_DIR, `${clip}-${name}.png`) });
}

/** Library/System pages share a tab strip in the top bar. */
function topTab(page: Page, name: string) {
  return page.locator("header").getByRole("link", { name, exact: true }).first();
}

const CLIPS: Clip[] = [
  {
    name: "today",
    start: "/",
    ready: "Review search rewrite plan",
    caption: "Today: your tasks, plans and the day at a glance",
    warm: [],
    async walk(page) {
      await beat(page, 1800);
      const addTask = page.getByPlaceholder(/Add a task/);
      await clickOn(page, addTask);
      // Different tasks from the README walk, which runs first on the same fixture under `all`.
      await addTask.pressSequentially("Add idempotency keys to the webhook handler #payments", { delay: 35 });
      await page.keyboard.press("Enter");
      await expect(page.getByText("Add idempotency keys to the webhook handler").first()).toBeVisible();
      await beat(page, 900);
      await page.mouse.wheel(0, 260);
      await beat(page, 600);
      await setCaption(page, "Tick things off as you go — progress and streaks update live");
      const queue = page.locator(".task-row").filter({ hasText: "Page on queue age instead of depth" });
      await clickOn(page, queue.getByRole("button", { name: "Mark task complete" }));
      await beat(page, 1600);
      await keyFrame(page, "today", "tasks");
      await page.mouse.wheel(0, -260);
      await setCaption(page, "Plans shows which tasks are ready for an agent to pick up");
      await pointAt(page, page.getByText("Plans", { exact: true }).first());
      await beat(page, 2200);
    },
  },
  {
    name: "work",
    start: "/work",
    ready: "Review search rewrite plan",
    caption: "Work: every open task, filterable by tag, date or status",
    warm: ["/work?tab=history", "/review"],
    async walk(page) {
      await beat(page, 1500);
      const search = page.getByPlaceholder(/Search text, Jira key/).first();
      await clickOn(page, search);
      await search.pressSequentially("#payments", { delay: 90 });
      await beat(page, 1800);
      await keyFrame(page, "work", "filtered");
      await search.fill("");
      await setCaption(page, "History: what got done, moved or abandoned, day by day");
      await clickOn(page, page.getByText("History", { exact: true }).first());
      await expect(page.getByText(/total/).first()).toBeVisible({ timeout: 30_000 });
      await beat(page, 1200);
      await clickOn(page, page.getByRole("button", { name: /^Done/ }).first());
      await beat(page, 1800);
      await setCaption(page, "Review: the week in numbers, and what keeps slipping");
      await clickOn(page, sidebarLink(page, "Review"));
      await expect(page.getByText("Throughput")).toBeVisible({ timeout: 30_000 });
      await beat(page, 2600);
      await keyFrame(page, "work", "review");
    },
  },
  {
    name: "notes",
    start: "/notes",
    ready: "Picking up where you left off",
    caption: "Notes: plain files in git, organised by area",
    warm: ["/notes/projects/payments-hardening", "/notes/meetings/checkout-retro"],
    async walk(page) {
      await beat(page, 1500);
      await clickOn(page, page.getByText("Payments hardening", { exact: true }).first());
      await expect(page.getByText("Idempotency keys on the webhook handler").first()).toBeVisible({ timeout: 30_000 });
      await beat(page, 1200);
      await setCaption(page, "Block editor — lists, checklists, links and tags");
      const item = page.getByText("Idempotency keys on the webhook handler").first();
      await clickOn(page, item);
      // Keyboard line-end shortcuts can split this block at the click position on macOS.
      await item.evaluate((element) => {
        const selection = window.getSelection();
        if (!selection) throw new Error("No editor selection");
        const range = document.createRange();
        range.selectNodeContents(element);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
      });
      await page.keyboard.press("Enter");
      await page.keyboard.type("Alert on retry-queue age over five minutes", { delay: 40 });
      await expect(page.getByText("Idempotency keys on the webhook handler", { exact: true })).toBeVisible();
      await expect(page.getByText("Alert on retry-queue age over five minutes", { exact: true })).toBeVisible();
      await beat(page, 1600);
      await keyFrame(page, "notes", "edit");
      await setCaption(page, "Follow links between notes");
      await clickOn(page, page.getByRole("link", { name: "checkout retro" }).first());
      await expect(page.getByText("Retry storm on the payments webhook").first()).toBeVisible({ timeout: 30_000 });
      await beat(page, 2600);
    },
  },
  {
    name: "command-palette",
    start: "/",
    ready: "Review search rewrite plan",
    caption: "⌘P: jump to any page, note, task or action",
    warm: ["/notes/meetings/checkout-retro", "/search"],
    async walk(page) {
      await beat(page, 1500);
      await page.keyboard.press("ControlOrMeta+p");
      const input = page.getByRole("dialog").getByRole("combobox").or(page.getByRole("dialog").getByRole("textbox")).first();
      await expect(input).toBeVisible();
      await input.pressSequentially("retro", { delay: 110 });
      await beat(page, 1600);
      await keyFrame(page, "command-palette", "results");
      await page.keyboard.press("Enter");
      await expect(page.getByText("Retry storm on the payments webhook").first()).toBeVisible({ timeout: 30_000 });
      await beat(page, 1500);
      await setCaption(page, "Search: full text across notes, learnings, tasks and docs");
      await clickOn(page, sidebarLink(page, "Search"));
      const query = page.getByPlaceholder(/Search notes, learnings/);
      await clickOn(page, query);
      await query.pressSequentially("jitter", { delay: 110 });
      await page.keyboard.press("Enter");
      await expect(page.getByText(/Cap webhook retries/).first()).toBeVisible({ timeout: 30_000 });
      await beat(page, 2600);
    },
  },
  {
    name: "diagrams-and-docs",
    start: "/diagrams",
    ready: "checkout-flow",
    caption: "Diagrams: tldraw canvases that agents can draw too",
    warm: ["/diagrams/architecture/checkout-flow", "/docs", "/docs/architecture/overview"],
    async walk(page) {
      await beat(page, 1200);
      await clickOn(page, page.getByText("checkout-flow", { exact: true }).first());
      await expect(page.locator(".tl-canvas")).toBeVisible({ timeout: 30_000 });
      await beat(page, 800);
      // Fit the whole graph: shift+1 is tldraw's zoom-to-fit.
      await page.locator(".tl-canvas").click({ position: { x: 20, y: 400 } });
      await page.keyboard.press("Shift+1");
      await beat(page, 2600);
      await keyFrame(page, "diagrams-and-docs", "diagram");
      await setCaption(page, "Docs: this documentation, readable and editable in the app");
      await clickOn(page, topTab(page, "Docs"));
      await expect(page.getByText("New here?")).toBeVisible({ timeout: 30_000 });
      await beat(page, 1200);
      await clickOn(page, page.getByText("Architecture Overview", { exact: true }).first());
      await expect(page.getByRole("heading", { name: /Architecture Overview/ }).first()).toBeVisible({ timeout: 30_000 });
      await beat(page, 1200);
      await page.mouse.wheel(0, 900);
      await beat(page, 2200);
    },
  },
  {
    name: "repos",
    start: "/repos",
    ready: "payments-api",
    caption: "Repos: every local clone, with what's changed and unpushed",
    warm: ["/repos/payments-api"],
    async walk(page) {
      await beat(page, 1500);
      await pointAt(page, page.getByText("4 unpushed").first());
      await beat(page, 1200);
      await setCaption(page, "Each repo gets a hub: tasks, commits, PRs and notes");
      await clickOn(page, page.getByText("payments-api", { exact: true }).first());
      await expect(page.getByText("Active work")).toBeVisible({ timeout: 30_000 });
      await beat(page, 1200);
      await clickOn(page, page.getByRole("button", { name: /Commits/ }).first());
      await expect(page.getByText("fix: retry webhook with jitter").first()).toBeVisible({ timeout: 30_000 });
      await beat(page, 2400);
      await keyFrame(page, "repos", "hub");
    },
  },
  {
    name: "system",
    gif: false,
    start: "/status",
    ready: "Sync & changes",
    caption: "System: sync health, runtime and maintenance in one place",
    warm: ["/setup"],
    async walk(page) {
      await beat(page, 2000);
      // Tab labels differ across versions (Runtime / Services); match either.
      await clickOn(page, page.getByText(/^(Runtime|Services)$/).first());
      await beat(page, 2200);
      await clickOn(page, page.getByText(/^Maintenance$/).first());
      await beat(page, 2200);
      await keyFrame(page, "system", "status");
      await setCaption(page, "Setup: switch on only the integrations you use");
      await clickOn(page, topTab(page, "Setup"));
      await expect(page.getByText("Welcome to DevHub")).toBeVisible({ timeout: 30_000 });
      await beat(page, 1500);
      await clickOn(page, page.getByText("Notes and planning", { exact: true }));
      await beat(page, 2200);
    },
  },
  {
    name: "integrations",
    mp4: false,
    start: "/setup",
    ready: "Welcome to DevHub",
    caption: "Integrations: switch on only the ones you use",
    warm: [],
    async walk(page) {
      await beat(page, 1800);
      // "All of it" keeps every integration in the stepper; a narrower goal hides some of them.
      await clickOn(page, page.getByText("All of it", { exact: true }));
      await beat(page, 1600);
      await setCaption(page, "GitHub runs through your own gh sign-in; DevHub never stores the token");
      await clickOn(page, page.getByTitle("GitHub", { exact: true }));
      await expect(page.getByText("GitHub CLI is not connected yet")).toBeVisible({ timeout: 30_000 });
      await beat(page, 2400);
      await setCaption(page, "Google Calendar: read-only access, credentials stored locally");
      await clickOn(page, page.getByTitle("Google Calendar", { exact: true }));
      await expect(page.getByText("Turn on the Calendar API")).toBeVisible({ timeout: 30_000 });
      await beat(page, 3000);
      await setCaption(page, "Jira, Datadog and an AI provider slot in the same way");
      await clickOn(page, page.getByTitle("Jira Cloud", { exact: true }));
      await expect(page.getByText("Jira is not connected yet")).toBeVisible({ timeout: 30_000 });
      await beat(page, 2800);
    },
  },
  {
    name: "review-assignment",
    mp4: false,
    // The fixture's Paseo is a dead port, so the launch sheet's agent list is a stub.
    // The walk never starts a run or saves the review choice: it closes the sheet instead.
    stubs: async (context) => {
      await context.route("**/api/agent/connection", (route) =>
        route.fulfill({
          json: {
            connected: true,
            defaultAgentId: "claude",
            defaultCwd: "/tmp/devhub-readme-fixture/repos",
            agents: [
              { id: "claude", name: "Claude", ready: true, models: ["opus", "sonnet", "haiku"] },
              { id: "codex", name: "Codex", ready: true, models: ["gpt-6-astra", "gpt-6-sol", "gpt-6-luna"] },
              { id: "cursor", name: "Cursor", ready: true, models: ["auto", "grok-4.6"] },
            ],
          },
        }),
      );
    },
    start: "/work",
    ready: "Cache search results per tenant",
    caption: "Implement with an agent, and choose who reviews the diff",
    warm: [],
    async walk(page) {
      await beat(page, 1500);
      const row = page.locator(".task-row").filter({ hasText: "Cache search results per tenant" }).first();
      await pointAt(page, row);
      await clickOn(page, row.getByRole("button", { name: /^Actions for/ }));
      await clickOn(page, page.getByRole("menuitem", { name: /Implement with Agent/ }));
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByText("Review with")).toBeVisible({ timeout: 30_000 });
      await expect(dialog.getByText("Ready to implement")).toBeVisible();
      await beat(page, 1800);
      await setCaption(page, "Pick the assistant and model that implement it");
      await clickOn(page, dialog.getByLabel(/^Model/).first());
      await dialog.getByLabel(/^Model/).first().selectOption("opus");
      await beat(page, 1400);
      await setCaption(page, "Then pick a different one to review it before you're asked to commit");
      await clickOn(page, dialog.getByLabel(/^Review with/));
      await dialog.getByLabel(/^Review with/).selectOption("codex");
      await beat(page, 1200);
      await clickOn(page, dialog.getByLabel(/^Review model/));
      await dialog.getByLabel(/^Review model/).selectOption("gpt-6-astra");
      await expect(dialog.getByText(/That assistant reviews the finished diff/)).toBeVisible();
      await beat(page, 3200);
      await keyFrame(page, "review-assignment", "chosen");
      await clickOn(page, dialog.getByRole("button", { name: "Cancel" }));
      await beat(page, 1200);
    },
  },
  {
    name: "git-client",
    mp4: false,
    start: "/repos/payments-api/git",
    ready: "fix: retry webhook with jitter",
    caption: "Git client: history, staging and commits without leaving DevHub",
    warm: [],
    async walk(page) {
      await beat(page, 1500);
      await clickOn(page, page.getByText("fix: retry webhook with jitter").first());
      await expect(page.getByText("diff --git").first()).toBeVisible({ timeout: 30_000 });
      await beat(page, 2000);
      await keyFrame(page, "git-client", "history");
      await setCaption(page, "Stage a whole file, one hunk or single lines");
      await clickOn(page, page.getByRole("tab", { name: /Changes/ }));
      const hunk = page.getByText("@@ -1,3 +1,4 @@");
      await expect(hunk).toBeVisible({ timeout: 30_000 });
      await pointAt(page, hunk);
      await clickOn(page, page.getByRole("button", { name: "Stage hunk" }));
      await beat(page, 1500);
      await setCaption(page, "Write the message yourself, or draft it with your AI tool");
      const message = page.getByPlaceholder("Commit message…");
      await clickOn(page, message);
      await message.pressSequentially("fix: cap webhook retries with jitter", { delay: 45 });
      await beat(page, 1600);
      await keyFrame(page, "git-client", "staged");
      // Leave the fixture as found so the walk can run again.
      await clickOn(page, page.getByRole("button", { name: "Unstage all" }));
      await beat(page, 800);
      await setCaption(page, "Branches, stashes, worktrees and the reflog are a tab away");
      await clickOn(page, page.getByRole("tab", { name: /Branches/ }));
      await beat(page, 2200);
      await clickOn(page, page.getByText("Worktrees", { exact: true }).first());
      await beat(page, 2400);
    },
  },
  {
    name: "database",
    mp4: false,
    start: "/db",
    ready: "No connections yet",
    caption: "Databases: SQLite, Postgres and MongoDB in one guarded client",
    warm: [],
    async walk(page) {
      await beat(page, 1500);
      await clickOn(page, page.getByRole("button", { name: "Add a connection" }));
      const name = page.getByRole("dialog").getByLabel("Name", { exact: true });
      await clickOn(page, name);
      await name.pressSequentially("Orders", { delay: 60 });
      await setCaption(page, "Point it at a .db file in any of your repos — no setup");
      await clickOn(page, page.getByRole("button", { name: /Find databases in my repos/ }));
      await clickOn(page, page.getByRole("dialog").getByText("orders.db").first());
      await beat(page, 900);
      await clickOn(page, page.getByRole("button", { name: "Add connection" }));
      await clickOn(page, page.getByText("Orders", { exact: true }).first());
      await expect(page.getByText("customers", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
      await beat(page, 1000);
      await setCaption(page, "Browse tables, inspect structure — read-only unless you opt in");
      await clickOn(page, page.getByText("orders", { exact: true }).first());
      await beat(page, 1800);
      await clickOn(page, page.getByRole("button", { name: "Structure" }));
      await beat(page, 2000);
      await setCaption(page, "Write SQL; every statement is classified before it runs");
      await clickOn(page, page.getByRole("button", { name: "Query" }));
      const editor = page.locator(".cm-content").first();
      await clickOn(page, editor);
      await page.keyboard.press("ControlOrMeta+A");
      // Unindented lines: the editor indents on Enter, so leading spaces would double up.
      await page.keyboard.type(
        "SELECT status,\ncount(*) AS orders,\nsum(total_cents) / 100.0 AS revenue\nFROM orders\nGROUP BY status\nORDER BY revenue DESC",
        { delay: 18 },
      );
      // Close the autocomplete popup, which would otherwise cover the editor.
      await page.keyboard.press("Escape");
      await clickOn(page, page.getByRole("button", { name: /^Run/ }));
      await expect(page.getByText("refunded").first()).toBeVisible({ timeout: 30_000 });
      await beat(page, 2800);
      await keyFrame(page, "database", "result");
    },
  },
  {
    name: "skills-and-voice",
    mp4: false,
    start: "/skills",
    ready: "Sync preview",
    caption: "Skills: one catalogue, synced into your supported AI tools",
    warm: ["/voice"],
    async walk(page) {
      await beat(page, 1800);
      await pointAt(page, page.getByText("Sync preview").first());
      await beat(page, 1600);
      await clickOn(page, page.getByRole("button", { name: "Sync skills" }));
      await beat(page, 3200);
      await keyFrame(page, "skills-and-voice", "synced");
      await setCaption(page, "Train your voice: answer real scenarios the way you'd write them");
      await clickOn(page, page.getByRole("link", { name: "Train my voice" }).or(page.getByRole("button", { name: "Train my voice" })));
      await expect(page.getByText("Scenario 1 of 20")).toBeVisible({ timeout: 30_000 });
      await beat(page, 1200);
      const answers = [
        "Not sure we need a library for this. It's about ten lines and we already have a helper. Happy to pair on it if you want.",
        "Yep, that looks right. Ship it.",
        "Tuesday is realistic if nothing else lands. Friday's tight, so I wouldn't promise it.",
      ];
      for (const [i, answer] of answers.entries()) {
        const box = page.getByPlaceholder("Write it exactly as you would send it.");
        await clickOn(page, box);
        await box.pressSequentially(answer, { delay: 14 });
        await beat(page, 500);
        await clickOn(page, page.getByRole("button", { name: /Save & next/ }));
        await expect(page.getByText(`Scenario ${i + 2} of 20`)).toBeVisible({ timeout: 30_000 });
        await beat(page, 600);
      }
      await setCaption(page, "Your answers become the my-voice skill, so agents write like you");
      await pointAt(page, page.getByText("3/20 answered"));
      await beat(page, 2600);
      await keyFrame(page, "skills-and-voice", "voice");
    },
  },
  {
    name: "conventions",
    mp4: false,
    start: "/conventions",
    ready: "acme-co/search-service",
    caption: "Conventions: rules learned from your reviewers' past PR comments",
    warm: [],
    async walk(page) {
      await beat(page, 1600);
      await clickOn(page, page.getByText("search-service", { exact: false }).first());
      await expect(page.getByText("one file per handler", { exact: false }).or(page.getByText("Put each HTTP handler")).first()).toBeVisible({
        timeout: 30_000,
      });
      await beat(page, 2000);
      await setCaption(page, "Each rule links back to the review comments that justify it");
      // Rules are newest-first, so the handler rule is the third card.
      await clickOn(page, page.getByRole("button", { name: /Evidence/ }).nth(2));
      await expect(page.getByText("We usually do one file per handler")).toBeVisible({ timeout: 30_000 });
      await beat(page, 3000);
      await keyFrame(page, "conventions", "evidence");
      await setCaption(page, "Rejected candidates keep their reason, so nothing is silently dropped");
      await clickOn(page, page.getByRole("button", { name: /^Rejected/ }));
      await expect(page.getByText("Use tabs for indentation.")).toBeVisible({ timeout: 30_000 });
      await beat(page, 2800);
    },
  },
  {
    name: "token-usage",
    mp4: false,
    // No real sign-in exists in the fixture, so the meters are demo numbers.
    stubs: async (context) => {
      await context.route("**/api/agent-usage", (route) =>
        route.fulfill({
          json: {
            providers: [
              {
                id: "claude", name: "Claude", plan: "Max", status: "ok", spend: [],
                meters: [
                  { label: "Session (5h)", percent: 38, resetsAt: new Date(Date.now() + 2.4 * 3600e3).toISOString() },
                  { label: "Week", percent: 61, resetsAt: new Date(Date.now() + 3 * 86400e3).toISOString() },
                ],
              },
              {
                id: "codex", name: "Codex", plan: "Pro", status: "ok", meters: [],
                spend: [{ label: "This month", amount: 42.18, currency: "USD", source: "estimate" }],
              },
              { id: "cursor", name: "Cursor", plan: "Pro", status: "ok", spend: [], meters: [{ label: "Included requests", percent: 72 }] },
            ],
          },
        }),
      );
    },
    start: "/agents?view=usage",
    ready: "Plan usage",
    caption: "Usage: allowances and spend estimates (demo values)",
    warm: ["/recall"],
    async walk(page) {
      await beat(page, 2800);
      await keyFrame(page, "token-usage", "usage");
      await setCaption(page, "Recall: context ranked and cut to a token budget you set");
      // Recall is a palette destination with no sidebar slot, so navigate directly.
      await page.goto(new URL("/recall", BASE_URL).toString());
      await hydrated(page);
      const query = page.getByPlaceholder(/What do I already know about/);
      await clickOn(page, query);
      await query.pressSequentially("webhook retries", { delay: 60 });
      await page.keyboard.press("Enter");
      await beat(page, 2600);
      await keyFrame(page, "token-usage", "recall");
      await setCaption(page, "Set a token budget and recall packs the best-ranked passages inside it");
      const slider = page.locator('input[type="range"]').first();
      const box = await slider.boundingBox();
      if (!box) throw new Error("No bounding box for the Recall budget slider");
      await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2, { steps: 18 });
      await page.mouse.click(box.x + box.width * 0.06, box.y + box.height / 2);
      await beat(page, 3200);
      await keyFrame(page, "token-usage", "recall-small");
    },
  },
];

/** Resample paint-driven frames onto a fixed clock and encode H.264. */
async function encodeMp4(frames: Frame[], stoppedAt: number, out: string): Promise<number> {
  if (frames.length === 0) throw new Error("Screencast captured no frames");
  const ffmpeg = spawn(
    "ffmpeg",
    [
      "-loglevel", "error", "-y",
      "-f", "image2pipe", "-framerate", String(FPS), "-i", "-",
      // Even dimensions for yuv420p; faststart so the player can begin before the file loads.
      "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
      "-c:v", "libx264", "-preset", "slow", "-crf", "30", "-tune", "animation",
      "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", out,
    ],
    { stdio: ["pipe", "inherit", "inherit"] },
  );
  const done = new Promise<void>((resolve, reject) => {
    ffmpeg.on("error", reject);
    ffmpeg.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
  });

  let written = 0;
  let index = 0;
  for (let t = frames[0].at; t < stoppedAt; t += 1 / FPS) {
    while (index + 1 < frames.length && frames[index + 1].at <= t) index++;
    if (!ffmpeg.stdin.write(frames[index].png)) {
      await new Promise((resolve) => ffmpeg.stdin.once("drain", resolve));
    }
    written++;
  }
  ffmpeg.stdin.end();
  await done;
  return written;
}

async function record(browser: Browser, clip: Clip): Promise<void> {
  const contextOptions = { viewport: VIEWPORT, deviceScaleFactor: 1, colorScheme: "dark" as const };

  const warmup = await browser.newContext(contextOptions);
  await clip.stubs?.(warmup);
  const warmPage = await warmup.newPage();
  for (const route of [clip.start, ...clip.warm]) {
    await warmPage.goto(new URL(route, BASE_URL).toString());
    await hydrated(warmPage);
  }
  await warmup.close();

  const context = await browser.newContext(contextOptions);
  await context.addInitScript(OVERLAY_SCRIPT);
  // The PWA install hint would pop over every Status shot.
  await context.addInitScript(`try {
    localStorage.setItem(${JSON.stringify(PWA_HINT_KEYS[0])}, "1");
    localStorage.setItem(${JSON.stringify(PWA_HINT_KEYS[1])}, "1");
  } catch {}`);
  // The fixture runs on this machine, so the LAN badge would show its real addresses.
  await context.route("**/api/status/lan", (route) => route.fulfill({ json: { addresses: [] } }));
  await clip.stubs?.(context);
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  try {
    await page.goto(new URL(clip.start, BASE_URL).toString());
    await hydrated(page);
    await expect(page.getByText(clip.ready).first()).toBeVisible({ timeout: 60_000 });
    await setCaption(page, clip.caption);
    await beat(page, 600);

    const stop = await startScreencast(page, VIEWPORT);
    await clip.walk(page);
    const { frames, stoppedAt } = await stop();
    if (clip.mp4 !== false) {
      const out = path.join(OUT_DIR, `${clip.name}.mp4`);
      const count = await encodeMp4(frames, stoppedAt, out);
      const kb = Math.round(fs.statSync(out).size / 1024);
      console.log(`${clip.name}: ${count} frames (${(count / FPS).toFixed(1)}s), ${kb} KB → ${out}`);
    }
    if (clip.gif !== false) {
      const gif = path.join(OUT_DIR, `${clip.name}.gif`);
      const gifFrames = await encodeGif(frames, stoppedAt, gif);
      console.log(`${clip.name}: ${gifFrames} GIF frames, ${Math.round(fs.statSync(gif).size / 1024)} KB → ${gif}`);
    }
  } catch (err) {
    await page.screenshot({ path: path.join(FRAMES_DIR, `${clip.name}-failure.png`) }).catch(() => {});
    throw new Error(`${clip.name}: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await context.close();
  }
}

async function main(): Promise<void> {
  const unknown = ONLY.filter((name) => !CLIPS.some((c) => c.name === name));
  if (unknown.length) throw new Error(`Unknown clip(s): ${unknown.join(", ")}`);
  fs.mkdirSync(FRAMES_DIR, { recursive: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  try {
    for (const clip of CLIPS) {
      if (ONLY.length && !ONLY.includes(clip.name)) continue;
      await record(browser, clip);
    }
  } finally {
    await browser.close();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
