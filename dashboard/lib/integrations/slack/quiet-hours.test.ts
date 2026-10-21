import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { slackQuietHours } from "./quiet-hours";

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "slack-quiet-")); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
function save(destinations: unknown[]) {
  fs.mkdirSync(path.join(root, "workflow-alerts"));
  fs.writeFileSync(path.join(root, "workflow-alerts", "state.json"), JSON.stringify({ destinations }));
}
const destination = { provider: "slack", enabled: true, workProfile: "work", quiet: { start: "22:00", end: "07:00", timeZone: "Europe/London" } };

it("keeps existing Slack quiet hours across midnight and time zones", () => {
  save([destination]);
  expect(slackQuietHours("work", new Date("2026-10-21T21:30:00Z"), root)).toBe(true);
  expect(slackQuietHours("work", new Date("2026-10-22T05:30:00Z"), root)).toBe(true);
  expect(slackQuietHours("work", new Date("2026-10-22T06:00:00Z"), root)).toBe(false);
  expect(slackQuietHours("personal", new Date("2026-10-21T21:30:00Z"), root)).toBe(false);
});
it("ignores disabled and removed-provider destinations", () => {
  save([{ ...destination, enabled: false }, { ...destination, provider: "telegram" }]);
  expect(slackQuietHours("work", new Date("2026-10-21T21:30:00Z"), root)).toBe(false);
});
it("allows notifications when no legacy settings exist", () => {
  expect(slackQuietHours("work", new Date(), root)).toBe(false);
});
it("surfaces corrupt persisted settings", () => {
  fs.mkdirSync(path.join(root, "workflow-alerts"));
  fs.writeFileSync(path.join(root, "workflow-alerts", "state.json"), "{");
  expect(() => slackQuietHours("work", new Date(), root)).toThrow();
});
