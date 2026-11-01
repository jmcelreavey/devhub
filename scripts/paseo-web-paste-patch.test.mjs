import assert from "node:assert/strict";
import { test, afterEach } from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { installPasteGuard, withPasteGuard } from "./paseo-web-paste-patch.mjs";
const { JSDOM } = createRequire(new URL("../apps/ui/package.json", import.meta.url))("jsdom");
let cleanup, dom;
afterEach(() => { cleanup?.(); dom?.window.close(); delete globalThis.window; delete globalThis.document; delete globalThis.requestAnimationFrame; });
function harness(convert, connected = true, fileCount = 1) {
  dom = new JSDOM('<div data-testid="message-input-root"><textarea></textarea><button data-testid="devhub-message-submit">Send</button><button id="stop">Stop</button></div>', { url: "http://localhost:6767/chat/one" });
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  globalThis.requestAnimationFrame = callback => queueMicrotask(callback);
  const input = document.querySelector("textarea"), send = document.querySelector("button"), stop = document.querySelector("#stop");
  const added = [];
  const latest = { current: { isConnected: connected, onAddImages: images => added.push(...images) } };
  const files = Array.from({ length: fileCount }, () => ({ mimeType: "image/png", file: { size: 1234 } }));
  cleanup = installPasteGuard(input, latest, () => files, convert);
  const paste = () => { const event = new window.Event("paste", { cancelable: true }); input.dispatchEvent(event); return event; };
  return { input, send, stop, latest, added, paste };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
test("ordinary rerenders retain conversion; send waits and Stop stays available", async () => {
  let finish;
  const h = harness(() => new Promise(resolve => { finish = resolve; }));
  assert.equal(h.paste().defaultPrevented, true);
  h.latest.current = { ...h.latest.current, disabled: false };
  assert.equal(h.send.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true })), false);
  assert.equal(h.stop.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true })), true);
  finish([{ id: "attachment-one" }]); await settle();
  assert.deepEqual(h.added, [{ id: "attachment-one" }]);
  assert.equal(h.send.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true })), true);
  assert.ok(window.__devhubPasteDiagnostics.some(entry => entry.stage === "added" && entry.attachmentIds[0] === "attachment-one"));
});
test("three rapid pastes all reach the official draft callback", async () => {
  const h = harness(async () => [{ id: "image" }]);
  h.paste(); h.paste(); h.paste(); await settle();
  assert.equal(h.added.length, 3);
  assert.match(document.body.textContent, /ready/);
});
test("disconnected pastes produce visible recovery instead of disappearing", () => {
  const h = harness(async () => [], false); h.paste();
  assert.match(document.querySelector('[role="alert"]').textContent, /Reconnect Paseo/);
  assert.deepEqual(h.added, []);
});
test("a chat switch rejects late conversions without adding to either draft", async () => {
  let finish; const h = harness(() => new Promise(resolve => { finish = resolve; }));
  h.paste(); window.history.pushState({}, "", "/chat/two"); finish([{ id: "late" }]); await settle();
  assert.deepEqual(h.added, []);
  assert.match(document.querySelector('[role="alert"]').textContent, /chat changed/);
});
test("empty conversions stay actionable", async () => {
  const h = harness(async () => []); h.paste(); await settle();
  assert.match(document.querySelector('[role="alert"]').textContent, /attachment picker/);
  assert.equal(h.send.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true })), true);
});
test("partial conversion keeps the successful image and reports the missing one", async () => {
  const h = harness(async () => [{ id: "first-image" }], true, 2); h.paste(); await settle();
  assert.deepEqual(h.added, [{ id: "first-image" }]);
  assert.match(document.querySelector('[role="alert"]').textContent, /attachment picker/);
});
for (const version of ["0.12.0", "0.13.0"]) {
  const source = readFileSync(new URL("./fixtures/paseo-web-paste-" + version + ".txt", import.meta.url), "utf8");
  test("patches the published " + version + " handlers without consulting a release number", () => {
    const patched = withPasteGuard(source);
    assert.ok(patched);
    assert.ok(patched.includes("devhub-message-submit"));
    assert.ok(patched.includes("const latest="));
    assert.equal(withPasteGuard(patched), patched, "reinstallation is idempotent");
    assert.doesNotThrow(() => new vm.Script(patched));
    const jsx = (type, props) => ({ type, props });
    const compiler = { c: size => Array(size) };
    const components = { Tooltip: "tooltip", TooltipTrigger: "control", TooltipContent: "hint" };
    const submit = vm.runInNewContext(patched + (version === "0.12.0" ? ";he" : ";fe"), {
      c: compiler, n: compiler, q: { jsx, jsxs: jsx }, G: { jsx, jsxs: jsx },
      B: components, w: components, re: "icon", se: "icon", oe: "label",
    });
    const send = () => {}, stop = () => {};
    const props = { shouldShow: true, canPressLoadingButton: false, onDefaultSendAction: send,
      onSubmitLoadingPress: stop, buttonIconSize: 16, sendButtonCombinedStyle: {} };
    const sendControl = submit(props).props.children[0].props;
    assert.equal(sendControl.testID, "devhub-message-submit");
    assert.equal(sendControl.onPress, send);
    const stopControl = submit({ ...props, canPressLoadingButton: true }).props.children[0].props;
    assert.equal(stopControl.testID, undefined, "Stop must never acquire the send-blocking marker");
    assert.equal(stopControl.onPress, stop);
  });
  test("rejects changed, duplicate and incomplete " + version + " handlers", () => {
    assert.equal(withPasteGuard(source.replace("filesToImageAttachments", "differentConversion")), null);
    assert.equal(withPasteGuard(source + source), null);
    assert.equal(withPasteGuard(source.replace("let e=!1", "let e=!0")), null);
    assert.equal(withPasteGuard(source + "\n" + source.split("\n")[2]), null);
    assert.equal(withPasteGuard(source.replace("onDefaultSendAction:", "differentSendAction:")), null);
    const patched = withPasteGuard(source);
    assert.equal(withPasteGuard(patched.replace("/* devhub-paste-v1:end */", "")), null);
    assert.equal(withPasteGuard(patched + "/* devhub-paste-v1:start */"), null);
  });
}
test("unknown bundles keep native paste", () => {
  assert.equal(withPasteGuard("upstream"), null);
});
