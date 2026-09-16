/**
 * Tool annotations for every DevHub MCP tool.
 *
 * The MCP `annotations` block (readOnlyHint, destructiveHint, idempotentHint,
 * openWorldHint) is what a harness reads to decide when to warn, when to ask
 * for confirmation, and when a read is safe to cache — none of which this
 * server can do on the tool's behalf. With 155+ tools, per-registrar fields
 * would rot the first time someone adds a tool and forgets the flags, so the
 * map lives here and `instrumentToolAnnotations` injects it centrally at
 * registration. A tool that passes its own annotations always wins.
 *
 * Classification rules (read alongside each tool's behaviour, not its name):
 * - readOnlyHint   — pure reads: lists, gets, searches, status, history, waits.
 * - destructiveHint — the tool's normal use destroys or irrevocably replaces
 *   state (delete, discard, revoke, push). Recoverable mutations (write,
 *   stage, rename, publish) are NOT destructive.
 * - idempotentHint — running it again leaves the same state (upserts, sets,
 *   renames, rebuilds). Appends/creates are not idempotent.
 * - openWorldHint  — reaches past this machine's own files: GitHub, Jira,
 *   Datadog, Calendar, network git, spawned processes, external DBs.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export interface ToolHints {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/** Shorthands so the table stays scannable; spread to override. */
const ro: ToolHints = { readOnlyHint: true, destructiveHint: false, idempotentHint: true };
const rox: ToolHints = { ...ro, openWorldHint: true };
const wr: ToolHints = { readOnlyHint: false, destructiveHint: false, idempotentHint: false };
const wrx: ToolHints = { ...wr, openWorldHint: true };
const dx: ToolHints = { readOnlyHint: false, destructiveHint: true, idempotentHint: false };
const dxx: ToolHints = { ...dx, openWorldHint: true };

export const TOOL_ANNOTATIONS: Readonly<Record<string, ToolHints>> = {
  // ── notes ──────────────────────────────────────────────────────────────
  notes_list: ro,
  notes_read: ro,
  notes_search: ro,
  notes_write: { ...wr, idempotentHint: true },
  notes_append: wr, // appends again on retry
  notes_delete: dx,
  notes_write_asset: { ...wr, idempotentHint: true },
  notes_create_meeting: wr,
  notes_create_task: wr,
  notes_create_pr: wr,
  notes_devhub_open: wr, // opens a tab; no data mutated
  notes_cursor_open: wr,
  notes_cursor_apply: { ...wr, idempotentHint: true }, // refuses stale writes, safe to retry
  notes_cursor_delete: dx,
  // ── entity links ───────────────────────────────────────────────────────
  entity_links_read: ro,
  entity_links_resolve: ro,
  // ── docs ───────────────────────────────────────────────────────────────
  docs_list: ro,
  docs_read: ro,
  docs_search: ro,
  docs_write: { ...wr, idempotentHint: true },
  docs_append: wr,
  docs_delete: dx,
  // ── tasks ──────────────────────────────────────────────────────────────
  tasks_list: ro,
  tasks_history: ro,
  tasks_weekly: ro,
  tasks_create: wr,
  tasks_update: { ...wr, idempotentHint: true },
  tasks_delete: dx,
  tasks_context_sync: { ...wr, idempotentHint: true }, // dedup + merge, never drops
  tasks_agent_runs: wr, // list is read-only; upsert path mutates
  tasks_agent_handoff_get: ro,
  tasks_agent_handoff_set: { ...wr, idempotentHint: true },
  tasks_agent_resume: wrx, // starts follow-up or new implement run; confirm in clients
  tasks_implement_ready: rox, // may fetch Jira description; warn-only checklist
  // ── plans ──────────────────────────────────────────────────────────────
  tasks_capture: wrx, // creates a draft task + note; reads alerts
  tasks_set_stage: { ...wrx, idempotentHint: true }, // readiness check may read Jira
  tasks_plan_status: ro,
  tasks_plan_markdown: ro,
  tasks_pr_watch: wrx, // queries GitHub, updates run sidecars
  tasks_alert_drafts: { ...wr, idempotentHint: true },
  tasks_retro_inputs: ro,
  // ── diagrams ───────────────────────────────────────────────────────────
  diagrams_list: ro,
  diagrams_read: ro,
  diagrams_create: wr,
  diagrams_update: { ...wr, idempotentHint: true },
  diagrams_set_graph: { ...wr, idempotentHint: true },
  diagrams_repair: { ...wr, idempotentHint: true },
  diagrams_add_note: wr,
  diagrams_add_shape: wr,
  diagrams_add_arrow: wr,
  diagrams_rename: { ...wr, idempotentHint: true },
  diagrams_delete: dx,
  // ── appraisal ──────────────────────────────────────────────────────────
  appraisal_list: ro,
  appraisal_list_goals: ro,
  appraisal_read: ro,
  appraisal_people: ro,
  appraisal_summarize: ro,
  appraisal_record: { ...wr, idempotentHint: true }, // dedups by slug
  appraisal_set_goal: { ...wr, idempotentHint: true },
  appraisal_delete: dx,
  // ── dx audit / ship ────────────────────────────────────────────────────
  dx_audit_list: ro,
  dx_audit_read: ro,
  repo_ship: wrx, // commits, pushes, ports patches
  repo_ship_status: ro,
  // ── history ────────────────────────────────────────────────────────────
  mcp_history: ro,
  mcp_history_summary: ro,
  // ── status / services ──────────────────────────────────────────────────
  status_services: ro,
  status_exec: ro,
  status_git: ro,
  status_mcp: ro,
  services_restart: { ...wr, idempotentHint: true }, // restart again → still running
  // ── briefing / calendar ────────────────────────────────────────────────
  briefing_get: rox, // news + weather come from the open web
  briefing_tasks: ro,
  calendar_week: rox,
  calendar_list: rox,
  // ── work / PRs / jira ──────────────────────────────────────────────────
  prs_list: rox,
  prs_open_in_cursor: wrx, // stashes + checks out; confirm-gated
  prs_auto_review: wrx, // dry-run is safe; confirm:true starts agent review jobs
  prs_auto_review_settings_get: ro, // local prefs/env read via dashboard
  prs_auto_review_settings_set: { ...wr, idempotentHint: true }, // upsert poller prefs
  prs_pipeline_investigate: wrx, // dry-run/listing safe; confirm:true starts OpenCode + optional rerun
  jira_tickets: rox,
  jira_ticket_get: rox,
  jira_ticket_transition: wrx, // no transitionId lists options; with one it moves state
  standup_markdown: rox,
  // ── assets / search / scripts ──────────────────────────────────────────
  assets_list: ro,
  search: ro,
  scripts_list: ro,
  scripts_history: ro,
  scripts_run_status: ro,
  scripts_run: { ...wrx, idempotentHint: false }, // arbitrary ops scripts; confirm-gated
  // ── repos / git ────────────────────────────────────────────────────────
  repos_list: ro,
  repos_open: wrx, // launches the editor
  repos_reveal: wrx, // opens Finder
  repos_clone: wrx, // network + writes a directory
  repo_learn: rox, // cached summary; refresh cost only
  repos_git_status: ro,
  repos_git_stage: wr, // stage/unstage is fully reversible
  repos_git_stage_hunk: wr,
  repos_git_diff: ro,
  repos_git_stash: wr, // save is safe; pop/apply/drop are confirm-gated
  repos_git_branches: ro,
  repos_git_branch: wrx, // checkout/create/delete/fetch/pull/push/undo; confirm-gated
  repos_git_commit: wr, // confirm-gated
  repos_git_push: dxx, // updates the remote branch
  repos_git_log: ro,
  repos_git_show: ro,
  repos_git_blame: ro,
  repos_git_conflicts: { ...wr, idempotentHint: true }, // list is a read; resolve writes stated content
  repos_git_discard: dx, // throws away working-tree changes
  // ── datadog ────────────────────────────────────────────────────────────
  datadog_oncall: rox,
  datadog_recent_alerts: rox,
  datadog_investigate: rox,
  // ── capability ─────────────────────────────────────────────────────────
  capability_radar: ro,
  capability_scan: { ...wr, idempotentHint: true }, // writes a dated snapshot
  capability_digest: ro,
  capability_get_lab: ro,
  capability_complete_lab: { ...wr, idempotentHint: true },
  // ── sessions / recall / tags ───────────────────────────────────────────
  sessions_recap: ro,
  recall: ro,
  recall_graph: ro,
  recall_remember: wr, // appends an event
  recall_index: { ...wr, idempotentHint: true }, // rebuilds deterministically
  tags_list: ro,
  tags_lookup: ro,
  tags_rename: { ...wr, idempotentHint: true }, // #from → #to; second run is a no-op
  // ── share ──────────────────────────────────────────────────────────────
  share_list: ro,
  share_publish: { ...wrx, idempotentHint: true }, // re-push updates the same gist URL
  share_recover: { ...wrx, idempotentHint: true }, // restores from the live gist
  share_one_time: wrx, // each call mints a new link
  share_revoke: dxx,
  // ── skills / context / collections / jobs / research / radar / persona ─
  skills_list: ro,
  skills_read: ro,
  context_pack: ro,
  collections_list: ro,
  jobs_list: ro,
  jobs_get: ro,
  jobs_log: ro,
  jobs_create: wrx, // agent jobs spawn approvals-off CLIs on schedule
  jobs_update: { ...wrx, idempotentHint: true },
  jobs_delete: dx,
  jobs_run: wrx,
  research_list: ro,
  radar_personal: ro,
  persona_list: ro,
  learnings_list: ro,
  agents_list: ro,
  owned_repos: ro,
  repo_owner_brief: rox,
  repo_pr_radar: rox,
  repo_who_owns: ro,
  repo_changed_since: ro,
  repo_knowledge_gaps: ro,
  // ── terminal ───────────────────────────────────────────────────────────
  terminal_list: ro,
  terminal_tail: ro,
  terminal_proposal_status: ro,
  terminal_propose_run: { ...wrx, idempotentHint: false }, // the command runs once approved
  terminal_wait_for: ro,
  // ── db ─────────────────────────────────────────────────────────────────
  db_connections: ro,
  db_preflight: rox,
  db_connect: wrx, // may sign in to AWS / raise Tailscale
  db_schema: rox,
  db_table: rox,
  db_query: rox,
  db_explain: rox,
  db_execute: { ...dxx, idempotentHint: false }, // arbitrary SQL, confirm-gated
  db_cancel: wrx, // aborts a running query
  db_diff: rox,
  db_history: ro,
  // ── agents ─────────────────────────────────────────────────────────────
  agent_providers: ro,
  agent_runs: ro,
  agent_output: ro,
  agent_wait: ro,
  agent_diff: ro,
  agent_dispatch: { ...wrx, idempotentHint: false }, // starts an approvals-off CLI
  agent_race: wrx, // N dispatched runs in worktrees
  agent_followup: wrx,
  agent_cancel: wr, // stops a run; nothing destroyed
  agent_interactive_note: wr, // appends Activity note; nothing destroyed
  agent_interactive_finish: wr, // closes interactive Activity run
  // ── events ─────────────────────────────────────────────────────────────
  events_wait: rox,
  // ── ui ─────────────────────────────────────────────────────────────────
  ui_open: wrx, // drives the user's screen, not data; nothing to destroy
};

/**
 * Central annotation injection, applied once before registration — the same
 * shape as the history instrumentation. Explicit per-tool annotations win.
 */
export function instrumentToolAnnotations(server: McpServer): void {
  const register = server.registerTool.bind(server) as (
    name: string,
    config: { annotations?: ToolHints } & Record<string, unknown>,
    cb: unknown,
  ) => unknown;
  server.registerTool = ((name: string, config: Record<string, unknown>, cb: unknown) =>
    register(name, { ...config, annotations: config.annotations ?? TOOL_ANNOTATIONS[name] }, cb)) as typeof server.registerTool;
}
