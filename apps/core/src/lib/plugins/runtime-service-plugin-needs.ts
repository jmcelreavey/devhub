import fs from "node:fs";
import path from "node:path";
import { resolvePluginPaths } from "./paths";
import { listEnabledPlugins } from "./registry";
import { assertSafePath } from "./filesystem";
import type { Severity } from "../../../../../packages/shared/notifications/types";

function text(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.trim() ? value.replace(/\s+/g, " ").trim().slice(0, max) : undefined;
}

/** Read only bounded, safe fields from enabled plugins' attention files. */
export function servicePluginNeeds(current: () => boolean) {
  if (!current()) throw new Error("Service is not authorised");
  const configured = resolvePluginPaths().configDir;
  const root = fs.existsSync(configured) ? fs.realpathSync(configured) : path.resolve(configured);
  const result = listEnabledPlugins(undefined, undefined, { bounded: true }).flatMap(({ name: plugin }) => {
    const file = path.join(root, "plugin-needs", plugin + ".json");
    try {
      assertSafePath(root, file);
      const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | fs.constants.O_NONBLOCK);
      let content: string;
      let createdAt: string;
      try {
        const stat = fs.fstatSync(fd);
        if (!stat.isFile() || stat.size > 256 * 1024) return [];
        createdAt = stat.mtime.toISOString();
        const buffer = Buffer.alloc(256 * 1024 + 1);
        let length = 0;
        while (length < buffer.length) {
          const count = fs.readSync(fd, buffer, length, buffer.length - length, null);
          if (!count) break;
          length += count;
        }
        if (length > 256 * 1024) return [];
        content = buffer.subarray(0, length).toString("utf8");
      } finally { fs.closeSync(fd); }
      const raw: unknown = JSON.parse(content);
      const items = raw && typeof raw === "object" && Array.isArray((raw as { items?: unknown }).items) ? (raw as { items: unknown[] }).items : [];
      return [{ plugin, createdAt, items: items.slice(0, 20).map((value) => {
        const item = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
        const id = text(item.id, 100);
        const title = text(item.title, 200);
        const reason = text(item.reason, 300);
        const candidate = text(item.href, 500);
        const href = candidate?.startsWith("/") && !candidate.startsWith("//") && !candidate.includes("\\") ? candidate : undefined;
        const severity: Severity | undefined = item.severity === "urgent" || item.severity === "action" || item.severity === "info" ? item.severity : undefined;
        return { ...(id ? { id } : {}), ...(title ? { title } : {}), ...(reason ? { reason } : {}), ...(href ? { href } : {}), ...(severity ? { severity } : {}) };
      }) }];
    } catch { return []; }
  });
  if (!current()) throw new Error("Service is not authorised");
  return result;
}
