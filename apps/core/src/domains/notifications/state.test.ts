import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import type { Notification } from "../../../../../packages/shared/notifications/types";
import { applyNotificationState, filterBySourcePrefs, filterOwnedNotifications, readNotificationSourcePrefs, updateNotificationState, writeNotificationSourcePrefs } from "./state";
import { pluginNotifications } from "./sources";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const item = (id = "one", version = "v1"): Notification => ({ id, version, source: "github", severity: "action", title: id, link: "/prs", createdAt: "2026-01-01T00:00:00Z", read: false, dismissed: false });
it("isolates profiles and resurfaces changed versions; prunes old state and caps writes", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "notification-state-")); roots.push(root);
  const file = path.join(root, "state.json"), now = Date.now();
  await updateNotificationState("work", [item()], ["one"], "read", file, now);
  await updateNotificationState("work", [item()], ["one"], "dismiss", file, now);
  expect(applyNotificationState([item()], "work", file)[0]).toMatchObject({ read: true, dismissed: true });
  expect(applyNotificationState([item()], "home", file)[0].read).toBe(false);
  expect(applyNotificationState([item("one", "v2")], "work", file)[0]).toMatchObject({ read: false, dismissed: false });
  await updateNotificationState("work", [item()], ["one"], "restore", file, now);
  expect(applyNotificationState([item()], "work", file)[0].dismissed).toBe(false);
  await updateNotificationState("work", [], [], "read", file, now + 31 * 86_400_000);
  expect(JSON.parse(fs.readFileSync(file, "utf8")).profiles.work).toEqual({});
  const many = Array.from({ length: 510 }, (_, i) => item(String(i)));
  await updateNotificationState("work", many, many.map(row => row.id), "read", file, now);
  expect(Object.keys(JSON.parse(fs.readFileSync(file, "utf8")).profiles.work)).toHaveLength(500);
});
it("source prefs default on, filter predictable sources, preserve the toggle mapping and round-trip", async () => {
  expect(readNotificationSourcePrefs("/nonexistent/prefs.json")).toEqual({ github: true, ci: true, agent: true, plugin: true, datadog: true });
  const items = [item("github"), { ...item("ci"), source: "ci" as const }, { ...item("agent"), source: "agent" as const }, { ...item("plugin"), source: "plugin" as const }, { ...item("trust"), source: "plugin-trust" as const }, { ...item("dd"), source: "datadog" as const }];
  expect(filterBySourcePrefs(items, { github: true, ci: true, agent: true, plugin: false, datadog: true }).map(row => row.id)).toEqual(["github", "ci", "agent", "dd"]);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "notification-prefs-")); roots.push(root);
  const file = path.join(root, "ui-prefs.json");
  await writeNotificationSourcePrefs({ agent: false }, file);
  await writeNotificationSourcePrefs({}, file);
  expect(readNotificationSourcePrefs(file)).toEqual({ github: true, ci: true, agent: false, plugin: true, datadog: true });
  expect(JSON.parse(fs.readFileSync(file, "utf8"))).toMatchObject({ notificationSources: { agent: false } });
});
it("keeps everything when ownership is unknown and preserves items without a repo", () => {
  const items = [{ ...item(), repo: "mine/repo" }, { ...item("other"), repo: "other/repo" }, item("agent")];
  expect(filterOwnedNotifications(items, null)).toEqual(items);
  expect(filterOwnedNotifications(items, ["MINE"]).map(row => row.id)).toEqual(["one", "agent"]);
});
it("downgrades untrusted urgent items and limits each trusted plugin to three", () => {
  const groups = [{ plugin: "fixture", createdAt: item().createdAt, items: Array.from({ length: 5 }, (_, i) => ({ id: String(i), title: "Blocked", href: "/plugins", severity: "urgent" as const })) }];
  expect(pluginNotifications(groups, new Set()).every(row => row.severity === "action")).toBe(true);
  expect(pluginNotifications(groups, new Set(["fixture"])).filter(row => row.severity === "urgent")).toHaveLength(3);
});
