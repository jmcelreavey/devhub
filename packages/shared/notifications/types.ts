export type NotificationSource = "github" | "ci" | "agent" | "datadog" | "plugin" | "plugin-trust";
export type Severity = "info" | "action" | "urgent";
export interface Notification {
  id: string;
  version: string;
  source: NotificationSource;
  severity: Severity;
  title: string;
  reason?: string;
  repo?: string;
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
  sources: Record<NotificationSource, "ok" | "degraded" | "off">;
}
