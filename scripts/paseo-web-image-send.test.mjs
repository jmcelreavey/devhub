import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import { protectImageEncoding } from "./paseo-web-image-send.mjs";

const original = readFileSync(new URL("./fixtures/paseo-web-image-send-0.13.2.txt", import.meta.url), "utf8");
const quiet = { error() {} };
const image = (id) => ({ id, mimeType: "image/png" });

function encoder(source, missing = []) {
  const factory = vm.runInNewContext(`${source};createImageEncoder`, { console: quiet });
  return factory({ getAttachmentStore: async () => ({
    encodeBase64: async ({ attachment }) => {
      if (missing.includes(attachment.id)) throw new Error("missing attachment");
      return `encoded-${attachment.id}`;
    },
  }) });
}

test("a missing image no longer disappears from an otherwise successful send", async () => {
  const images = [image("one"), image("two")];
  const upstream = await encoder(original, ["two"])(images);
  assert.equal(upstream.length, 1);

  const patched = protectImageEncoding(original);
  assert.ok(patched);
  let sent = false;
  let draft = images, text = "Describe this", sendError, processing;
  const subject = vm.runInNewContext(`${patched};({ createImageEncoder, submitAgentInput })`, { console: quiet });
  const encode = subject.createImageEncoder({ getAttachmentStore: async () => ({
    encodeBase64: async ({ attachment }) => {
      if (attachment.id === "two") throw new Error("missing attachment");
      return `encoded-${attachment.id}`;
    },
  }) });
  const result = await subject.submitAgentInput({
    message: text, attachments: images, canSubmit: true,
    setUserInput: (value) => { text = value; },
    setAttachments: (value) => { draft = value; },
    setSendError: (value) => { sendError = value; },
    setIsProcessing: (value) => { processing = value; },
    submitMessage: async ({ attachments }) => { await encode(attachments); sent = true; },
    clearDraft: () => { throw new Error("A failed send must not clear the draft"); },
  });
  assert.equal(result, "failed");
  assert.equal(sent, false);
  assert.equal(draft, images);
  assert.equal(text, "Describe this");
  assert.equal(processing, false);
  assert.match(sendError, /Remove it, then paste it again/);
});

test("all valid images are encoded in order and empty drafts remain empty", async () => {
  const patched = protectImageEncoding(original);
  assert.ok(patched);
  const encode = encoder(patched);
  const result = await encode([image("one"), image("two")]);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), [
    { data: "encoded-one", mimeType: "image/png" },
    { data: "encoded-two", mimeType: "image/png" },
  ]);
  assert.equal(await encode([]), undefined);
});

test("only a single known handler is patched and reinstalling is idempotent", () => {
  const patched = protectImageEncoding(original);
  assert.ok(patched);
  assert.equal(protectImageEncoding(patched), patched);
  assert.equal(protectImageEncoding("unknown"), null);
  assert.equal(protectImageEncoding(original + original), null);
  assert.equal(protectImageEncoding(patched + patched), null);
  assert.equal(protectImageEncoding(patched + original), null);
  assert.doesNotThrow(() => new vm.Script(patched));
});
