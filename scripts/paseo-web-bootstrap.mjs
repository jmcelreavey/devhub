import fs from "node:fs";
import path from "node:path";
import { withPasteGuard } from "./paseo-web-paste-patch.mjs";
import { gzipSync, brotliCompressSync, constants } from "node:zlib";
import { createHash } from "node:crypto";

const marker = "data-devhub-paseo-bootstrap";

/** The daemon-served UI has no password bootstrap API; its normal host registry is browser-local. */
export function withDevHubBootstrap(html, bundleVersion) {
  // Re-patch an already patched page so bootstrap fixes reach existing installs, not only fresh Paseo versions.
  const patched = html.match(new RegExp(`<script ${marker}>[\\s\\S]*?</script>`));
  const entry = patched
    ? patched[0].match(/const bundle = ("\/_expo\/static\/js\/web\/[^"]+\.js(?:\?[^"]*)?");/)
    : html.match(/<script src="(\/_expo\/static\/js\/web\/[^"]+\.js(?:\?[^"]*)?)" defer><\/script>/);
  if (!entry) throw new Error("Paseo's web UI entry point changed; cannot enable DevHub connection bootstrap.");
  const originalBundle = patched ? JSON.parse(entry[1]) : entry[1];
  const bundle = bundleVersion ? originalBundle.split("?")[0] + "?devhub=" + bundleVersion : originalBundle;
  const script = `<script ${marker}>
(() => {
  const bundle = ${JSON.stringify(bundle)};
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    const script = document.createElement("script");
    script.src = bundle;
    document.body.appendChild(script);
  };
  if (window.parent === window) { start(); return; }
  const timer = setTimeout(() => { clearInterval(retry); start(); }, 5000);
  const request = () => window.parent.postMessage({ type: "devhub:paseo:ready" }, "*");
  const retry = setInterval(request, 250);
  // The desktop webview answers window.confirm() with false and shows nothing, so
  // DevHub asks instead. Paseo awaits its confirm result, so a Promise is enough.
  const confirms = new Map();
  let confirmId = 0;
  const bridgeConfirm = parentOrigin => {
    window.confirm = message => new Promise(resolve => {
      const id = ++confirmId;
      confirms.set(id, resolve);
      window.parent.postMessage({ type: "devhub:paseo:confirm", id, message: String(message ?? "") }, parentOrigin);
    });
  };
  // The same webview blocks window.open() just as quietly, so a link in a chat never
  // opens. DevHub opens external links in the system browser instead.
  let linksBridged = false;
  const bridgeLinks = parentOrigin => {
    if (linksBridged) return;
    linksBridged = true;
    const external = raw => {
      try {
        const url = new URL(String(raw), window.location.href);
        return (url.protocol === "http:" || url.protocol === "https:") && url.origin !== window.location.origin ? url.href : null;
      } catch { return null; }
    };
    let last = { href: "", at: 0 };
    const send = href => {
      // One tap can reach both the anchor and Paseo's own press handler.
      const now = Date.now();
      if (href === last.href && now - last.at < 500) return;
      last = { href, at: now };
      window.parent.postMessage({ type: "devhub:paseo:open-link", url: href }, parentOrigin);
    };
    document.addEventListener("click", event => {
      if (event.defaultPrevented || event.button !== 0) return;
      const anchor = event.target?.closest?.("a[href]");
      const href = anchor ? external(anchor.href) : null;
      if (!href) return;
      event.preventDefault();
      event.stopPropagation();
      send(href);
    }, true);
    const open = window.open?.bind(window);
    window.open = (url, target, features) => {
      const href = url ? external(url) : null;
      if (!href || target === "_self" || target === "_parent" || target === "_top") return open?.(url, target, features) ?? null;
      send(href);
      return null;
    };
  };
  let chromeBridged = false;
  const bridgeChrome = parentOrigin => {
    if (chromeBridged) return;
    chromeBridged = true;
    const reportLocation = () => window.parent.postMessage({ type: "devhub:paseo:location", url: window.location.href }, parentOrigin);
    for (const method of ["pushState", "replaceState"]) {
      if (!window.history?.[method]) continue;
      const original = window.history[method].bind(window.history);
      window.history[method] = (...args) => { const result = original(...args); reportLocation(); return result; };
    }
    window.addEventListener("popstate", reportLocation);
    window.addEventListener("hashchange", reportLocation);
    reportLocation();
    let pending = false, last = "";
    const appearance = () => {
      pending = false;
      if (!window.getComputedStyle) return;
      const composer = Array.from(document.querySelectorAll?.('[data-testid="message-input-root"]') || []).find(element => element.getClientRects().length > 0);
      // Retained chat tabs can keep their old theme while a plugin panel is visible.
      let element = composer || document.elementFromPoint?.(Math.floor(window.innerWidth * .75), Math.min(100, window.innerHeight - 1)) || document.querySelector?.("#root")?.firstElementChild || document.body;
      while (element) {
        const background = window.getComputedStyle(element).backgroundColor;
        if (background && background !== "transparent" && background !== "rgba(0, 0, 0, 0)") {
          if (last !== background) window.parent.postMessage({ type: "devhub:paseo:appearance", background }, parentOrigin);
          last = background;
          return;
        }
        element = element.parentElement;
      }
    };
    const scheduleAppearance = () => {
      if (pending) return;
      pending = true;
      (window.requestAnimationFrame || (callback => setTimeout(callback, 0)))(appearance);
    };
    if (typeof MutationObserver !== "undefined" && document.documentElement) new MutationObserver(scheduleAppearance).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "style"] });
    scheduleAppearance();
  };
  window.addEventListener("message", event => {
    if (event.source !== window.parent) return;
    let sender;
    try { sender = new URL(event.origin); } catch { return; }
    if (sender.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(sender.hostname)) return;
    const data = event.data;
    if (data?.type === "devhub:paseo:confirm-result") {
      const resolve = confirms.get(data.id);
      confirms.delete(data.id);
      resolve?.(data.ok === true);
      return;
    }
    if (data?.type === "devhub:paseo:skip" || data?.type === "devhub:paseo:credentials") bridgeChrome(event.origin);
    if (data?.bridgeConfirm === true && (data.type === "devhub:paseo:skip" || data.type === "devhub:paseo:credentials")) {
      bridgeConfirm(event.origin);
      bridgeLinks(event.origin);
    }
    if (data?.type === "devhub:paseo:skip") { clearTimeout(timer); clearInterval(retry); start(); return; }
    if (data?.type !== "devhub:paseo:credentials" || typeof data.password !== "string" || !data.password ||
        typeof data.serverId !== "string" || !/^srv_[A-Za-z0-9_-]+$/.test(data.serverId)) return;
    try {
      const endpoint = (window.location.hostname === "127.0.0.1" ? "localhost" : window.location.hostname) + ":" + window.location.port;
      const now = new Date().toISOString();
      const key = "@paseo:daemon-registry";
      const stored = JSON.parse(localStorage.getItem(key) || "[]");
      if (!Array.isArray(stored)) throw new Error("Invalid Paseo host registry");
      const connection = { id: "direct:" + endpoint, type: "directTcp", endpoint, useTls: window.location.protocol === "https:", password: data.password };
      const index = stored.findIndex(host => host?.serverId === data.serverId || host?.connections?.some(item => item?.type === "directTcp" && item.endpoint === endpoint));
      const current = index >= 0 ? stored[index] : {};
      const connections = (current.connections || []).filter(item => item?.id !== connection.id && item?.endpoint !== endpoint);
      const host = { ...current, serverId: data.serverId, label: current.label || "Local Paseo", appearance: current.appearance || { color: "none", badgeDisplay: null }, lifecycle: current.lifecycle || {}, connections: [...connections, connection], preferredConnectionId: connection.id, createdAt: current.createdAt || now, updatedAt: now };
      if (index >= 0) stored.splice(index, 1, host); else stored.unshift(host);
      localStorage.setItem(key, JSON.stringify(stored));
    } catch (error) { console.warn("Could not save the DevHub Paseo connection", error); }
    clearTimeout(timer);
    clearInterval(retry);
    start();
  });
  request();
})();
</script>`;
  return html.replace(patched ? patched[0] : entry[0], () => script);
}

export function installDevHubBootstrap(root) {
  const file = path.join(root, "node_modules", "@getpaseo", "server", "dist", "server", "web-ui", "index.html");
  const current = fs.readFileSync(file, "utf8");
  const entry = current.match(/\/_expo\/static\/js\/web\/[^"\s?]+\.js/);
  let pasteVersion;
  if (entry) {
    const bundleFile = path.join(path.dirname(file), entry[0]);
    const bundle = fs.readFileSync(bundleFile, "utf8");
    const patched = withPasteGuard(bundle);
    if (patched !== null) {
      if (!fs.existsSync(bundleFile + ".devhub-original")) fs.writeFileSync(bundleFile + ".devhub-original", bundle);
      if (patched !== bundle) fs.writeFileSync(bundleFile, patched);
      // Paseo serves the precompressed sibling before the plain JS file.
      for (const [extension, compress] of [[".gz", gzipSync], [".br", bytes => brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } })]]) {
        const compressed = bundleFile + extension;
        if (fs.existsSync(compressed) && fs.statSync(compressed).mtimeMs < fs.statSync(bundleFile).mtimeMs) {
          if (!fs.existsSync(compressed + ".devhub-original")) fs.copyFileSync(compressed, compressed + ".devhub-original");
          const temporary = compressed + ".devhub-tmp";
          fs.writeFileSync(temporary, compress(Buffer.from(patched)));
          fs.renameSync(temporary, compressed);
        }
      }
      pasteVersion = "paste-v1-" + createHash("sha256").update(patched).digest("hex").slice(0, 12);
    } else console.warn("Paseo web paste adapter skipped: changed or ambiguous upstream handlers. Native paste remains available.");
  }
  const updated = withDevHubBootstrap(current, pasteVersion);
  if (updated !== current) fs.writeFileSync(file, updated);
}

/** Run before reverting this adapter; active conversations and the daemon stay up. */
export function restoreDevHubPasteGuard(root) {
  const file = path.join(root, "node_modules", "@getpaseo", "server", "dist", "server", "web-ui", "index.html");
  const html = fs.readFileSync(file, "utf8");
  const entry = html.match(/\/_expo\/static\/js\/web\/[^"\s?]+\.js/);
  if (!entry) throw new Error("Paseo web entry point changed.");
  const bundle = path.join(path.dirname(file), entry[0]);
  const original = fs.readFileSync(bundle + ".devhub-original", "utf8");
  if (withPasteGuard(original) !== fs.readFileSync(bundle, "utf8")) throw new Error("Paseo's bundle changed after installation; reinstall the currently installed Paseo release to restore it.");
  fs.writeFileSync(bundle, original);
  for (const extension of [".gz", ".br"]) if (fs.existsSync(bundle + extension + ".devhub-original")) fs.copyFileSync(bundle + extension + ".devhub-original", bundle + extension);
  fs.writeFileSync(file, withDevHubBootstrap(html, "restored-" + createHash("sha256").update(original).digest("hex").slice(0, 12)));
}
