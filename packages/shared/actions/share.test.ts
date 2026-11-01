import { expect, test } from "vitest";
import { shareOneTimeInput, shareMarkdownInput } from "./share.ts";

test("one-time links accept only generated-password intent and bounded raw patches", () => {
  expect(shareOneTimeInput.parse({ path: "fixture" })).toMatchObject({ vault: "notes", password: true, expire: "1day" });
  expect(shareOneTimeInput.safeParse({ path: "fixture", password: "caller-secret" }).success).toBe(false);
  expect(shareOneTimeInput.safeParse({ path: "fixture", expire: "forever" }).success).toBe(false);
  expect(shareMarkdownInput.safeParse({ title: "Fixture", markdown: "x".repeat(1_000_001) }).success).toBe(false);
});
