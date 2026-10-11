import path from "node:path";
import { createServer } from "node:http";
import sharp from "sharp";
import { expect, type BrowserContext, type Page, type Route } from "@playwright/test";
import type { Clip } from "./record-walkthroughs";
import { clickOn, hydrated, pointAt, setCaption } from "./demo-kit";
import type { WriteInput, WriteProposal } from "../lib/integrations/write-types";
import type { Destination, DestinationInput, AlertEntry } from "../lib/integrations/alert-types";
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

export async function integrationStubs(context: BrowserContext): Promise<void> {
  await isolated(context);
  let proposal: WriteProposal | undefined;
  await context.route("**/api/integrations", (route) => json(route, {
    providers: [
      { id: "jira", label: "Jira Cloud", capabilities: ["issue.search", "issue.create"], accounts: [{ id: "default", label: "Demo workspace" }] },
      { id: "github", label: "GitHub", capabilities: ["pr.create", "pr.update", "pr.publish"], accounts: [{ id: "default", label: "Demo workspace" }] },
    ], accounts: [], task: null,
  }));
  await context.route("**/api/integrations/alerts", (route) => json(route, { profile: "demo", destinations: [], outbox: [] }));
  await context.route("**/api/integrations/writes", async (route) => {
    if (route.request().method() === "GET") return json(route, { now: Date.now(), proposals: proposal ? [proposal] : [], chat: [] });
    const body = route.request().postDataJSON() as { action: string; input: WriteInput };
    if (body.action === "propose") {
      proposal = { id: PROPOSAL, input: body.input, source: "DevHub", state: "requested", createdAt: NOW, expiresAt: new Date(Date.now() + 900_000).toISOString(), profile: "demo" };
    } else if (body.action === "review" && proposal) {
      proposal = { ...proposal, state: "pending", digest: "a".repeat(64), prepared: {
        summary: "Create Jira ticket", actor: "Demo engineer", destination: "demo.atlassian.net · DEMO",
        details: { title: "Add webhook idempotency", description: "Reject duplicate payment events before writing a second receipt." }, native: {},
      } };
    } else if (body.action === "cancel" && proposal) proposal = { ...proposal, state: "cancelled" };
    else return route.abort("blockedbyclient");
    await json(route, { proposal });
  });
}

export async function telegramStubs(context: BrowserContext): Promise<void> {
  await integrationStubs(context);
  let destination: Omit<Destination, "credentialHash"> | undefined;
  const outbox: AlertEntry[] = [];
  await context.route("**/api/integrations/writes", (route) => route.request().method() === "GET" ? json(route, { now: Date.now(), proposals: [], chat: [{ provider: "telegram", enabled: false, configured: false, allowed: 0 }] }) : route.abort("blockedbyclient"));
  await context.route("**/api/integrations/telegram/chats", async (route) => {
    if (route.request().method() !== "POST" || route.request().postDataJSON().credentialRef !== "DEVHUB_TELEGRAM_TOKEN") return route.abort("blockedbyclient");
    await json(route, { chats: [{ chatId: "123456", type: "private", userId: "123456" }, { chatId: "-100123456", type: "supergroup" }] });
  });
  await context.route("**/api/integrations/alerts", async (route) => {
    if (route.request().method() === "GET") return json(route, { profile: "demo", destinations: destination ? [destination] : [], outbox });
    const body = route.request().postDataJSON() as { action: string; destination?: DestinationInput; consent?: boolean; id?: string; revision?: number; requestId?: string };
    if (body.action === "save" && body.consent && body.destination?.provider === "telegram" && body.destination.credentialRef === "DEVHUB_TELEGRAM_TOKEN" && body.destination.chatId === "123456") {
      destination = { ...body.destination, revision: 1, consentAt: NOW };
      return json(route, { ok: true });
    }
    if (body.action !== "test" || !destination || body.id !== destination.id || body.revision !== destination.revision || !body.requestId) return route.abort("blockedbyclient");
    const delivery: AlertEntry = { id: "a".repeat(64), destinationId: destination.id, consentRevision: 1, eventId: body.requestId, taskId: "", workProfile: "demo", kind: "test", createdAt: NOW, state: "sent", attempts: 1, nextAttempt: 0, detail: "Accepted by provider (simulated)." };
    outbox.push(delivery);
    await json(route, { delivery });
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

export async function browserStubs(context: BrowserContext): Promise<void> {
  await isolated(context);
  const origin = fixtureOrigin();
  const image = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="460"><rect width="1100" height="460" fill="#101b25"/><text x="55" y="70" fill="#8de2cb" font-size="18" font-family="Arial">DEMO WORKSPACE · SIMULATED BROWSER CONTENT</text><text x="55" y="140" fill="#fff" font-size="34" font-family="Arial">Webhook delivery report</text><text x="55" y="190" fill="#c8d5df" font-size="20" font-family="Arial">3 deliveries · 0 duplicate receipts · ready for review</text><rect x="55" y="245" width="950" height="90" rx="12" fill="#1b3040"/><text x="80" y="285" fill="#fff" font-size="19" font-family="Arial">payments-demo.csv</text><text x="80" y="315" fill="#8de2cb" font-size="17" font-family="Arial">Downloads still need your approval in DevHub</text></svg>')).jpeg().toBuffer();
  const server = createServer((request, response) => {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Headers", "content-type");
    if (request.method === "OPTIONS") { response.writeHead(204); response.end(); return; }
    response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    response.write('event: ready\ndata: {"id":"demo-stream"}\n\n');
    response.write(`event: frame\ndata: ${JSON.stringify({ id: "demo-stream", data: image.toString("base64"), width: 1100, height: 460 })}\n\n`);
    const timer = setInterval(() => response.write('event: heartbeat\ndata: {}\n\n'), 1000);
    response.on("close", () => clearInterval(timer));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing demo stream address");
  context.on("close", () => { server.closeAllConnections(); server.close(); });
  let mode = "human";
  let transfer = false;
  await context.route("**/api/browser", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { action: string };
      if (body.action === "resume") { mode = "agent"; transfer = true; }
      else if (body.action === "takeover") mode = "human";
      else return route.abort("blockedbyclient");
    }
    await json(route, { supported: true, installed: true, tasks: [{ id: TASK, text: TASK_TEXT, runs: [] }], session: {
      id: TOKEN, taskId: TASK, runId: "demo-browser-run", profile: "demo", persistent: false, mode, ready: true,
      origins: ["https://example.com"], tabs: [{ id: "demo-tab", title: "Webhook delivery report", url: "https://example.com/report" }], activeTab: "demo-tab",
      ...(transfer ? { transfer: { id: PROPOSAL, kind: "download", name: "payments-demo.csv", origin: "https://example.com", bytes: 2048, expiresAt: Date.now() + 60_000 } } : {}),
    } });
  });
  await context.route("**/api/browser/surface", async (route) => {
    const body = route.request().postDataJSON() as { action: string };
    if (body.action === "stream") return route.fulfill({ status: 307, headers: { Location: `http://127.0.0.1:${address.port}/stream` } });
    if (body.action === "reject-transfer") { transfer = false; return json(route, { ok: true }); }
    if (body.action === "input") return json(route, { ok: true });
    return route.abort("blockedbyclient");
  });
}



export const NEW_FEATURE_CLIPS: Clip[] = [
  {
    name: "telegram-setup", mp4: false, start: "/integrations", ready: "Write actions", warm: [], stubs: telegramStubs,
    caption: "Telegram setup · real controls, invented IDs · no real tokens or messages",
    async walk(page) {
      const alerts = page.locator("#alerts");
      await alerts.getByText("Enable a destination", { exact: true }).scrollIntoViewIfNeeded();
      await clickOn(page, alerts.getByText("Enable a destination", { exact: true }));
      await alerts.getByRole("combobox", { name: /^Channel/ }).selectOption("telegram");
      await alerts.getByLabel("Destination label").fill("Demo work phone");
      await alerts.getByLabel("Bot token variable name").fill("DEVHUB_TELEGRAM_TOKEN");
      await alerts.getByRole("link", { name: "How to set up Telegram" }).scrollIntoViewIfNeeded();
      await expect(alerts.getByRole("link", { name: "How to set up Telegram" })).toHaveAttribute("href", "/docs/guides/integrations#telegram-setup");
      await setCaption(page, "Create a bot with @BotFather; store its token on the server · enter only the variable name");
      await beat(page, 2200); await frame(page, "telegram-setup", "help");
      await clickOn(page, alerts.getByRole("button", { name: "Find my chat ID" }));
      await expect(alerts.getByLabel("Chats found")).toBeVisible();
      await alerts.getByLabel("Chats found").evaluate((element) => element.scrollIntoView({ block: "center" }));
      await setCaption(page, "Start your bot first · discovery returns only numeric IDs, never messages or tokens");
      await beat(page, 1500);
      await alerts.getByLabel("Chats found").selectOption("123456");
      await expect(alerts.getByLabel("Telegram chat ID", { exact: false })).toHaveValue("123456");
      await frame(page, "telegram-setup", "chat-id");
      await alerts.getByLabel(/I approve these event templates/).check();
      await setCaption(page, "Review the fixed template and explicitly approve this recipient · saving sends nothing");
      await alerts.getByRole("button", { name: "Enable alerts", exact: true }).scrollIntoViewIfNeeded();
      await beat(page, 1600);
      await clickOn(page, alerts.getByRole("button", { name: "Enable alerts", exact: true }));
      await expect(alerts.getByRole("status")).toContainText("No test message was sent");
      await clickOn(page, alerts.getByRole("button", { name: "Send test message" }));
      await expect(alerts.getByRole("status")).toContainText("Test message sent to Demo work phone");
      await setCaption(page, "Send one explicit test · acceptance is simulated here · check your real chat during setup");
      await alerts.getByRole("status").scrollIntoViewIfNeeded();
      await beat(page, 2400); await frame(page, "telegram-setup", "test-sent");
      await page.locator("#chat").scrollIntoViewIfNeeded();
      await setCaption(page, "Inbound commands are a separate opt-in · HTTPS webhook + secret + exact private allowlist");
      await beat(page, 2200); await frame(page, "telegram-setup", "commands");
    },
  },
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
    name: "browser", mp4: false, start: "/browser", ready: "You have control", warm: [], stubs: browserStubs,
    caption: "Built-in browser · real DevHub controls, simulated page and transfer",
    async walk(page) {
      await page.getByRole("region", { name: "Live browser", exact: true }).scrollIntoViewIfNeeded();
      await expect(page.getByAltText("Live page in the task browser")).toBeVisible();
      await beat(page);
      await frame(page, "browser", "surface");
      await clickOn(page, page.getByRole("button", { name: "Resume agent for 15 minutes" }));
      await expect(page.getByText("Approve a download", { exact: true })).toBeVisible();
      await setCaption(page, "Every file transfer needs its own approval · demo download request");
      const approval = page.getByRole("region", { name: "File approval" });
      await approval.scrollIntoViewIfNeeded();
      await beat(page, 2300);
      await frame(page, "browser", "transfer");
      await clickOn(page, approval.getByRole("button", { name: "Reject", exact: true }));
      await page.getByRole("heading", { name: "Browser", exact: true }).scrollIntoViewIfNeeded();
      await clickOn(page, page.getByRole("button", { name: "Take control", exact: true }));
      await setCaption(page, "Take control pauses the agent · no file was transferred");
      await beat(page, 2300);
    },
  },
  {
    name: "integration-proposals", mp4: false, start: "/integrations", ready: "Write actions", warm: [], stubs: integrationStubs,
    caption: "Integration proposals · demo account, no provider writes",
    async walk(page) {
      await clickOn(page, page.getByRole("link", { name: "Write actions", exact: true }));
      await page.getByLabel("Project key", { exact: true }).fill("DEMO");
      await page.getByLabel("Title", { exact: true }).fill("Add webhook idempotency");
      await page.getByLabel("Description", { exact: true }).fill("Reject duplicate payment events before writing a second receipt.");
      await beat(page);
      await clickOn(page, page.getByRole("button", { name: "Review action…", exact: true }));
      const dialog = page.getByRole("dialog", { name: "Review this action" });
      await expect(dialog.getByText("demo.atlassian.net · DEMO", { exact: true })).toBeVisible();
      await setCaption(page, "Review the exact account, destination and content before confirming");
      await beat(page, 2400);
      await frame(page, "integration-proposals", "review");
      await clickOn(page, dialog.getByRole("button", { name: "Cancel action" }));
      await expect(page.getByText("Action cancelled. Nothing was sent.")).toBeVisible();
      await setCaption(page, "Cancel keeps the provider unchanged · chat cannot confirm writes");
      await beat(page, 1800);
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
