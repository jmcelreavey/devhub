import { randomUUID } from "node:crypto";
import type { CDPSession, Dialog, FileChooser, Frame, Page } from "playwright-core";
import { z } from "zod";
import type { ManagedBrowser } from "./runtime";
import { approvedUrl } from "./policy";

export const TRANSFER_LIMIT = 20 * 1024 * 1024;
export const SurfaceInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("click"), x: z.number().min(0).max(4096), y: z.number().min(0).max(2160), button: z.enum(["left", "middle", "right"]).default("left"), count: z.number().int().min(1).max(2).default(1) }).strict(),
  z.object({ kind: z.literal("scroll"), x: z.number().min(0).max(4096), y: z.number().min(0).max(2160), deltaX: z.number().min(-4000).max(4000), deltaY: z.number().min(-4000).max(4000) }).strict(),
  z.object({ kind: z.literal("text"), text: z.string().min(1).max(2000) }).strict(),
  z.object({ kind: z.literal("key"), key: z.enum(["Enter", "Tab", "Shift+Tab", "Backspace", "Delete", "Escape", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown", "ControlOrMeta+A", "ControlOrMeta+Z", "ControlOrMeta+Shift+Z"]) }).strict(),
  z.object({ kind: z.literal("resize"), width: z.number().int().min(320).max(1920), height: z.number().int().min(240).max(1080), dpr: z.number().min(1).max(2) }).strict(),
]);
export function downloadName(value: string): string {
  return value.replace(/[\\/\x00-\x1f\x7f<>:"|?*]/g, "_").replace(/^\.+/, "").slice(0, 160) || "download";
}
interface PendingTransfer {
  id: string; page: Page; url: string; expiresAt: number;
  chooser?: FileChooser; frame?: Frame; frameUrl?: string; cdp?: CDPSession; requestId?: string; timer: ReturnType<typeof setTimeout>;
}
interface LiveStream { id: string; page: Page; cdp: CDPSession; stop: () => Promise<void> }

/** Dashboard-only surface. Agent tools cannot create a stream, input ticket or transfer approval. */
export class BrowserSurface {
  private tabs = new Map<string, Page>();
  private clients = new Map<Page, CDPSession>();
  private transfer?: PendingTransfer;
  private dialog?: Dialog;
  private stream?: LiveStream;
  private disposed = false;
  private opening = false;
  private downloading = false;
  constructor(private session: ManagedBrowser, private assertAccess: () => void = () => undefined) {}

  async initialise() {
    await this.attach(this.session.page);
    this.session.context.on("page", (page) => {
      void this.attach(page).catch(() => {
        this.session.view.notice = "A popup could not be prepared and was closed.";
        void page.close().catch(() => undefined);
      });
    });
  }
  private refreshTabs() {
    this.session.view.tabs = [...this.tabs].map(([id, page]) => ({ id, title: page === this.session.page ? "Current tab" : "Popup", url: page.url() }));
  }
  private async attach(page: Page) {
    if (this.disposed || this.tabs.size >= 4) {
      this.session.view.notice = "Four tabs are already open. Close a tab before opening another popup.";
      await page.close(); return;
    }
    const id = randomUUID();
    this.tabs.set(id, page);
    if (page === this.session.page) this.session.view.activeTab = id;
    this.refreshTabs();
    const cdp = await this.session.context.newCDPSession(page);
    this.clients.set(page, cdp);
    await cdp.send("Network.setBypassServiceWorker", { bypass: true });
    // Chrome's ordinary download path always stays denied. Approved response bodies use a bounded stream.
    await cdp.send("Browser.setDownloadBehavior", { behavior: "deny" });
    page.on("filechooser", (chooser) => {
      void this.offerUpload(page, chooser).catch(() => { this.session.view.notice = "File selection failed. Choose the file again."; });
    });
    page.on("download", () => {
      this.session.view.notice = "Chrome blocked this download. Use an HTTPS attachment from an approved site; generated blob/data downloads are unavailable.";
    });
    page.on("dialog", (dialog) => {
      if (this.dialog) { void dialog.dismiss().catch(() => undefined); return; }
      this.dialog = dialog;
      this.session.view.dialog = { id: randomUUID(), type: dialog.type(), message: dialog.message().slice(0, 2000) };
      if (this.session.lease.mode !== "human") void this.session.lease.takeover();
    });
    cdp.on("Fetch.requestPaused", (event) => {
      void this.response(page, cdp, event).catch(() => {
        void cdp.send("Fetch.failRequest", { requestId: event.requestId, errorReason: "Aborted" }).catch(() => undefined);
        this.session.view.notice = "The download could not be prepared. Try it again.";
      });
    });
    await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*", resourceType: "Document", requestStage: "Response" }] });
    page.on("framenavigated", (frame) => {
      if (frame !== page.mainFrame()) return;
      this.refreshTabs();
      if (this.transfer?.page === page) void this.rejectTransfer();
      if (page === this.session.page) {
        this.session.observation = undefined; this.session.handles.clear(); this.session.view.pending = undefined;
      }
      if (frame.url() !== "about:blank" && !approvedUrl(frame.url(), this.session.view.origins)) {
        this.session.view.notice = "That page is outside the approved sites. Return to an approved tab.";
        void this.session.lease.takeover();
        void this.stopStream();
      }
    });
    page.on("close", () => {
      this.tabs.delete(id); this.clients.delete(page);
      if (this.transfer?.page === page) void this.rejectTransfer();
      if (this.stream?.page === page) void this.stopStream();
      if (this.session.page === page) {
        const next = this.tabs.entries().next().value;
        if (next) { this.session.page = next[1]; this.session.view.activeTab = next[0]; }
        else { this.session.view.ready = false; this.session.view.error = "All browser tabs closed. Stop this session, then start another."; }
        void this.session.lease.takeover();
      }
      this.refreshTabs();
    });
    // A popup can finish its first navigation while CDP interception is being attached.
    this.refreshTabs();
  }
  private async response(page: Page, cdp: CDPSession, event: { requestId: string; request: { url: string }; responseHeaders?: { name: string; value: string }[]; responseStatusCode?: number }) {
    const headers = new Map(event.responseHeaders?.map((h) => [h.name.toLowerCase(), h.value]));
    const disposition = headers.get("content-disposition") ?? "";
    const type = (headers.get("content-type") ?? "").split(";")[0].trim();
    const attachment = /attachment/i.test(disposition) || (type && !/^(text\/|image\/|application\/(pdf|json|xml|xhtml\+xml|javascript))/.test(type));
    if (!attachment || !event.responseStatusCode || event.responseStatusCode >= 300) {
      await cdp.send("Fetch.continueRequest", { requestId: event.requestId }); return;
    }
    const url = event.request.url;
    const bytes = Number(headers.get("content-length")) || undefined;
    if (!approvedUrl(url, this.session.view.origins) || (bytes && bytes > TRANSFER_LIMIT) || this.transfer || this.downloading) {
      await cdp.send("Fetch.failRequest", { requestId: event.requestId, errorReason: "Aborted" });
      this.session.view.notice = "Download blocked: use an approved site, a file under 20 MiB, and one transfer at a time."; return;
    }
    const name = downloadName(disposition.match(/filename="([^"]+)"/i)?.[1] ?? disposition.match(/filename=([^;\s]+)/i)?.[1] ?? new URL(url).pathname.split("/").pop() ?? "download");
    const id = randomUUID(), expiresAt = Date.now() + 60_000;
    const timer = setTimeout(() => { void this.rejectTransfer(); }, 60_000);
    this.transfer = { id, page, url, cdp, requestId: event.requestId, timer, expiresAt };
    this.session.view.transfer = { id, kind: "download", name, origin: new URL(url).origin, bytes, expiresAt };
  }
  private async offerUpload(page: Page, chooser: FileChooser) {
    const frame = await chooser.element().ownerFrame();
    if (this.disposed || page.isClosed()) return;
    const frameUrl = frame?.url();
    if (!frame || !frameUrl || !approvedUrl(frameUrl, this.session.view.origins)) {
      this.session.view.notice = "File selection is limited to frames on approved sites."; return;
    }
    if (this.transfer || this.downloading || !approvedUrl(page.url(), this.session.view.origins)) {
      this.session.view.notice = "Finish the current transfer before selecting another file."; return;
    }
    const id = randomUUID(), expiresAt = Date.now() + 60_000;
    const timer = setTimeout(() => { void this.rejectTransfer(); }, 60_000);
    this.transfer = { id, page, url: page.url(), chooser, frame, frameUrl, timer, expiresAt };
    this.session.view.transfer = { id, kind: "upload", name: "Choose one file", origin: new URL(frameUrl).origin, expiresAt };
    if (this.session.lease.mode !== "human") await this.session.lease.takeover();
  }
  async rejectTransfer() {
    const transfer = this.transfer;
    this.transfer = undefined; this.session.view.transfer = undefined;
    if (!transfer) return;
    clearTimeout(transfer.timer);
    if (transfer.cdp && transfer.requestId) await transfer.cdp.send("Fetch.failRequest", { requestId: transfer.requestId, errorReason: "Aborted" }).catch(() => undefined);
  }
  private consumeTransfer(id: string) {
    const transfer = this.transfer;
    if (!transfer || transfer.id !== id || Date.now() >= transfer.expiresAt) throw new Error("This transfer expired. Request it from the site again.");
    if (transfer.page.isClosed() || (transfer.chooser && transfer.page.url() !== transfer.url)) throw new Error("The page changed. Select the file again.");
    this.transfer = undefined; this.session.view.transfer = undefined; clearTimeout(transfer.timer);
    return transfer;
  }
  async upload(id: string, file: { name: string; mimeType: string; buffer: Buffer }) {
    if (file.buffer.length > TRANSFER_LIMIT) throw new Error("Choose a file no larger than 20 MiB.");
    return this.session.lease.executeHuman(async (check) => {
      const transfer = this.consumeTransfer(id);
      if (!transfer.chooser) throw new Error("This is not an upload request.");
      if (!transfer.frame || transfer.frame.url() !== transfer.frameUrl) throw new Error("The upload frame changed. Choose the file again.");
      if (!await transfer.chooser.element().evaluate((element) => element.isConnected)) throw new Error("The file input changed. Choose the file again.");
      check();
      await transfer.chooser.setFiles({ ...file, name: downloadName(file.name) }, { timeout: 3000 });
      this.session.view.notice = "The approved file was sent to the page. The site may upload it immediately.";
    });
  }
  async download(id: string) {
    const transfer = this.consumeTransfer(id);
    if (!transfer.cdp || !transfer.requestId) throw new Error("This is not a download request.");
    const { cdp, requestId } = transfer;
    this.downloading = true;
    let handle: string | undefined;
    const timer = setTimeout(() => { void cdp.detach().catch(() => undefined); this.session.controller.abort(); }, 30_000);
    try {
      handle = (await cdp.send("Fetch.takeResponseBodyAsStream", { requestId })).stream;
      const chunks: Buffer[] = []; let size = 0;
      for (;;) {
        const chunk = await cdp.send("IO.read", { handle, size: 64 * 1024 });
        const bytes = Buffer.from(chunk.data, chunk.base64Encoded ? "base64" : "utf8");
        size += bytes.length;
        if (size > TRANSFER_LIMIT) throw new Error("Download exceeded 20 MiB and was discarded.");
        chunks.push(bytes);
        if (chunk.eof) break;
      }
      this.session.view.notice = "Download handed to DevHub. Your browser controls where it is saved.";
      return Buffer.concat(chunks);
    } finally {
      this.downloading = false;
      clearTimeout(timer);
      if (handle) await cdp.send("IO.close", { handle }).catch(() => undefined);
      await cdp.send("Fetch.failRequest", { requestId, errorReason: "Aborted" }).catch(() => undefined);
    }
  }
  async answerDialog(id: string, accept: boolean, text?: string) {
    if (!this.dialog || this.session.view.dialog?.id !== id) throw new Error("This dialog already closed.");
    const dialog = this.dialog; this.dialog = undefined; this.session.view.dialog = undefined;
    if (accept) await dialog.accept(text); else await dialog.dismiss();
  }
  async selectTab(id: string, close = false) {
    await this.session.lease.takeover();
    await this.stopStream();
    await this.rejectTransfer();
    const page = this.tabs.get(id);
    if (!page) throw new Error("This tab closed. Choose another.");
    this.session.view.pending = undefined; this.session.observation = undefined; this.session.handles.clear();
    if (close) { if (this.tabs.size === 1) throw new Error("Use Stop browser to close the last tab."); await page.close(); }
    else { this.session.page = page; this.session.view.activeTab = id; await page.bringToFront(); }
    this.refreshTabs();
  }
  async input(streamId: string, input: z.infer<typeof SurfaceInputSchema>) {
    return this.session.lease.executeHuman(async (check) => {
      const stream = this.stream;
      if (!stream || stream.id !== streamId || stream.page !== this.session.page) throw new Error("The live view changed. Reconnect before sending input.");
      if (!approvedUrl(stream.page.url(), this.session.view.origins)) throw new Error("Input is limited to approved sites.");
      check();
      const page = stream.page;
      const timeout = setTimeout(() => this.session.controller.abort(), 15_000);
      try {
      if (input.kind === "click") await page.mouse.click(input.x, input.y, { button: input.button, clickCount: input.count });
      else if (input.kind === "scroll") { await page.mouse.move(input.x, input.y); check(); await page.mouse.wheel(input.deltaX, input.deltaY); }
      else if (input.kind === "text") await page.keyboard.insertText(input.text);
      else if (input.kind === "key") await page.keyboard.press(input.key);
      else await stream.cdp.send("Emulation.setDeviceMetricsOverride", { width: input.width, height: input.height, deviceScaleFactor: input.dpr, mobile: false });
      } finally { clearTimeout(timeout); }
    });
  }
  async openStream(send: (event: string, data: unknown) => boolean) {
    if (this.opening || this.disposed) throw new Error("Live view is not ready. Reconnect in a moment.");
    this.opening = true;
    try { return await this.startStream(send); } finally { this.opening = false; }
  }
  private async startStream(send: (event: string, data: unknown) => boolean) {
    await this.stopStream();
    const page = this.session.page;
    if (!approvedUrl(page.url(), this.session.view.origins)) throw new Error("Open an approved site in Chrome before connecting the live view.");
    const cdp = await this.session.context.newCDPSession(page);
    const id = randomUUID();
    let stopped = false;
    let frameTimer: ReturnType<typeof setTimeout> | undefined;
    let pendingFrame: { id: string; data: string; width: number; height: number } | undefined;
    const stop = async () => {
      if (stopped) return; stopped = true;
      clearInterval(heartbeat); clearTimeout(frameTimer);
      if (this.stream?.id === id) this.stream = undefined;
      send("closed", {});
      await cdp.send("Page.stopScreencast").catch(() => undefined);
      await cdp.send("Emulation.clearDeviceMetricsOverride").catch(() => undefined);
      await cdp.detach().catch(() => undefined);
    };
    const heartbeat = setInterval(() => {
      try { this.assertAccess(); } catch { void stop(); return; }
      if (!send("heartbeat", {}) || page.isClosed() || this.session.lease.mode === "stopped") void stop();
    }, 5000);
    this.stream = { id, page, cdp, stop };
    cdp.on("Page.screencastFrame", (frame) => {
      void cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => undefined);
      if (stopped || !approvedUrl(page.url(), this.session.view.origins)) return;
      pendingFrame = { id, data: frame.data, width: frame.metadata.deviceWidth, height: frame.metadata.deviceHeight };
      if (frameTimer) return;
      frameTimer = setTimeout(() => {
        frameTimer = undefined;
        const image = pendingFrame; pendingFrame = undefined;
        void (async () => {
          this.assertAccess();
          if (this.session.lease.mode === "agent" && (
            /\b(login|signin|sign-in|oauth|authorize|mfa|challenge)\b/i.test(new URL(page.url()).pathname)
            || await page.locator('input[type="password"], input[autocomplete="one-time-code"]').count()
          )) {
            this.session.view.notice = "Sign-in needs human control. Live view paused; open Chrome for private sign-in.";
            void this.session.lease.takeover(); await stop(); return;
          }
          if (!stopped && image && !send("frame", image)) await stop();
        })().catch(() => { void stop(); });
      }, 65);
    });
    send("ready", { id });
    try { await cdp.send("Page.startScreencast", { format: "jpeg", quality: 70, maxWidth: 2560, maxHeight: 1600, everyNthFrame: 1 }); }
    catch (error) { await stop(); throw error; }
    return stop;
  }
  async stopStream() { await this.stream?.stop(); }
  async dispose() {
    this.disposed = true;
    await this.stopStream(); await this.rejectTransfer();
    for (const cdp of this.clients.values()) await cdp.detach().catch(() => undefined);
    this.clients.clear();
  }
}
