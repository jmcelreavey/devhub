import assert from "node:assert/strict";
import test from "node:test";
import rawMarkdown from "./markdown-loader.cjs";

test("bundles Markdown as a string without interpreting its contents", async () => {
  const markdown = '## 2.0.4 — 2026-10-10\n\n- Quotes " and `code`.\n<script>throw new Error("never execute");</script>';
  const module = await import(`data:text/javascript;base64,${Buffer.from(rawMarkdown(markdown)).toString("base64")}`);
  assert.equal(module.default, markdown);
});
