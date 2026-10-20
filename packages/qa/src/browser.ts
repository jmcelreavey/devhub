import { createHash } from "node:crypto";
import { mkdir, readFile, rename } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright-core";
import { PNG } from "pngjs";
import type { Artifact, GoalResult, Observation, QaAction, QaDriver, QaGoal } from "./types";

export const sha256 = (data: Buffer | string): string => createHash("sha256").update(data).digest("hex");

/** Quantised viewport samples ignore small lighting changes; a stall is only a suspicion. */
export function imageFingerprint(buffer: Buffer): string {
  const png = PNG.sync.read(buffer);
  const bins: number[] = [];
  for (let row = 2; row < 18; row++) for (let column = 0; column < 32; column++) {
    const index = (Math.floor(row * png.height / 20) * png.width + Math.floor(column * png.width / 32)) * 4;
    bins.push(Math.round((png.data[index] + png.data[index + 1] + png.data[index + 2]) / 96));
  }
  return sha256(Buffer.from(bins));
}

export interface BrowserOptions {
  url: string;
  outputDir: string;
  surface?: "dom" | "canvas";
  actions?: QaAction[];
  allowedOrigins?: string[];
  channel?: string;
  headless?: boolean;
  viewport?: { width: number; height: number };
  deathText?: string;
  clearText?: string;
  observeSelector?: string;
  context?: string;
  /** Optional receipt evidence from public rendered UI. Never game state or debug hooks. */
  onObservation?: (observation: Observation, page: Page) => Promise<void>;
}

export class BrowserDriver implements QaDriver {
  readonly surface: "dom" | "canvas";
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private errors: string[] = [];
  private targets = new Map<string, { locator: Locator; name: string }>();
  private videoPath?: string;

  constructor(private readonly options: BrowserOptions) {
    this.surface = options.surface ?? "dom";
    const url = new URL(options.url);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("QA requires an HTTP(S) URL without credentials.");
  }
  async start(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    await mkdir(this.options.outputDir, { recursive: true, mode: 0o700 });
    this.browser = await chromium.launch({ channel: this.options.channel ?? "chrome", headless: this.options.headless ?? true, timeout: 15000 });
    this.context = await this.browser.newContext({
      viewport: this.options.viewport ?? { width: 960, height: 640 },
      recordVideo: { dir: this.options.outputDir, size: this.options.viewport ?? { width: 960, height: 640 } },
      acceptDownloads: false, serviceWorkers: "block",
    });
    const allowed = new Set([new URL(this.options.url).origin, ...(this.options.allowedOrigins ?? [])]);
    await this.context.route("**/*", async route => {
      const request = route.request();
      if (request.isNavigationRequest() && !allowed.has(new URL(request.url()).origin)) {
        this.errors.push("Navigation outside the scenario origins was blocked.");
        await route.abort(); return;
      }
      await route.continue();
    });
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(4000);
    this.page.setDefaultNavigationTimeout(15000);
    this.page.on("pageerror", error => this.errors.push(error.message.slice(0, 300)));
    this.page.on("dialog", dialog => void dialog.dismiss().catch(() => {}));
    // Operations have short native timeouts. Keep the page alive on cancellation
    // until keys are released and the final evidence is captured in runQa.finally.
    await this.page.goto(this.options.url, { waitUntil: "domcontentloaded" });
    if (this.surface === "canvas") await this.page.locator("canvas").first().waitFor({ state: "visible" });
  }
  private currentPage(): Page {
    if (!this.page || this.page.isClosed()) throw new Error("QA browser is not open.");
    return this.page;
  }
  async observe(signal: AbortSignal): Promise<Observation> {
    signal.throwIfAborted();
    const page = this.currentPage();
    const text = (await page.locator(this.options.observeSelector ?? "body").innerText()).slice(0, 16000);
    const screenshot = await page.screenshot({ type: "png", timeout: 4000 });
    const actions = this.options.actions ? [...this.options.actions] : [];
    this.targets.clear();
    if (!this.options.actions) {
      const controls = page.locator("a[href],button,[role=button]");
      const count = Math.min(await controls.count(), 180);
      for (let i = 0; i < count; i++) {
        const locator = controls.nth(i);
        if (!await locator.isVisible() || !await locator.isEnabled()) continue;
        const name = (await locator.innerText() || await locator.getAttribute("aria-label") || "").trim().slice(0, 160);
        if (!name) continue;
        const id = "click-" + i;
        actions.push({ id, description: "Click " + name, kind: "click" });
        this.targets.set(id, { locator, name });
      }
      actions.push({ id: "scroll-down", description: "Scroll down one viewport", kind: "scroll", value: "down" }, { id: "scroll-up", description: "Scroll up one viewport", kind: "scroll", value: "up" }, { id: "wait", description: "Wait briefly for content", kind: "wait", holdMs: 500 });
    }
    const observation: Observation = {
      text: `${this.options.context ?? ""}\nURL: ${page.url()}\n${text}`,
      screenshot, actions,
      fingerprint: this.surface === "canvas" ? imageFingerprint(screenshot) : sha256(text + page.url()),
      ...(this.options.deathText && text.includes(this.options.deathText) ? { terminal: "death" as const } :
        this.options.clearText && text.includes(this.options.clearText) ? { terminal: "clear" as const } : {}),
    };
    await this.options.onObservation?.(observation, page);
    return observation;
  }
  async act(action: QaAction, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const page = this.currentPage();
    const target = action.selector ? page.locator(action.selector) : this.targets.get(action.id)?.locator;
    const offered = this.targets.get(action.id);
    if (offered) {
      const currentName = (await offered.locator.innerText() || await offered.locator.getAttribute("aria-label") || "").trim().slice(0, 160);
      if (currentName !== offered.name) throw new Error("The observed control changed before the action.");
    }
    if (action.kind === "click" && target) { await target.click(); return; }
    if (action.kind === "fill" && target) {
      if (await target.getAttribute("type") === "password") throw new Error("QA cannot fill password fields.");
      await target.fill(action.value ?? ""); return;
    }
    if (action.kind === "select" && target) { await target.selectOption(action.value ?? ""); return; }
    if (action.kind === "scroll") { await page.mouse.wheel(0, action.value === "up" ? -500 : 500); return; }
    const holdMs = Math.min(Math.max(action.holdMs ?? 250, 20), 2000);
    if (action.kind === "wait") { await page.waitForTimeout(holdMs); return; }
    if (action.kind === "keys") {
      const keys = action.keys ?? [];
      if (keys.length > 4) throw new Error("Too many simultaneous keys.");
      try {
        for (const key of keys) await page.keyboard.down(key);
        await page.waitForTimeout(holdMs);
      } finally {
        for (const key of keys) { if (!page.isClosed()) await page.keyboard.up(key); }
      }
      return;
    }
    throw new Error("Unsupported or missing QA action target.");
  }
  async assert(goals: QaGoal[], signal: AbortSignal): Promise<GoalResult[]> {
    signal.throwIfAborted();
    const page = this.currentPage();
    const results: GoalResult[] = [];
    for (const goal of goals) {
      let actual = "";
      let passed = false;
      if (goal.assertion === "no-errors") { actual = this.errors.join("; ") || "No page errors."; passed = this.errors.length === 0; }
      else if (goal.assertion === "url") { actual = page.url(); passed = Boolean(goal.expected) && actual === goal.expected; }
      else if (goal.assertion === "screenshot") {
        actual = sha256(await page.screenshot({ type: "png", animations: "disabled", timeout: 4000 }));
        passed = actual === goal.expected;
      } else {
        const locator = page.locator(goal.selector ?? "body");
        if (goal.assertion === "visible") { passed = await locator.isVisible(); actual = passed ? "Visible" : "Not visible"; }
        else {
          const visible = await locator.count() > 0 && await locator.isVisible();
          actual = visible ? await locator.innerText() : "Element missing or hidden";
          passed = visible && Boolean(goal.expected) && actual.includes(goal.expected!);
        }
      }
      results.push({ id: goal.id, description: goal.description, passed, actual: actual.slice(0, 1000) });
    }
    return results;
  }
  async capture(phase: Artifact["phase"]): Promise<Artifact> {
    const file = phase + ".png";
    const buffer = await this.currentPage().screenshot({ path: path.join(this.options.outputDir, file), type: "png", timeout: 4000 });
    return { file, phase, kind: "image", sha256: sha256(buffer) };
  }
  async close(): Promise<Artifact[]> {
    const video = this.page?.video();
    try {
      await this.context?.close();
      if (video) this.videoPath = await video.path();
    } finally { await this.browser?.close(); }
    if (!this.videoPath) return [];
    const dest = path.join(this.options.outputDir, "run.webm");
    await rename(this.videoPath, dest);
    return [{ file: "run.webm", kind: "video", phase: "after", sha256: sha256(await readFile(dest)) }];
  }
}
