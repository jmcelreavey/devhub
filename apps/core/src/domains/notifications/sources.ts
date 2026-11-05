import { createHash } from "node:crypto";
import { z } from "zod";
import type { Notification, NotificationsFeed, Severity } from "../../../../../packages/shared/notifications/types";
import { homeWorkSummary } from "../../../../../packages/shared/ui-lib/storyboard/home-summary";
import { parseRepoFullNameFromPrUrl, parseRepoFullNameFromRemote } from "../../../../../packages/shared/ui-lib/github/repo-url";
import { isTaskOpen } from "../../../../../packages/shared/tasks/types";
import { loadGithubPrsList } from "../../lib/github/prs-list";
import { listOwnedRepos } from "../../lib/ownership/owned-repos";
import { readProfileAgentAttention } from "../../lib/agent-runs/store";
import { taskStorage } from "../storage/tasks";
import { getActiveTasksDir } from "../../lib/notes/dir";
import { ensureTasksMigrated } from "../tasks/storage";
import { activeTaskProfile } from "../tasks/profile-request";
import { servicePluginNeeds } from "../../lib/plugins/runtime-service-plugin-needs";
import { serverPluginContext } from "../../lib/plugins/http";
import { listRegistrations } from "../../lib/plugins/operations";
import { runtimeCatalog } from "../../lib/plugins/runtime-catalog";
import { handleRuntimeAlias } from "../../lib/plugins/runtime-aliases";
import { readDatadogSetupStatus } from "../../lib/setup/datadog-setup-status";
import { getGithubLogin } from "../../lib/standup/github-merged";
import { execGh } from "../../lib/gh-exec";
import { ttlCacheByKey, ttlCached, type TtlPromiseEntry } from "../../lib/ttl-cache";
import { applyNotificationState, filterOwnedNotifications, filterBySourcePrefs, readNeedsYouOwnedReposOnly, readNotificationSourcePrefs } from "./state";

const version = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const notification = (item: Omit<Notification, "read" | "dismissed">): Notification => ({ ...item, read: false, dismissed: false });
const ownersFor = ttlCacheByKey(async (login: string) => {
  const { stdout } = await execGh(["api", "--paginate", "user/memberships/orgs?state=active&per_page=100", "--jq", '.[] | select(.role == "admin") | .organization.login']);
  return [login, ...stdout.split("\n").map(org => org.trim()).filter(Boolean)];
}, 300_000);

export function pluginNotifications(groups: ReturnType<typeof servicePluginNeeds>, trustedNames: Set<string>): Notification[] {
  return groups.flatMap(group => {
    let urgent = 0;
    const seen = new Set<string>();
    return group.items.flatMap(item => {
      if (!item.id || !item.title || !item.href || seen.has(item.id)) return [];
      seen.add(item.id);
      let severity: Severity = item.severity ?? "info";
      if (severity === "urgent" && (!trustedNames.has(group.plugin) || urgent++ >= 3)) severity = "action";
      return [notification({ id: `plugin:${group.plugin}:${item.id}`, version: version([item.title, item.reason, item.href, item.severity]), source: "plugin", severity, title: item.title, reason: item.reason, link: item.href, createdAt: group.createdAt })];
    });
  });
}

type NotificationSources = Pick<NotificationsFeed, "items" | "sources">;
const sourceCache = new Map<string, TtlPromiseEntry<NotificationSources>>();

export function readNotificationSources(profile: string, request: Request): Promise<NotificationSources> {
  return ttlCached(sourceCache, `${profile}:${new URL(request.url).origin}`, 30_000, () => loadNotificationSources(profile, request));
}

async function loadNotificationSources(profile: string, request: Request): Promise<NotificationSources> {
  const sources: NotificationsFeed["sources"] = { github: "ok", ci: "ok", agent: "ok", datadog: "off", plugin: "ok", "plugin-trust": "ok" };
  const collect = async (names: (keyof typeof sources)[], work: () => Promise<Notification[]>): Promise<Notification[]> => {
    try { return await work(); } catch { for (const name of names) sources[name] = "degraded"; return []; }
  };
  const groups = await Promise.all([
    collect(["github", "ci"], async () => {
      const prs = await loadGithubPrsList();
      if (!prs.configured) { sources.github = sources.ci = "off"; return []; }
      if (prs.stale || prs.detailsState === "partial" || prs.authored.some(pr => pr.checks === undefined)) sources.github = sources.ci = "degraded";
      return homeWorkSummary([], [], prs.reviews, Date.now(), prs.authored, listOwnedRepos().map(repo => repo.fullName), prs.feedbackPrs, true)["needs-you"].flatMap(work => {
        if (work.kind !== "pr") return [];
        const { pr, presentation } = work;
        const failing = prs.authored.some(mine => mine.url === pr.url) && pr.checks === "failing";
        return [notification({ id: `${failing ? "ci" : "pr"}:${pr.url.toLowerCase()}`, version: version([presentation.status, pr.updatedAt, pr.headSha, pr.checks, pr.reviewDecision]), source: failing ? "ci" : "github", severity: failing ? "urgent" : "action", title: pr.title, reason: presentation.status, author: pr.author, repo: /^[\w.-]+\/[\w.-]+$/.test(pr.repo) ? pr.repo : parseRepoFullNameFromPrUrl(pr.url), link: pr.url, createdAt: pr.updatedAt ?? pr.createdAt ?? "1970-01-01T00:00:00.000Z" })];
      });
    }),
    collect(["agent"], async () => {
      await ensureTasksMigrated();
      const directory = getActiveTasksDir();
      const tasks = (await taskStorage(directory).list()).filter(isTaskOpen);
      const attention = readProfileAgentAttention(profile, directory, tasks, { includeLatestFailure: true });
      if (attention.incomplete) sources.agent = "degraded";
      const failed = new Set(attention.failedTaskIds);
      return tasks.filter(task => attention.taskIds.includes(task.id) || failed.has(task.id)).flatMap(task => {
        const key = attention.attentionKeys?.[task.id];
        if (!key) return [];
        let repo = attention.repos?.[task.id];
        for (const link of task.links ?? []) {
          if (repo || (link.kind !== "repo" && link.kind !== "pr")) continue;
          const name = link.id.split("#")[0], prRepo = parseRepoFullNameFromPrUrl(link.href ?? link.id);
          repo = /^[\w.-]+\/[\w.-]+$/.test(name) ? name : parseRepoFullNameFromRemote(link.href ?? link.id) ?? (prRepo !== "?" ? prRepo : undefined);
        }
        return [notification({ id: `task:${task.id}`, version: version([task.createdAt, key]), source: "agent", severity: "action", title: task.text, reason: failed.has(task.id) ? "Agent run failed" : "Agent run needs input", repo, link: `/work?task=${encodeURIComponent(task.id)}`, createdAt: task.createdAt })];
      });
    }),
    collect(["plugin", "plugin-trust"], async () => {
      const ctx = serverPluginContext(), registrations = listRegistrations(ctx).plugins;
      const trusted = new Set(runtimeCatalog(ctx).map(plugin => plugin.id));
      const names = new Set(registrations.filter(plugin => trusted.has(plugin.id) && plugin.state !== "needs_attention" && plugin.state !== "disabled").map(plugin => plugin.name));
      const needs = pluginNotifications(servicePluginNeeds(() => activeTaskProfile() === profile), names);
      return [...needs, ...registrations.filter(plugin => plugin.state === "needs_attention" || (plugin.state !== "disabled" && plugin.runtime && !trusted.has(plugin.id))).map(plugin => notification({ id: `trust:${plugin.id}`, version: version([plugin.state, plugin.shortSha, plugin.localRuntimePath]), source: "plugin-trust", severity: "urgent", title: `${plugin.name} needs attention`, reason: plugin.state === "needs_attention" ? plugin.stateLabel : "Review and trust this plugin", link: "/plugins", createdAt: "1970-01-01T00:00:00.000Z" }))];
    }),
    collect(["datadog"], async () => {
      const setup = await readDatadogSetupStatus();
      if (setup.failed) throw new Error("Datadog setup unavailable");
      if (!setup.configured) return [];
      const read = async (path: string) => {
        const response = await handleRuntimeAlias(new Request(new URL(path, request.url), { headers: request.headers, signal: request.signal }));
        if (!response.ok) throw new Error("Datadog unavailable");
        return response.json() as Promise<unknown>;
      };
      const oncall = z.object({ ok: z.literal(true), onCall: z.boolean() }).parse(await read("/api/datadog/oncall"));
      sources.datadog = "ok";
      if (!oncall.onCall) return [];
      const alerts = z.object({ ok: z.literal(true), oncall: z.array(z.object({ id: z.string(), title: z.string(), timestampMs: z.number().finite(), status: z.string().optional() })) }).parse(await read("/api/datadog/recent-alerts"));
      return alerts.oncall.filter(alert => !["success", "ok", "info"].includes((alert.status ?? "").toLowerCase()) && !/^\s*\[(recovered|ok)\b/i.test(alert.title)).map(alert => notification({ id: `dd:${alert.id || alert.title}`, version: version(alert), source: "datadog", severity: "urgent", title: alert.title, reason: alert.status, link: "/datadog", createdAt: new Date(alert.timestampMs).toISOString() }));
    }),
  ]);
  return { items: [...new Map(groups.flat().map(item => [item.id, item])).values()], sources };
}

export async function readNotifications(profile: string, request: Request): Promise<NotificationsFeed> {
  const cached = await readNotificationSources(profile, request);
  const feed = { ...cached, sources: { ...cached.sources } };
  const ownedReposOnly = readNeedsYouOwnedReposOnly();
  let owners: string[] | null = null;
  if (ownedReposOnly) {
    try { const login = await getGithubLogin(); owners = login ? await ownersFor(login) : null; }
    catch { feed.sources.github = "degraded"; }
  }
  const sourcePrefs = readNotificationSourcePrefs();
  const items = applyNotificationState(filterBySourcePrefs(filterOwnedNotifications(feed.items, owners), sourcePrefs), profile);
  return { ...feed, items, ownedReposOnly, sourcePrefs, unread: items.filter(item => !item.read && !item.dismissed).length, urgent: items.filter(item => item.severity === "urgent" && !item.dismissed).length };
}
