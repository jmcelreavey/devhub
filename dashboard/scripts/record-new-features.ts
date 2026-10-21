import path from "node:path";
import { expect, type BrowserContext, type Page, type Route } from "@playwright/test";
import type { Clip } from "./record-walkthroughs";
import { clickOn, hydrated, pointAt, setCaption } from "./demo-kit";
import type { TaskWorkflow } from "../lib/workflows/types";

const TASK = "a2d11234-1111-4111-8111-111111111111";
const SELECTION = "a2d11234-2222-4222-8222-222222222222";
const PROPOSAL = "a2d11234-3333-4333-8333-333333333333";
const TOKEN = "a2d11234-4444-4444-8444-444444444444";
const TASK_TEXT = "Add idempotency keys to payments";
const NOW = "2026-10-10T10:00:00.000Z";
const captured = {
  workspaceId: "payments-api", relativePath: "src/webhooks.ts", revision: "demo-revision",
  ranges: "12:1–16:2", documentVersion: 3, dirty: true, source: "editor",
  selectedText: "export async function acceptWebhook(event: PaymentEvent) {\n  const existing = await receipts.find(event.id);\n  if (existing) return existing;\n  return receipts.create(event);\n}",
};

async function beat(page: Page, milliseconds = 1400): Promise<void> {
  await page.waitForTimeout(milliseconds);
}
async function frame(page: Page, clip: string, name: string): Promise<void> {
  const directory = process.env.DEMO_FRAMES_DIR;
  if (!directory) throw new Error("DEMO_FRAMES_DIR is required");
  await page.screenshot({ path: path.join(directory, `${clip}-${name}.png`) });
}
async function json(route: Route, value: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(value) });
}
function fixtureOrigin(): string {
  const url = new URL(process.env.DEMO_URL ?? "");
  if (!["127.0.0.1", "localhost"].includes(url.hostname) || ["1337", "1339"].includes(url.port)) {
    throw new Error("New feature demos require a disposable loopback dashboard, never the packaged app or terminal peer");
  }
  return url.origin;
}
const isolatedContexts = new WeakSet<BrowserContext>();

async function isolated(context: BrowserContext): Promise<void> {
  if (isolatedContexts.has(context)) return;
  isolatedContexts.add(context);
  const origin = fixtureOrigin();
  await context.route("**/api/**", async (route) => {
    if (new URL(route.request().url()).origin !== origin) return route.abort("blockedbyclient");
    if (route.request().method() !== "GET") {
      return route.fulfill({ status: 403, contentType: "application/json", body: '{"error":"Demo blocked an unstubbed write"}' });
    }
    await route.continue();
  });
}

export async function editorStubs(context: BrowserContext): Promise<void> {
  await isolated(context);
  await context.route("**/api/editor/incoming?**", (route) => json(route, { id: SELECTION, selection: captured }));
  await context.route("**/api/editor/runtime", (route) => json(route, { supported: true, installed: false, version: "demo", session: null }));
  await context.route("**/api/editor/selection", async (route) => {
    if (route.request().postDataJSON().send) return route.abort("blockedbyclient");
    await json(route, { runs: [{ id: "demo-discussion", provider: "codex", status: "done", resumable: true, title: "Explain webhook retries" }], tasks: [{ id: TASK, text: TASK_TEXT }] });
  });
  await context.route("**/api/agent/connection", (route) => json(route, {
    connected: true, agents: [{ id: "codex", name: "Codex", ready: true }], defaultProvider: "codex",
  }));
}

async function workflowStubs(context: BrowserContext): Promise<void> {
  await isolated(context);
  const workflow: TaskWorkflow = {
    version: 1, taskId: TASK, revision: 3, seenRevision: 2, stage: "approve", status: "waiting-user",
    checks: [{ id: TOKEN, runId: "demo-implementation", fingerprint: "demo-code", command: "npm run verify", startedAt: NOW, finishedAt: NOW, exitCode: 0, outcome: "passed" }],
    reviews: [{ runId: "demo-review", fingerprint: "demo-code", findings: "Duplicate-event handling tested. All findings resolved.", verdict: "pass", recordedAt: NOW }],
    proposals: [{ id: PROPOSAL, kind: "commit-push", runId: "demo-implementation", fingerprint: "demo-code", destination: "demo/payments-api · feature/idempotency", content: "fix: reject duplicate webhook events", contentHash: "a".repeat(64), expiresAt: new Date(Date.now() + 900_000).toISOString(), state: "pending" }],
    events: [{ id: TOKEN, at: NOW, summary: "Checks passed; independent review accepted." }],
  };
  await context.route("**/api/tasks/workflow**", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { action: string; approve: boolean };
      if (body.action !== "decide") return route.abort("blockedbyclient");
      workflow.proposals[0].state = body.approve ? "approved" : "rejected";
      workflow.revision += 1;
      workflow.events.push({ id: SELECTION, at: NOW, summary: "Publication proposal approved. Nothing has been pushed." });
    }
    await json(route, { task: { id: TASK, text: TASK_TEXT, date: "2026-10-10" }, workflow, runs: [
      { runId: "demo-implementation", role: "implement", provider: "codex", status: "done", cwd: "/tmp/devhub-demo-fixture/repos/payments-api", startedAt: NOW },
      { runId: "demo-review", role: "review", provider: "claude", status: "done", startedAt: NOW },
    ] });
  });
}

export const NEW_FEATURE_CLIPS: Clip[] = [

  {
    name: "neon-workshop", mp4: false, start: "/", ready: "Review search rewrite plan", warm: [],
    caption: "Graphite Neon (Default) · workshop effects and cursor follower are on by default",
    async walk(page) {
      await beat(page);
      await page.mouse.move(360, 160, { steps: 20 });
      await page.mouse.move(650, 220, { steps: 30 });
      await clickOn(page, page.getByRole("button", { name: /appearance/i }).first());
      await clickOn(page, page.getByRole("button", { name: "Theme effects" }));
      await expect(page.getByText("Neon workshop", { exact: true })).toBeVisible();
      await beat(page);
      await frame(page, "neon-workshop", "effects");
      await clickOn(page, page.getByRole("button", { name: "Try task done" }));
      await beat(page, 1800);
      await setCaption(page, "Preview the finishing touches; switch off any effect you do not want");
      await clickOn(page, page.getByRole("button", { name: "Try merge" }));
      await beat(page);
      const follower = page.getByRole("switch", { name: /Cursor follower/ });
      await clickOn(page, follower);
      await beat(page, 700);
      await clickOn(page, follower);
      await page.keyboard.press("Escape");
      await setCaption(page, "The follower steps aside while you type or use an editor");
      await page.mouse.move(480, 200, { steps: 30 });
      await beat(page);
      await pointAt(page, page.getByPlaceholder(/Add a task/).first());
      await beat(page);
      await frame(page, "neon-workshop", "cursor");
    },
  },


  {
    name: "editor-ask-ai", mp4: false, start: `/editor?workspace=payments-api&selection=${SELECTION}`, ready: "Ask AI", warm: [], stubs: editorStubs,
    caption: "Editor Ask AI · real selection preview, fixture conversations; no dispatch",
    async walk(page) {
      const dialog = page.getByRole("dialog", { name: "Ask AI about selection" });
      await expect(dialog).toBeVisible();
      await page.evaluate(() => {
        const panel = document.querySelector('dialog[aria-label="Ask AI about selection"]');
        const caption = document.getElementById("demo-caption");
        const cursor = document.getElementById("demo-cursor");
        if (!panel || !caption || !cursor) throw new Error("Missing selection recording overlay");
        panel.append(caption, cursor);
        Object.assign(caption.style, { position: "absolute", left: "24px", right: "24px", top: "106px", bottom: "auto", whiteSpace: "normal", fontSize: "14px" });
      });
      await beat(page);
      await frame(page, "editor-ask-ai", "selection");
      await dialog.getByLabel("Linked task").selectOption(TASK);
      await clickOn(page, dialog.getByLabel("Your question"));
      await dialog.getByLabel("Your question").fill("");
      await dialog.getByLabel("Your question").pressSequentially("Where could two deliveries race, and how would you test that?", { delay: 30 });
      await setCaption(page, "Send the captured lines and a question, not a moving copy of the file");
      await beat(page, 1800);
      await frame(page, "editor-ask-ai", "question");
      await page.evaluate(() => {
        const caption = document.getElementById("demo-caption");
        const cursor = document.getElementById("demo-cursor");
        if (caption && cursor) { caption.removeAttribute("style"); document.body.append(caption, cursor); }
      });
      await clickOn(page, dialog.getByRole("button", { name: "Cancel", exact: true }));
      await beat(page);
    },
  },
  {
    name: "review-persistence", mp4: false, start: `/workflow?taskId=${TASK}`, ready: "Checks passed", warm: [], stubs: workflowStubs,
    caption: "Task workflow · fixture evidence; reload illustrates persisted review state",
    async walk(page) {
      await expect(page.getByText("Review accepted", { exact: true })).toBeVisible();
      await beat(page);
      await frame(page, "review-persistence", "evidence");
      await clickOn(page, page.getByRole("button", { name: "Approve this proposal" }));
      await expect(page.getByText("approved", { exact: true })).toBeVisible();
      await setCaption(page, "An approval records this exact proposal; it does not push code");
      await beat(page, 2200);
      await frame(page, "review-persistence", "decision");
      await page.reload();
      await hydrated(page);
      await expect(page.getByText("Review accepted", { exact: true })).toBeVisible();
      await expect(page.getByText("approved", { exact: true })).toBeVisible();
      await setCaption(page, "After reload: checks, accepted review and decision are still here · demo state");
      await beat(page, 2200);
      await frame(page, "review-persistence", "reloaded");
    },
  },
  {
    name: "resize", mp4: false, start: "/", ready: "Review search rewrite plan", warm: [],
    caption: "Resize cards from every edge and corner · not just the bottom right",
    async walk(page) {
      await clickOn(page, page.getByRole("button", { name: "Collapse sidebar", exact: true }));
      await beat(page);
      const card = page.locator('[data-today-grid-slot="briefing"]').first();
      const before = await card.boundingBox();
      if (!before) throw new Error("Today card is not visible");
      for (const [edge, horizontal, vertical] of [["w", 160, 0], ["n", 0, 50], ["se", 60, 65]] as const) {
        const handle = card.locator(`[data-resize-axis="${edge}"]`).first();
        const box = await handle.boundingBox();
        if (!box) throw new Error(`Missing ${edge} resize edge`);
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 15 });
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2 + horizontal, box.y + box.height / 2 + vertical, { steps: 25 });
        await page.mouse.up();
        await beat(page, 1300);
      }
      const after = await card.boundingBox();
      expect(after?.width).not.toBe(before.width);
      await frame(page, "resize", "edges");
      await setCaption(page, "The layout keeps the new size · top, left and corner handles work too");
      await beat(page, 2200);
    },
  },
];
