import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import { withDevHubBootstrap } from "./paseo-web-bootstrap.mjs";

test("embedded Paseo saves DevHub's local connection before starting its app", () => {
  const html = withDevHubBootstrap('<script src="/_expo/static/js/web/index-test.js" defer></script>');
  assert.equal(withDevHubBootstrap(html), html);
  const bootstrap = html.match(/<script data-devhub-paseo-bootstrap>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(bootstrap);
  const listeners = new Map();
  const storage = new Map();
  const loaded = [];
  const posted = [];
  const parent = { postMessage: (...args) => posted.push(args) };
  const window = {
    parent,
    location: { host: "localhost:6767", hostname: "localhost", port: "6767", protocol: "http:" },
    addEventListener: (type, callback) => listeners.set(type, callback),
  };
  const document = { createElement: () => ({}), body: { appendChild: script => loaded.push(script.src) } };
  vm.runInNewContext(bootstrap, {
    window, document, localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    URL, setTimeout: () => 1, clearTimeout: () => {}, setInterval: () => 2, clearInterval: () => {}, console,
  });
  assert.equal(posted[0][0].type, "devhub:paseo:ready");
  listeners.get("message")({ source: parent, origin: "http://attacker.test", data: { type: "devhub:paseo:credentials", serverId: "srv_test", password: "test-secret" } });
  assert.equal(storage.size, 0);
  listeners.get("message")({ source: parent, origin: "http://localhost:1337", data: { type: "devhub:paseo:credentials", serverId: "srv_test", password: "test-secret" } });
  assert.deepEqual(loaded, ["/_expo/static/js/web/index-test.js"]);
  const host = JSON.parse(storage.get("@paseo:daemon-registry"))[0];
  assert.equal(host.serverId, "srv_test");
  assert.equal(host.connections[0].endpoint, "localhost:6767");
  assert.equal(host.connections[0].password, "test-secret");
});

test("re-patching an older bootstrap keeps Paseo's bundle and picks up the new script", () => {
  const html = withDevHubBootstrap('<script src="/_expo/static/js/web/index-test.js" defer></script>');
  const stale = html.replace(/<script data-devhub-paseo-bootstrap>[\s\S]*?<\/script>/, '<script data-devhub-paseo-bootstrap>\n(() => {\n  const bundle = "/_expo/static/js/web/index-test.js";\n})();\n</script>');
  assert.equal(withDevHubBootstrap(stale), html);
});

test("embedded Paseo routes confirm prompts to DevHub only when asked", async () => {
  const html = withDevHubBootstrap('<script src="/_expo/static/js/web/index-test.js" defer></script>');
  const bootstrap = html.match(/<script data-devhub-paseo-bootstrap>([\s\S]*?)<\/script>/)?.[1];
  const listeners = new Map();
  const posted = [];
  const parent = { postMessage: (...args) => posted.push(args) };
  const nativeConfirm = () => false;
  const window = {
    parent, confirm: nativeConfirm,
    location: { host: "localhost:6767", hostname: "localhost", port: "6767", protocol: "http:" },
    addEventListener: (type, callback) => listeners.set(type, callback),
  };
  const document = { createElement: () => ({}), body: { appendChild: () => {} }, addEventListener: () => {} };
  vm.runInNewContext(bootstrap, {
    window, document, localStorage: { getItem: () => null, setItem: () => {} },
    URL, setTimeout: () => 1, clearTimeout: () => {}, setInterval: () => 2, clearInterval: () => {}, console,
  });
  const message = listeners.get("message");
  message({ source: parent, origin: "http://localhost:1337", data: { type: "devhub:paseo:skip", bridgeConfirm: false } });
  assert.equal(window.confirm, nativeConfirm);
  message({ source: parent, origin: "http://localhost:1337", data: { type: "devhub:paseo:skip", bridgeConfirm: true } });
  const answer = window.confirm("Archive project?\n\nSure?");
  const [request, target] = posted.at(-1);
  assert.deepEqual({ ...request }, { type: "devhub:paseo:confirm", id: 1, message: "Archive project?\n\nSure?" });
  assert.equal(target, "http://localhost:1337");
  message({ source: {}, origin: "http://localhost:1337", data: { type: "devhub:paseo:confirm-result", id: 1, ok: false } });
  message({ source: parent, origin: "http://localhost:1337", data: { type: "devhub:paseo:confirm-result", id: 1, ok: true } });
  assert.equal(await answer, true);
});

test("embedded Paseo hands external links to DevHub only on desktop", () => {
  const html = withDevHubBootstrap('<script src="/_expo/static/js/web/index-test.js" defer></script>');
  const bootstrap = html.match(/<script data-devhub-paseo-bootstrap>([\s\S]*?)<\/script>/)?.[1];
  const listeners = new Map();
  const clicks = [];
  const posted = [];
  const opened = [];
  const parent = { postMessage: (...args) => posted.push(args) };
  const window = {
    parent, open: (...args) => { opened.push(args); return {}; },
    location: { host: "localhost:6767", hostname: "localhost", port: "6767", protocol: "http:", origin: "http://localhost:6767", href: "http://localhost:6767/" },
    addEventListener: (type, callback) => listeners.set(type, callback),
  };
  const document = { createElement: () => ({}), body: { appendChild: () => {} }, addEventListener: (type, callback) => clicks.push([type, callback]) };
  vm.runInNewContext(bootstrap, {
    window, document, localStorage: { getItem: () => null, setItem: () => {} },
    URL, setTimeout: () => 1, clearTimeout: () => {}, setInterval: () => 2, clearInterval: () => {}, console,
  });
  const message = listeners.get("message");
  const opens = () => posted.filter(([request]) => request.type === "devhub:paseo:open-link").map(([request, target]) => [request.url, target]);
  const nativeOpen = window.open;

  message({ source: parent, origin: "http://localhost:1337", data: { type: "devhub:paseo:skip", bridgeConfirm: false } });
  assert.equal(window.open, nativeOpen);
  assert.equal(clicks.length, 0);

  message({ source: parent, origin: "http://localhost:1337", data: { type: "devhub:paseo:skip", bridgeConfirm: true } });
  message({ source: parent, origin: "http://localhost:1337", data: { type: "devhub:paseo:skip", bridgeConfirm: true } });
  assert.equal(clicks.length, 1, "bridged once, however many times DevHub answers");

  assert.equal(window.open("https://example.com/pr/1", "_blank", "noopener,noreferrer"), null);
  assert.deepEqual(opens(), [["https://example.com/pr/1", "http://localhost:1337"]]);

  // Paseo's own pages, other schemes and same-window navigation are left alone.
  window.open("http://localhost:6767/h/srv/workspace/1", "_blank");
  window.open("mailto:a@example.com", "_blank");
  window.open("https://example.com/", "_self");
  assert.equal(opens().length, 1);
  assert.equal(opened.length, 3);

  // A tap reaches the anchor and Paseo's press handler; it must open once.
  const [, onClick] = clicks[0];
  let prevented = 0;
  const click = href => ({ button: 0, defaultPrevented: false, target: { closest: () => ({ href }) }, preventDefault: () => prevented++, stopPropagation: () => {} });
  onClick(click("https://example.com/docs"));
  window.open("https://example.com/docs", "_blank");
  assert.deepEqual(opens().map(([url]) => url), ["https://example.com/pr/1", "https://example.com/docs"]);
  assert.equal(prevented, 1);

  onClick(click("http://localhost:6767/settings"));
  onClick({ ...click("https://example.com/x"), button: 1 });
  onClick({ ...click("https://example.com/x"), defaultPrevented: true });
  assert.equal(prevented, 1);
  assert.equal(opens().length, 2);
});
