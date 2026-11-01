import { afterEach, expect, it, vi } from "vitest";
import { subscribeToTaskEvents } from "./task-subscription";

class ClosedEventSource extends EventTarget {
  static instances: ClosedEventSource[] = [];
  onerror: (() => void) | null = null;
  closed = false;

  constructor(readonly url: string) {
    super();
    ClosedEventSource.instances.push(this);
  }

  close() { this.closed = true; }

  reject() {
    // A rejected HTTP handshake does not get native EventSource retries.
    this.close();
    this.onerror?.();
  }
}

let unsubscribe: (() => void) | undefined;
afterEach(() => {
  unsubscribe?.();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("recovers a rejected stream after auth returns and catches up without retaining hidden connections", () => {
  vi.useFakeTimers();
  const document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const window = new EventTarget();
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", window);
  vi.stubGlobal("EventSource", ClosedEventSource);
  ClosedEventSource.instances = [];
  const refresh = vi.fn();
  const connection = vi.fn();
  unsubscribe = subscribeToTaskEvents({ refresh, connection });
  const rejected = ClosedEventSource.instances[0];
  rejected.reject();
  expect(connection).toHaveBeenLastCalledWith(false);
  vi.runOnlyPendingTimers();
  expect(ClosedEventSource.instances).toHaveLength(2);
  const recovered = ClosedEventSource.instances[1];
  recovered.dispatchEvent(new MessageEvent("ready", { data: '{"degradedDomains":[]}' }));
  expect(connection).toHaveBeenLastCalledWith(true);
  expect(refresh).toHaveBeenCalledTimes(1);

  document.visibilityState = "hidden";
  document.dispatchEvent(new Event("visibilitychange"));
  expect(recovered.closed).toBe(true);
  expect(connection).toHaveBeenLastCalledWith(false);
  recovered.dispatchEvent(new Event("invalidate"));
  vi.runOnlyPendingTimers();
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(ClosedEventSource.instances).toHaveLength(2);

  document.visibilityState = "visible";
  document.dispatchEvent(new Event("visibilitychange"));
  const resumed = ClosedEventSource.instances[2];
  resumed.dispatchEvent(new MessageEvent("ready", { data: '{"degradedDomains":[]}' }));
  expect(refresh).toHaveBeenCalledTimes(2);
  const unsubscribeSecond = subscribeToTaskEvents({ refresh: vi.fn(), connection: vi.fn() });
  expect(ClosedEventSource.instances).toHaveLength(3);
  unsubscribeSecond();
  resumed.reject();
  unsubscribe();
  vi.runOnlyPendingTimers();
  expect(ClosedEventSource.instances).toHaveLength(3);
});

it("refreshes matching domains once per cache key and catches up after reconnect", () => {
  const document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("EventSource", ClosedEventSource);
  ClosedEventSource.instances = [];
  const cache = {};
  const notes = vi.fn();
  const duplicate = vi.fn();
  const tasks = vi.fn();
  unsubscribe = subscribeToTaskEvents({ refresh: notes, connection: vi.fn(), domains: ["notes"], cache, key: "/notes" });
  const unsubscribeDuplicate = subscribeToTaskEvents({ refresh: duplicate, connection: vi.fn(), domains: ["notes"], cache, key: "/notes" });
  const unsubscribeTasks = subscribeToTaskEvents({ refresh: tasks, connection: vi.fn(), domains: ["tasks"], cache, key: "/tasks" });
  const source = ClosedEventSource.instances[0];
  source.dispatchEvent(new MessageEvent("ready", { data: '{"degradedDomains":[]}' }));
  expect(notes).toHaveBeenCalledTimes(1);
  expect(duplicate).not.toHaveBeenCalled();
  expect(tasks).toHaveBeenCalledTimes(1);
  source.dispatchEvent(new MessageEvent("invalidate", { data: '{"domain":"notes"}' }));
  expect(notes).toHaveBeenCalledTimes(2);
  expect(duplicate).not.toHaveBeenCalled();
  expect(tasks).toHaveBeenCalledTimes(1);
  source.dispatchEvent(new MessageEvent("invalidate", { data: "invalid" }));
  expect(notes).toHaveBeenCalledTimes(3);
  expect(tasks).toHaveBeenCalledTimes(2);
  unsubscribeDuplicate();
  unsubscribeTasks();
});

it("reports degraded domains until a healthy stream reconnects", () => {
  vi.useFakeTimers();
  const document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("EventSource", ClosedEventSource);
  ClosedEventSource.instances = [];
  const plugins = vi.fn();
  const notes = vi.fn();
  const mixed = vi.fn();
  const tasks = vi.fn();
  unsubscribe = subscribeToTaskEvents({ domains: ["plugins"], refresh: vi.fn(), connection: plugins });
  const unsubscribeNotes = subscribeToTaskEvents({ domains: ["notes"], refresh: vi.fn(), connection: notes });
  const unsubscribeMixed = subscribeToTaskEvents({ domains: ["tasks", "plugins"], refresh: vi.fn(), connection: mixed });
  const unsubscribeTasks = subscribeToTaskEvents({ domains: ["tasks"], refresh: vi.fn(), connection: tasks });
  const source = ClosedEventSource.instances[0];
  expect(plugins).toHaveBeenLastCalledWith(false);
  source.dispatchEvent(new MessageEvent("ready", { data: '{"degradedDomains":["plugins"]}' }));
  expect(plugins).toHaveBeenLastCalledWith(false);
  expect(notes).toHaveBeenLastCalledWith(true);
  expect(mixed).toHaveBeenLastCalledWith(false);
  expect(tasks).toHaveBeenLastCalledWith(true);
  const late = vi.fn();
  const unsubscribeLate = subscribeToTaskEvents({ domains: ["plugins"], refresh: vi.fn(), connection: late });
  expect(late).toHaveBeenLastCalledWith(false);

  source.dispatchEvent(new MessageEvent("degraded", { data: '{"domain":"notes"}' }));
  expect(notes).toHaveBeenLastCalledWith(false);
  source.reject();
  expect(tasks).toHaveBeenLastCalledWith(false);
  vi.runOnlyPendingTimers();
  const recovered = ClosedEventSource.instances[1];
  recovered.dispatchEvent(new MessageEvent("ready", { data: '{"degradedDomains":[]}' }));
  expect(plugins).toHaveBeenLastCalledWith(true);
  expect(notes).toHaveBeenLastCalledWith(true);
  expect(mixed).toHaveBeenLastCalledWith(true);
  expect(tasks).toHaveBeenLastCalledWith(true);
  expect(late).toHaveBeenLastCalledWith(true);
  source.dispatchEvent(new MessageEvent("degraded", { data: '{"domain":"plugins"}' }));
  expect(plugins).toHaveBeenLastCalledWith(true);
  recovered.dispatchEvent(new MessageEvent("degraded", { data: "invalid" }));
  expect(tasks).toHaveBeenLastCalledWith(false);
  unsubscribeLate();
  unsubscribeTasks();
  unsubscribeMixed();
  unsubscribeNotes();
});

it("shares one stream while adding and removing scoped repositories", () => {
  const document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("EventSource", ClosedEventSource);
  ClosedEventSource.instances = [];
  const refresh = vi.fn();
  unsubscribe = subscribeToTaskEvents({ refresh, connection: vi.fn() });
  const first = ClosedEventSource.instances[0];
  const checkout = subscribeToTaskEvents({ checkout: true, domains: ["git"], refresh: vi.fn(), connection: vi.fn() });
  expect(first.closed).toBe(true);
  expect(ClosedEventSource.instances[1].url).toBe("/api/events?checkout=1");
  const repo = subscribeToTaskEvents({ repo: "my-repo", domains: ["git"], refresh: vi.fn(), connection: vi.fn() });
  expect(ClosedEventSource.instances[2].url).toBe("/api/events?checkout=1&repo=my-repo");
  repo();
  expect(ClosedEventSource.instances[3].url).toBe("/api/events?checkout=1");
  checkout();
  expect(ClosedEventSource.instances[4].url).toBe("/api/events");
  ClosedEventSource.instances[4].dispatchEvent(new MessageEvent("ready", { data: '{"degradedDomains":[]}' }));
  expect(refresh).toHaveBeenCalledTimes(1);
});

it("shares plugin scope and catches other subscribers up on reconnection", () => {
  const document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("EventSource", ClosedEventSource);
  ClosedEventSource.instances = [];
  const refresh = vi.fn();
  unsubscribe = subscribeToTaskEvents({ refresh, connection: vi.fn() });
  const plugins = subscribeToTaskEvents({ plugins: true, domains: ["plugins"], refresh: vi.fn(), connection: vi.fn() });
  expect(ClosedEventSource.instances[0].closed).toBe(true);
  expect(ClosedEventSource.instances[1].url).toBe("/api/events?plugins=1");
  ClosedEventSource.instances[1].dispatchEvent(new MessageEvent("ready", { data: '{"degradedDomains":[]}' }));
  expect(refresh).toHaveBeenCalledTimes(1);
  plugins();
  expect(ClosedEventSource.instances[2].url).toBe("/api/events");
});

it("subscribes to local records only while they are needed", () => {
  const document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("EventSource", ClosedEventSource);
  ClosedEventSource.instances = [];
  unsubscribe = subscribeToTaskEvents({ refresh: vi.fn(), connection: vi.fn() });
  const records = subscribeToTaskEvents({ records: true, domains: ["reps"], refresh: vi.fn(), connection: vi.fn() });
  expect(ClosedEventSource.instances[0].closed).toBe(true);
  expect(ClosedEventSource.instances[1].url).toBe("/api/events?records=1");
  records();
  expect(ClosedEventSource.instances[2].url).toBe("/api/events");
});

it("scopes recall watchers to active subscribers", () => {
  const document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("EventSource", ClosedEventSource);
  ClosedEventSource.instances = [];
  unsubscribe = subscribeToTaskEvents({ refresh: vi.fn(), connection: vi.fn() });
  const recall = subscribeToTaskEvents({ recall: true, domains: ["recall"], refresh: vi.fn(), connection: vi.fn() });
  expect(ClosedEventSource.instances[0].closed).toBe(true);
  expect(ClosedEventSource.instances[1].url).toBe("/api/events?recall=1");
  recall();
  expect(ClosedEventSource.instances[2].url).toBe("/api/events");
});

it("watches the content checkout only while a subscriber needs it", () => {
  const document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("EventSource", ClosedEventSource);
  ClosedEventSource.instances = [];
  unsubscribe = subscribeToTaskEvents({ refresh: vi.fn(), connection: vi.fn() });
  const content = subscribeToTaskEvents({ content: true, domains: ["git"], refresh: vi.fn(), connection: vi.fn() });
  expect(ClosedEventSource.instances[0].closed).toBe(true);
  expect(ClosedEventSource.instances[1].url).toBe("/api/events?content=1");
  content();
  expect(ClosedEventSource.instances[2].url).toBe("/api/events");
});

it("scopes documentation watching to active subscribers", () => {
  const document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("EventSource", ClosedEventSource);
  ClosedEventSource.instances = [];
  unsubscribe = subscribeToTaskEvents({ refresh: vi.fn(), connection: vi.fn() });
  const docs = subscribeToTaskEvents({ docs: true, domains: ["recall"], refresh: vi.fn(), connection: vi.fn() });
  expect(ClosedEventSource.instances[0].closed).toBe(true);
  expect(ClosedEventSource.instances[1].url).toBe("/api/events?docs=1");
  docs();
  expect(ClosedEventSource.instances[2].url).toBe("/api/events");
});
