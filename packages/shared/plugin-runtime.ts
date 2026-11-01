/** Values exchanged between a request worker and the DevHub host. */
export type PluginJson = null | boolean | number | string | PluginJson[] | { [key: string]: PluginJson };

export interface HostApprovalRequest {
  id: string;
  summary: string;
  payload: PluginJson;
}

export interface HostApprovalReceipt {
  proposalId: string;
  status: "pending";
}

export interface HostApprovalDecision extends HostApprovalRequest {
  proposalId: string;
  status: "pending" | "approved" | "denied" | "expired";
}

export type PluginStreamEvent =
  | { type: "output"; text: string }
  | { type: "progress"; text: string; current?: number; total?: number };

/** Requests for reviewed background-service task handoff and pickup operations. */
export interface ServiceTaskProfiles { activeProfile: string; profiles: string[] }
/** Service code with synchronous consumers must refresh this snapshot at each work boundary. */
export interface ServiceProfileAdapter {
  context(): ServiceTaskProfiles;
  refresh(): Promise<void>;
}
export type ServiceSurfaceReadRequest =
  | { operation: "pull-requests"; profile: string }
  | { operation: "calendar-week"; profile: string }
  | { operation: "quiet-hours"; profile: string; destination: string; now: string };
export type ServiceBoardReadRequest =
  | { operation: "board-snapshot"; profile: string }
  | { operation: "plugin-needs"; profile: string };
export type ServiceWorkflowRequest =
  | { operation: "workflow-state"; profile: string; taskId: string; createdAt: string }
  | { operation: "workflow-note"; profile: string; taskId: string; createdAt: string; line: string };
export type ServiceTaskDispatchRequest =
  | (ServiceTaskIdentity & { operation: "plan-approve"; planRunId: string; fingerprint: string; requestId: string })
  | (ServiceTaskIdentity & { operation: "task-retry"; requestId: string });
export interface ServiceRunUsageRequest extends ServiceTaskIdentity { operation: "run-usage"; runId: string }
export interface ServiceTaskIdentity { profile: string; taskId: string; createdAt: string }
export interface ServicePickupCheckout { cwd: string; branch: string }
export type ServicePickupRequest =
  | { operation: "pickup-create"; profile: string; handoffId: string; title: string; repo: string; checkout: ServicePickupCheckout; jiraKey?: string }
  | (ServiceTaskIdentity & { operation: "pickup-hold" | "pickup-finish" | "pickup-retire"; handoffId: string; checkout: ServicePickupCheckout; jiraKey?: string })
  | (ServiceTaskIdentity & { operation: "pickup-note"; handoffId: string; note: string });
export type ServiceHandoffNoteRequest =
  | (ServiceTaskIdentity & { operation: "handoff-note-read"; handoffId: string })
  | (ServiceTaskIdentity & { operation: "handoff-note"; handoffId: string; note: string; expected: string | null });
export type ServiceGitRequest =
  | (ServiceTaskIdentity & { operation: "git-inspect"; cwd: string; branch: string })
  | (ServiceTaskIdentity & { operation: "git-push"; handoffId: string; review: string; recipient: string; commitWip: boolean })
  | { operation: "git-repos"; profile: string }
  | { operation: "git-pickup"; profile: string; repo: string; branch: string; handoffId: string };
export interface ServiceGitReview { review: string; cwd: string; branch: string; repo: string; files: string[]; fingerprint: string }
export type ServiceJiraRequest =
  | { operation: "jira-connected"; profile: string }
  | (ServiceTaskIdentity & { operation: "jira-assign-self"; handoffId: string; jiraKey: string });
export interface ServiceRepoAnswerRequest extends ServiceTaskIdentity {
  operation: "answer-repo";
  cwd: string;
  requestId: string;
  expected: { id: string; text: string };
}
export interface ServiceRepository { path: string; name: string; origin: string }
export interface ServiceRepoAnswerResult { remaining: number; runId: string | null; dispatchError: string | null; replayed: boolean }
export interface ServiceHandoffNoteRevision { revision: string | null }
export type ServiceBrokerResponse<T> = { ok: true; result: T } | { ok: false };
