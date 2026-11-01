import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

test("the busy-port wait pauses the boot counter", async () => {
  const html = fs.readFileSync(new URL("../boot/index.html", import.meta.url), "utf8");
  const script = html.match(/<script\s+type="module">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  const elements = new Map();
  const getElementById = (id) => {
    if (!elements.has(id)) {
      elements.set(id, {
        dataset: {},
        classList: { toggle() {}, add() {} },
        addEventListener() {},
        focus() {},
      });
    }
    return elements.get(id);
  };
  const listeners = new Map();
  const window = {
    __TAURI__: {
      core: {
        invoke(command) {
          return Promise.resolve(command === "boot_state" ? { state: "preparing" } : []);
        },
      },
      event: {
        listen(name, callback) {
          listeners.set(name, callback);
          return Promise.resolve();
        },
      },
    },
  };
  let now = 0;
  vm.runInNewContext(script, {
    window,
    document: { getElementById },
    Date: { now: () => now },
    setInterval() {},
    setTimeout() {},
    clearInterval() {},
  });
  await new Promise(setImmediate);
  const emit = (service) => listeners.get("devhub://boot")({ payload: { state: "starting", service } });
  const detail = getElementById("detail");
  now = 5000;
  emit("wsl-wait");
  assert.match(detail.textContent, /\(5s\)$/);
  now = 65000;
  emit("wsl-wait");
  assert.match(detail.textContent, /\(5s\)$/);
  emit("wsl");
  now = 67000;
  emit("wsl");
  assert.match(detail.textContent, /\(7s\)$/);
});
