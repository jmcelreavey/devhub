export type NotificationSource = "github" | "ci" | "agent" | "datadog" | "plugin" | "plugin-trust";
export type Severity = "info" | "action" | "urgent";
export type NotificationSourceKey = "github" | "ci" | "agent" | "plugin" | "datadog";
export type NotificationSourcePrefs = Record<NotificationSourceKey, boolean>;
export const NOTIFICATION_SOURCE_KEYS: readonly NotificationSourceKey[] = ["github", "ci", "agent", "plugin", "datadog"];
export const DEFAULT_NOTIFICATION_SOURCE_PREFS: NotificationSourcePrefs = { github: true, ci: true, agent: true, plugin: true, datadog: true };
/** Toggle for a source — plugin trust prompts are part of the Plugins switch. */
export const NOTIFICATION_SOURCE_TOGGLE: Record<NotificationSource, NotificationSourceKey> = {
  github: "github",
  ci: "ci",
  agent: "agent",
  plugin: "plugin",
  "plugin-trust": "plugin",
  datadog: "datadog",
};
export const NOTIFICATION_SOURCE_TOGGLE_LABELS: Record<NotificationSourceKey, string> = {
  github: "Pull requests",
  ci: "CI failing",
  agent: "Agent needs input",
  plugin: "Plugins",
  datadog: "Datadog on-call",
};
export interface Notification {
  id: string;
  version: string;
  source: NotificationSource;
  severity: Severity;
  title: string;
  reason?: string;
  repo?: string;
  author?: { login: string; avatarUrl?: string };
  link: string;
  createdAt: string;
  read: boolean;
  dismissed: boolean;
}
export interface NotificationsFeed {
  items: Notification[];
  unread: number;
  urgent: number;
  ownedReposOnly: boolean;
  sourcePrefs: NotificationSourcePrefs;
  sources: Record<NotificationSource, "ok" | "degraded" | "off">;
}
