import { existsSync, readdirSync, statSync, watch, type FSWatcher } from "node:fs";
import path from "node:path";
import { subscribeCoreEvents, type CoreEventDomain } from "./core-events.ts";

/** Watch the storage roots, including atomic replacements and writes by other processes. */
export interface EventRoot {
  path: string;
  domain: "tasks" | "notes" | "collections" | "runs" | "orchestrations" | "logs" | "git" | "rebuild" | "plugins" | "plugin-operations" | "reps" | "script-history" | "skill-proposals" | "cli-updates" | "projects" | "recall" | "shares" | "ownership" | CoreEventDomain;
  files?: readonly string[];
  recursive?: boolean;
  ignore?: (relativePath: string) => boolean;
  optional?: boolean;
  reconnect?: boolean;
  validate?: () => boolean;
}

export function taskEventStream(roots: EventRoot[], signal: AbortSignal): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const watchers: FSWatcher[] = [];
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  let readiness: ReturnType<typeof setTimeout> | undefined;
  const pending = new Map<EventRoot["domain"], ReturnType<typeof setTimeout>>();
  const degraded = new Set<EventRoot["domain"]>();
  let closed = false;
  let ready = false;
  let finish = () => {};
  let unsubscribe = () => {};

  const cleanup = () => {
    closed = true;
    watchers.forEach((watcher) => watcher.close());
    unsubscribe();
    clearInterval(heartbeat);
    clearTimeout(expiry);
    clearTimeout(readiness);
    pending.forEach(clearTimeout);
    pending.clear();
    signal.removeEventListener("abort", finish);
  };

  return new ReadableStream({
    start(controller) {
      finish = () => {
        if (closed) return;
        cleanup();
        controller.close();
      };
      const send = (frame: string) => {
        if (closed) return;
        // A stalled reader must reconnect and fetch a snapshot, not grow a queue.
        if ((controller.desiredSize ?? 0) <= 0) return finish();
        controller.enqueue(encoder.encode(frame));
      };
      const invalidate = (domain: EventRoot["domain"]) => {
        if (!ready || pending.has(domain)) return;
        pending.set(domain, setTimeout(() => {
          pending.delete(domain);
          send(`event: invalidate\ndata: {"domain":"${domain}"}\n\n`);
        }, 100));
      };
      const degrade = (domain: EventRoot["domain"], error: unknown) => {
        console.error(`[events] Cannot watch ${domain}`, error);
        if (degraded.has(domain)) return;
        degraded.add(domain);
        if (ready) send(`event: degraded\ndata: ${JSON.stringify({ domain })}\n\n`);
      };
      unsubscribe = subscribeCoreEvents(invalidate);
      signal.addEventListener("abort", finish, { once: true });
      if (signal.aborted) return finish();
      try {
        for (const root of roots) {
          try {
            const target = path.resolve(root.path);
            const original = existsSync(target) ? statSync(target) : null;
            if (original && !original.isDirectory()) throw new Error("Event root is not a directory");
            let ancestor = path.dirname(target);
            while (!existsSync(ancestor) && path.dirname(ancestor) !== ancestor) ancestor = path.dirname(ancestor);
            const next = path.relative(ancestor, target).split(path.sep)[0];
            const rootChanged = () => {
              if (!original) return !existsSync(ancestor) || existsSync(path.join(ancestor, next));
              try {
                const current = statSync(target);
                return current.dev !== original.dev || current.ino !== original.ino;
              } catch {
                return true;
              }
            };
            if (next) {
              const parent = watch(ancestor, (eventType, filename) => {
                if ((eventType === "rename" || eventType === "change") && (!filename || filename.toString() === next) && rootChanged()) finish();
              });
              parent.on("error", root.optional ? (error) => degrade(root.domain, error) : finish);
              watchers.push(parent);
            }
            if (rootChanged()) return finish();
            if (!original) continue;
            const identity = (filename: string) => {
              try {
                const stat = statSync(path.join(target, filename));
                return `${stat.dev}:${stat.ino}`;
              } catch {
                return null;
              }
            };
            const fileIdentities = new Map(root.files?.map((filename) => [filename, identity(filename)]));
            const filesChanged = () => [...fileIdentities].some(([filename, previous]) => identity(filename) !== previous);
            const version = (filename: string) => {
              try {
                const stat = statSync(path.join(target, filename), { bigint: true });
                return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
              } catch {
                return null;
              }
            };
            const fileVersions = new Map(root.reconnect ? root.files?.map((filename) => [filename, version(filename)]) : []);
            const reconnectChanged = () => !root.files && root.validate ? !root.validate() : !root.files || [...fileVersions].some(([filename, previous]) => version(filename) !== previous);
            // Watchers can name a containing directory rather than the changed
            // file, especially during atomic replacements. Treat both as dirty.
            const onEvent = (relative: string | null) => {
              if (relative && root.ignore?.(relative)) return;
              if (filesChanged()) return finish();
              if (root.files && relative && !root.files.includes(relative)) return;
              if (root.reconnect) {
                if (reconnectChanged()) finish();
                return;
              }
              invalidate(root.domain);
            };
            const register = (watcher: FSWatcher) => {
              watcher.on("error", root.optional ? (error) => degrade(root.domain, error) : finish);
              watchers.push(watcher);
            };
            // Native recursive watch registers a descriptor for every descendant
            // before the ignore callback runs, so a repo's node_modules costs six
            // figures of watches and exhausts fs.inotify.max_user_watches for the
            // whole machine. Walk the tree instead and skip ignored subtrees.
            if ((root.recursive ?? !root.files) && root.ignore && process.platform === "linux") {
              const watched = new Map<string, FSWatcher>();
              const watchTree = (dir: string, relativeDir: string) => {
                if (watched.has(dir)) return;
                let watcher: FSWatcher;
                try {
                  watcher = watch(dir, { recursive: false }, (eventType, filename) => {
                    const name = filename ? filename.toString() : null;
                    const relative = name && relativeDir ? path.join(relativeDir, name) : name;
                    if (name && eventType === "rename") {
                      const child = path.join(dir, name);
                      try {
                        if (statSync(child).isDirectory() && !(relative && root.ignore?.(relative))) watchTree(child, relative ?? name);
                      } catch {
                        const stale = watched.get(child);
                        if (stale) {
                          stale.close();
                          watched.delete(child);
                        }
                      }
                    }
                    onEvent(relative);
                  });
                } catch (error) {
                  if (!root.optional) throw error;
                  degrade(root.domain, error);
                  return;
                }
                register(watcher);
                watched.set(dir, watcher);
                const entries = (() => {
                  try { return readdirSync(dir, { withFileTypes: true }); } catch { return []; }
                })();
                for (const entry of entries) {
                  if (!entry.isDirectory()) continue;
                  const childRelative = relativeDir ? path.join(relativeDir, entry.name) : entry.name;
                  if (root.ignore?.(childRelative)) continue;
                  watchTree(path.join(dir, entry.name), childRelative);
                }
              };
              watchTree(target, "");
            } else {
              register(watch(target, { recursive: root.recursive ?? !root.files }, (_eventType, filename) => {
                onEvent(filename ? filename.toString() : null);
              }));
            }
            for (const [filename, originalFile] of fileIdentities) {
              if (!originalFile) continue;
              const fileWatcher = watch(path.join(target, filename), () => {
                if (filesChanged() || (root.reconnect && reconnectChanged())) return finish();
                if (root.reconnect) return;
                invalidate(root.domain);
              });
              fileWatcher.on("error", root.optional ? (error) => degrade(root.domain, error) : finish);
              watchers.push(fileWatcher);
            }
            if (filesChanged()) return finish();
          } catch (error) {
            if (!root.optional) throw error;
            degrade(root.domain, error);
          }
        }
        // Every connection starts with a snapshot refresh. No replay buffer can
        // cover process restarts, suspended tabs or missed filesystem events.
        readiness = setTimeout(() => {
          if (closed) return;
          try {
            if (roots.some((root) => root.validate && !root.validate())) return finish();
          } catch (error) {
            console.error("[events] Cannot validate stream roots", error);
            return finish();
          }
          ready = true;
          send(`retry: 2000\nevent: ready\ndata: ${JSON.stringify({ degradedDomains: [...degraded] })}\n\n`);
          heartbeat = setInterval(() => send(": heartbeat\n\n"), 15_000);
          // Recheck authentication regularly through a new HTTP request.
          expiry = setTimeout(finish, 5 * 60_000);
        }, process.platform === "darwin" ? 500 : 0);
      } catch {
        finish();
      }
    },
    cancel: cleanup,
  });
}
