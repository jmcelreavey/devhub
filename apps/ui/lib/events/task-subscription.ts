"use client";

export interface Subscriber {
  refresh: () => boolean | void;
  connection: (connected: boolean) => void;
  domains?: readonly ("tasks" | "notes" | "collections" | "runs" | "orchestrations" | "media" | "exec" | "jobs" | "terminal" | "logs" | "git" | "rebuild" | "conventions" | "plugins" | "plugin-operations" | "reps" | "script-history" | "skill-proposals" | "cli-updates" | "projects" | "recall" | "shares" | "board" | "repo-work" | "skills" | "ownership" | "db" | "paseo")[];
  repo?: string;
  repos?: boolean;
  skills?: boolean;
  syncTargets?: boolean;
  checkout?: boolean;
  content?: boolean;
  plugins?: boolean;
  records?: boolean;
  recall?: boolean;
  docs?: boolean;
  db?: boolean;
  cache?: object;
  key?: string;
}

// One connection per browser tab, shared by every task query and SWR provider.
const subscribers = new Set<Subscriber>();
let source: EventSource | undefined;
let connected = false;
let degradedDomains: Set<string> | null = new Set();
let reconnect: ReturnType<typeof setTimeout> | undefined;
let retryDelay = 2_000;
let sourceUrl = "";

function streamUrl(): string {
  const params = new URLSearchParams();
  if ([...subscribers].some((subscriber) => subscriber.checkout)) params.set("checkout", "1");
  if ([...subscribers].some((subscriber) => subscriber.content)) params.set("content", "1");
  if ([...subscribers].some((subscriber) => subscriber.plugins)) params.set("plugins", "1");
  if ([...subscribers].some((subscriber) => subscriber.records)) params.set("records", "1");
  if ([...subscribers].some((subscriber) => subscriber.recall)) params.set("recall", "1");
  if ([...subscribers].some((subscriber) => subscriber.docs)) params.set("docs", "1");
  if ([...subscribers].some((subscriber) => subscriber.db)) params.set("db", "1");
  if ([...subscribers].some((subscriber) => subscriber.repos)) params.set("repos", "1");
  if ([...subscribers].some((subscriber) => subscriber.skills)) params.set("skills", "1");
  if ([...subscribers].some((subscriber) => subscriber.syncTargets)) params.set("sync", "1");
  const repos = [...new Set([...subscribers].flatMap((subscriber) => subscriber.repo ? [subscriber.repo] : []))].sort();
  repos.forEach((repo) => params.append("repo", repo));
  const query = params.toString();
  return query ? `/api/events?${query}` : "/api/events";
}

function subscriberConnected(subscriber: Subscriber): boolean {
  const degraded = degradedDomains;
  if (!connected || !degraded) return false;
  return subscriber.domains
    ? !subscriber.domains.some((domain) => degraded.has(domain))
    : degraded.size === 0;
}

function notifyConnections() {
  subscribers.forEach((subscriber) => subscriber.connection(subscriberConnected(subscriber)));
}

function setConnected(value: boolean) {
  connected = value;
  notifyConnections();
}

function refreshSubscribers(domain?: string) {
  const refreshed = new Map<object, Set<string>>();
  subscribers.forEach((subscriber) => {
    if (domain && subscriber.domains && !subscriber.domains.some((candidate) => candidate === domain)) return;
    if (subscriber.cache && subscriber.key && refreshed.get(subscriber.cache)?.has(subscriber.key)) return;
    if (subscriber.refresh() === false || !subscriber.cache || !subscriber.key) return;
    const keys = refreshed.get(subscriber.cache) ?? new Set<string>();
    keys.add(subscriber.key);
    refreshed.set(subscriber.cache, keys);
  });
}

function disconnect() {
  clearTimeout(reconnect);
  reconnect = undefined;
  source?.close();
  source = undefined;
  sourceUrl = "";
  setConnected(false);
}

function connect() {
  if (document.visibilityState === "hidden" || source || !subscribers.size) return;
  clearTimeout(reconnect);
  reconnect = undefined;
  sourceUrl = streamUrl();
  const current = new EventSource(sourceUrl);
  source = current;
  current.addEventListener("ready", (event) => {
    if (source !== current) return;
    try {
      const payload = JSON.parse((event as MessageEvent<string>).data) as { degradedDomains?: unknown };
      degradedDomains = Array.isArray(payload.degradedDomains) && payload.degradedDomains.every((domain) => typeof domain === "string")
        ? new Set(payload.degradedDomains) : null;
    } catch {
      degradedDomains = null;
    }
    retryDelay = 2_000;
    setConnected(true);
    refreshSubscribers();
  });
  current.addEventListener("degraded", (event) => {
    if (source !== current) return;
    try {
      const { domain } = JSON.parse((event as MessageEvent<string>).data) as { domain?: unknown };
      if (typeof domain !== "string") degradedDomains = null;
      else degradedDomains?.add(domain);
    } catch {
      degradedDomains = null;
    }
    notifyConnections();
  });
  current.addEventListener("invalidate", (event) => {
    if (source !== current) return;
    let domain: string | undefined;
    try {
      domain = (JSON.parse((event as MessageEvent<string>).data) as { domain?: string }).domain;
    } catch {
      domain = undefined;
    }
    refreshSubscribers(domain);
  });
  current.onerror = () => {
    if (source !== current) return;
    // HTTP auth failures permanently close EventSource. Own the retry so a
    // restored session can recover too, with bounded backoff while unavailable.
    disconnect();
    reconnect = setTimeout(connect, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 30_000);
  };
}

function visibilityChanged() {
  if (document.visibilityState === "hidden") {
    disconnect();
  } else {
    connect();
  }
}

export function subscribeToTaskEvents(subscriber: Subscriber): () => void {
  subscribers.add(subscriber);
  subscriber.connection(subscriberConnected(subscriber));
  if (subscribers.size === 1) {
    document.addEventListener("visibilitychange", visibilityChanged);
    window.addEventListener("online", visibilityChanged);
  }
  if (source && sourceUrl !== streamUrl()) disconnect();
  connect();
  return () => {
    subscribers.delete(subscriber);
    if (subscribers.size) {
      if (source && sourceUrl !== streamUrl()) { disconnect(); connect(); }
      return;
    }
    disconnect();
    retryDelay = 2_000;
    document.removeEventListener("visibilitychange", visibilityChanged);
    window.removeEventListener("online", visibilityChanged);
  };
}
