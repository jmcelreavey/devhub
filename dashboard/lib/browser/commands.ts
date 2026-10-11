import { randomUUID, createHash } from "node:crypto";
import { currentBrowser, assertBrowserRun, type ManagedBrowser } from "./runtime";
import { approvedUrl, validatePublicSite } from "./policy";
import type { BrowserAction, BrowserObservation } from "./types";

async function controlled<T>(session: ManagedBrowser, token: string, work: (check: () => void) => Promise<T>) {
  return session.lease.execute(token, async (check) => {
    // Closing the owned process cancels CDP operations, including a renderer that never replies.
    const timer = setTimeout(() => session.controller.abort(), 15_000);
    try { return await work(() => { check(); currentBrowser(session.view.id); }); } finally { clearTimeout(timer); }
  });
}
function clearObservation(session: ManagedBrowser) {
  session.observation = undefined;
  for (const handle of session.handles.values()) void handle.dispose().catch(() => undefined);
  session.handles.clear(); session.signatures.clear();
}
async function safePage(session: ManagedBrowser) {
  if (!approvedUrl(session.page.url(), session.view.origins)) throw new Error("Navigate to an approved site before observing.");
  if (/\b(login|signin|sign-in|oauth|authorize|mfa|challenge)\b/i.test(new URL(session.page.url()).pathname)
    || await session.page.locator('input[type="password"], input[autocomplete="one-time-code"]').count()) {
    session.view.pending = undefined; clearObservation(session);
    // Do not await takeover inside the active operation: it waits for this operation.
    void session.lease.takeover();
    throw new Error("Sign-in needs human control. Capture is disabled; resume from DevHub after signing in.");
  }
}
async function observePage(session: ManagedBrowser, check: () => void): Promise<BrowserObservation> {
  await safePage(session);
  clearObservation(session);
  // Fixed inspection code; page-authored JavaScript and selectors are never accepted as tool input.
  const candidates = session.page.locator('a[href],button,input:not([type="hidden"]):not([type="password"]):not([type="file"]),textarea,select,[role="button"],[role="link"]');
  const elements = [];
  const count = Math.min(await candidates.count(), 80);
  const deadline = Date.now() + 8000;
  for (let index = 0; index < count; index++) {
    check();
    if (Date.now() > deadline) break;
    const candidate = candidates.nth(index);
    if (!await candidate.isVisible()) continue;
    const info = await candidate.evaluate((node) => ({
      role: node.getAttribute("role") || node.tagName.toLowerCase(),
      name: (node.getAttribute("aria-label") || node.getAttribute("placeholder") || node.textContent || "").trim().slice(0, 160),
    }));
    const id = randomUUID();
    // Element handles bind the exact node. A rerender cannot retarget an approved click.
    const handle = await candidate.elementHandle();
    if (!handle) continue;
    session.handles.set(id, handle);
    session.signatures.set(id, createHash("sha256").update(await handle.evaluate((node) => node.outerHTML)).digest("hex"));
    elements.push({ id, ...info });
  }
  check();
  await safePage(session);
  const text = await session.page.locator("body").innerText({ timeout: 2000 });
  const observation: BrowserObservation = { id: randomUUID(), url: session.page.url(), text: text.slice(0, 16000), elements, at: Date.now() };
  session.observation = observation;
  return observation;
}
function validateObservation(session: ManagedBrowser, action: Exclude<BrowserAction, { kind: "navigate" }>) {
  const observation = session.observation;
  if (!observation || observation.id !== action.observation || observation.url !== session.page.url() || Date.now() - observation.at > 60_000) throw new Error("The page changed or the observation expired. Observe again.");
  const element = observation.elements.find((item) => item.id === action.target);
  if (!element || !session.handles.has(action.target)) throw new Error("That element is no longer available. Observe again.");
  return element;
}
export function browserCredential(taskId: string, runId: string) {
  const session = currentBrowser();
  if (session.view.taskId !== taskId || session.view.runId !== runId) throw new Error("This task and run do not own browser access.");
  assertBrowserRun(taskId, runId);
  return { sessionId: session.view.id, lease: session.lease.credential(), expiresAt: session.lease.expiresAt, origins: session.view.origins };
}
export async function browserObserve(id: string, token: string) {
  const session = currentBrowser(id);
  return controlled(session, token, async (check) => { await safePage(session); check(); return observePage(session, check); });
}
export async function browserRequest(id: string, token: string, action: BrowserAction) {
  const session = currentBrowser(id);
  return controlled(session, token, async (check) => {
    if (session.view.pending) throw new Error("An action already awaits approval.");
    if (action.kind === "navigate") {
      if (!approvedUrl(action.url, session.view.origins)) throw new Error("That site was not approved.");
      await validatePublicSite(new URL(action.url).origin); check();
      clearObservation(session);
      await session.page.goto(action.url, { waitUntil: "domcontentloaded", timeout: 8000 });
      check();
      return observePage(session, check);
    }
    await safePage(session); check();
    const element = validateObservation(session, action);
    const proposal = { id: randomUUID(), action, label: (action.kind === "click" ? "Click " : "Type into ") + (element.name || element.role), url: session.page.url(), expiresAt: Date.now() + 60_000 };
    session.view.pending = proposal;
    return { awaitingApproval: true, proposal };
  });
}
export async function approveBrowserAction(id: string, proposalId: string) {
  const session = currentBrowser(id);
  const proposal = session.view.pending;
  if (!proposal || proposal.id !== proposalId || proposal.expiresAt <= Date.now()) throw new Error("This action expired or was already handled.");
  session.view.pending = undefined;
  const token = session.lease.credential();
  return controlled(session, token, async (check) => {
    let dispatched = false;
    try {
      await safePage(session); check();
      const action = proposal.action;
      if (action.kind === "navigate") throw new Error("Invalid approval.");
      validateObservation(session, action);
      const handle = session.handles.get(action.target)!;
      const signature = createHash("sha256").update(await handle.evaluate((node) => node.outerHTML)).digest("hex");
      if (signature !== session.signatures.get(action.target)) throw new Error("The approved element changed. Observe again.");
      const sensitive = await handle.evaluate((node) => node instanceof HTMLInputElement && ["password", "file", "hidden"].includes(node.type));
      if (sensitive) throw new Error("Handle credentials and uploads in the Chrome window.");
      check();
      dispatched = true;
      if (action.kind === "click") await handle.click({ timeout: 2500, noWaitAfter: true });
      else await handle.fill(action.text, { timeout: 2500 });
      check();
      session.view.receipt = { id: proposal.id, status: "done", message: "The approved action ran. Observe the page before continuing." };
    } catch {
      session.view.receipt = { id: proposal.id, status: dispatched ? "unknown" : "failed", message: dispatched ? "The action may have reached the site. Check the page before requesting it again." : "The page changed or control was revoked. No input was sent; observe again." };
    } finally { clearObservation(session); }
    return session.view.receipt;
  });
}
export async function takeBrowserControl(id: string) {
  const session = currentBrowser(id);
  session.view.pending = undefined;
  await session.lease.takeover();
  clearObservation(session);
}
export async function resumeBrowser(id: string) {
  const session = currentBrowser(id);
  const revision = await session.lease.takeover();
  await session.surface?.rejectTransfer();
  if (session.view.dialog) throw new Error("Answer the website dialog before resuming.");
  await safePage(session);
  clearObservation(session); session.view.pending = undefined;
  // A newer takeover/stop wins even while the page inspection is awaiting CDP.
  session.lease.grant(revision);
  const granted = session.lease.revision;
  try { return await browserObserve(id, session.lease.credential()); }
  catch (error) { if (session.lease.revision === granted) await session.lease.takeover(); throw error; }
}
export async function browserScreenshot(id: string) {
  const session = currentBrowser(id);
  return controlled(session, session.lease.credential(), async (check) => {
    await safePage(session); check();
    return session.page.screenshot({ type: "jpeg", quality: 55, timeout: 2500, animations: "disabled" });
  });
}
export async function watchBrowser(id: string) {
  const session = currentBrowser(id);
  await takeBrowserControl(id);
  await session.surface?.stopStream();
  await session.page.bringToFront();
}
