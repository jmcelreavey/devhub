# W09 core extraction map

Snapshot: `slim/base2` at `6352ed70b1dcc516db387b20e0b08050b378ddd1`. Run `node scripts/core-closure.mjs` for the per-seed closure and `node scripts/core-closure.mjs --json` for edges, direct signals and type-only imports. Re-run after earlier waves merge; this is not an inventory of their future layout.

The inventory below is historical. Current seeds include the core-owned task file engine, SQLite runs, event stream, scheduler, calendar, and the PTY peer. UI adapters still supply existing integration and path dependencies. Briefing has since been deleted; its rows are omitted below.

## Decision and order

Use **three batches**, but bring the event bus into the first batch and treat cross-domain dependencies as boundaries that must be satisfied before each move:

- **a) Tasks, storage and event foundation:** T + S + E. Includes `events/core-events.ts` and the server event stream; keep `events/task-subscription.ts` in UI. `shared/storage/*` and `shared/tasks/*` are W07's direct-to-`packages/shared` moves, including server-capable storage; do not create a second store or move them twice. The tasks graph already reaches all storage seeds and two event seeds. Calendar can be introduced here only if an actual dependency requires it; the measured calendar seeds do not.
- **b) Scheduler and jobs:** J minus a. Depends on task storage, agent-run services and the same event bus. Move scheduler implementation and its own helpers into core; keep `instrumentation.ts` as the one startup adapter. Preserve process locks, the single scheduler owner and the existing jobs data root.
- **c) Calendar:** C minus a and b. `calendar-cache.ts` is process state, not a pure shared contract. Keep the OAuth HTTP callback and other route handlers in Next.

The tables below enumerate **the whole source dependency closure**, assigned at first use, not a blanket instruction to move every supporting file into `apps/core`. Batch a has 322 files, b adds 74, and c adds 35. For every recorded local edge, the target is in the same or an earlier batch, including type-only and dynamic-import edges. Closure holds cumulatively: batch b or c alone relies on earlier batches. Use the `Seed` column for the exact W09 entry files. Other rows identify the support that must move to its rightful owner, remain available as an existing dependency, or be replaced by a seam in the same change. In particular, blindly moving plugin host, setup and UI code into core is not this plan. Before introducing a core-to-dashboard import, cut a named boundary below or move that dependency to its final owner; do not leave an undeclared reverse package dependency.

**Classification:** `S` = direct or value-transitive Node/server signal; `B` = direct or value-transitive client directive, React or browser-global signal; `N` = direct or value-transitive `next/*` coupling, including Next type imports; `P?` = none of those signals. Multiple letters are intentional and require a split or review, not a claim that a file is both browser-only and server-only. `P?` is a *candidate*, not proof of purity: mutable global state, side effects and external packages still need review. A direct Next type coupling propagates conservatively through value imports. For individual signals and edges use `--json`.

`In closures` uses T = tasks, E = events, J = scheduler/jobs, S = storage, F = briefing, C = calendar. These are membership flags, so filtering any column reconstructs that seed group's full closure. `Seed` marks an entry point (a file can seed more than one group). The walker includes production `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.json` and index resolution, including type-only imports; tests and declarations are intentionally excluded from seed discovery. Move and update the existing affected tests alongside their source in the later items; their files are not implied by this production graph.

The seed directories in this baseline are `apps/ui/lib/tasks/`, `apps/ui/lib/events/` and `shared/storage/`; scheduler is the four flat `apps/ui/lib/scheduler*.ts` production files, not a `scheduler/` directory. Storage also includes `apps/ui/lib/storage.ts` and `apps/ui/lib/storage-server.ts`. The calendar entry files are those named in the brief. All 431 reached paths were tracked in this baseline. Recheck tracked status and plugin manifest overlays at move time.

This is a source-only lexical walk: literal static import/export and literal dynamic import, relative paths and the three tsconfig aliases are followed. External packages are listed in JSON but not traversed. Computed imports and imports in template interpolations are reported as unresolved when detected; CommonJS `require`, arbitrary code generation, package-internal dependencies, runtime configuration and module side effects are outside the graph. The lexer is not a TypeScript parser: it uses a heuristic for `import("...").Type` and browser globals, and regex literals or shadowed globals can affect its results. There were no reported missing local imports or computed imports in this snapshot; absence of reports is not a proof of semantic closure. Recheck consumers, external package exports and aliases when implementing each seam.

## Shared and adapter seams

Move the following verified client-safe contracts to `packages/shared` in the batch shown (the table lists their dependencies as well):

- a: `apps/ui/lib/tasks/types.ts` (or update consumers directly to the W07 `shared/tasks/types.ts` destination), `apps/ui/lib/tasks/profile-types.ts`, `apps/ui/lib/tasks/profile-scope.ts` and `apps/ui/lib/tasks/plan-status-labels.ts`.
- a: `apps/ui/lib/tasks/weekly.ts` after extracting `TaskDay` and `TaskDaySummary` from `tasks/storage.ts` into a shared contract alongside `Task`; `apps/ui/lib/tasks/group-by-parent.ts` after moving or narrowing its type-only `JiraTicketRef` contract out of `jira/client.ts`.

Other `P?` rows need a consumer and side-effect review before being placed in shared. In particular `events/core-events.ts` uses a process-global listener set, and `calendar-cache.ts` stores mutable cache state; keep each with its server owner. `scheduler-plan.ts` is pure planning logic but scheduler-owned unless a real cross-package consumer needs it. Browser-dependent hooks and helpers stay in UI; guarded browser helpers used by server code need their pure exports separated rather than importing UI into core.

Direct Next couplings reached by the walk, and the smallest boundary to preserve:

- `apps/ui/lib/tasks/profile-request.ts` uses `NextResponse`; split active-profile lookup and scoped work from request/409 response construction. Return a neutral conflict result from core; the route adapter preserves 409, payload and cache headers.
- `apps/ui/lib/api-utils.ts` owns Next response creation, request validation, auth, origin checks, profile conflict handling and cache headers; retain it in Next route adapters. Do not weaken any check or response status.
- `apps/ui/lib/desktop/bootstrap-auth.ts`, `apps/ui/lib/plugins/management-auth.ts` and `apps/ui/lib/plugins/runtime-mcp.ts` import `NextRequest` as a type. Keep request auth at the adapter, or accept a narrow standard `Request`/header interface if that preserves the existing checks. These are dependencies of the plugin/agent host, not a reason to pull Next into core.

Existing `apps/ui/app/api/**/route.ts` handlers stay as adapters and call core; `apps/ui/instrumentation.ts` stays the scheduler startup adapter. Event subscription clients remain in UI. Keep the existing event-bus identity through the move: task events, jobs and SSE must use the same process-global listeners.

## Cycles and cuts

These are strongly connected components in the complete graph, including type-only edges. A type-only cycle does not imply a runtime loop; do not move unrelated domains merely to break one. The listed cut is the smallest useful boundary to remove the indicated dependency; a component with multiple independent runtime loops can need more than one cut. The JSON graph has the exact edges.

1. **Runtime.** `runtime-host.ts` composes both `runtime-agent.ts` and `runtime-reads.ts`; inject those two handlers at the host composition boundary. This cuts the `background → dispatch → paseo/launch → runtime-mcp → runtime-host → runtime-agent → background` loop and the independent `runtime-host → runtime-reads → registry → runtime-provider → runtime-host` loop without moving the plugin host into tasks. Keep plugin auth and runtime behaviour in the adapter.

   Files: `apps/ui/lib/agent-runs/background.ts`, `apps/ui/lib/agent-runs/dispatch.ts`, `apps/ui/lib/integrations/registry.ts`, `apps/ui/lib/integrations/runtime-provider.ts`, `apps/ui/lib/paseo/dispatch.ts`, `apps/ui/lib/paseo/launch.ts`, `apps/ui/lib/paseo/lifecycle.ts`, `apps/ui/lib/paseo/managed.ts`, `apps/ui/lib/paseo/providers.ts`, `apps/ui/lib/plugins/runtime-agent.ts`, `apps/ui/lib/plugins/runtime-host.ts`, `apps/ui/lib/plugins/runtime-mcp.ts`, `apps/ui/lib/plugins/runtime-reads.ts`, `apps/ui/lib/plugins/runtime-response.ts`, `apps/ui/lib/plugins/runtime-settings.ts`, `apps/ui/lib/plugins/runtime-terminal.ts`.

2. **Type-only cycle.** `agent-runs/run-files.ts` uses `import('./checkout').CheckoutPreparation` only as a type, while checkout reads the store. Move that small contract into a neutral run-types file and point both at it. The remaining `sqlite → run-files`, `task-agent-runs → run-files`, `store → today-attention` and `workflows/store → run-files` return edges are type-only too; extract the relevant state and record types if those package boundaries require it. The runtime-only graph has no SCC here.

   Files: `apps/ui/lib/agent-runs/checkout.ts`, `apps/ui/lib/agent-runs/run-files.ts`, `apps/ui/lib/agent-runs/sqlite.ts`, `apps/ui/lib/agent-runs/store.ts`, `apps/ui/lib/tasks/run-snapshot.ts`, `apps/ui/lib/tasks/task-agent-runs.ts`, `apps/ui/lib/tasks/today-attention.ts`, `apps/ui/lib/workflows/store.ts`.

3. **Runtime.** `exec-external → git-availability → exec-external` and `exec-external → git-check → dependencies → exec-external` are independent. Put the low-level, timeout-enforced execution primitive behind a leaf helper used by Git probes. Move `GitMissingError`/`missingGitCheck` and their Git install-spec/hint dependencies into a leaf shared by `exec-external` and `git-check`; keep that leaf independent of `dependencies.ts` and `launch/desktop.ts`. Retain the existing timeouts, registry and Git checks. This also removes the `dependencies → launch/desktop → exec-external` return path.

   Files: `apps/ui/lib/exec-external.ts`, `apps/ui/lib/launch/desktop.ts`, `apps/ui/lib/setup/dependencies.ts`, `apps/ui/lib/setup/git-availability.ts`, `apps/ui/lib/setup/git-check.ts`.

4. **Type-only cycle.** Move the `FinishedTaskFeedback` and attention contracts used by `notes-board-shared.ts` to a dependency-light types module; keep feedback and attention behaviour with their owners.

   Files: `apps/ui/lib/github/finished-task-feedback.ts`, `apps/ui/lib/storyboard/attention.ts`, `apps/ui/lib/storyboard/notes-board-shared.ts`.

5. **Type-only cycle.** Move the PR type consumed by `skipped-prs.ts` into a PR contract module, or import it from its existing shared contract.

   Files: `apps/ui/lib/github/prs.ts`, `apps/ui/lib/github/skipped-prs.ts`.

6. **Runtime.** Extract `githubRequest` into a low-level transport module imported by both `github.ts` and `github-write.ts`; keep provider assembly in `github.ts`.

   Files: `apps/ui/lib/integrations/github-write.ts`, `apps/ui/lib/integrations/github.ts`.

7. **Runtime.** Extract `jiraConnection`, `jiraRequest` and transition-cache invalidation into a transport/state leaf used by both `jira.ts` and `jira-write.ts`; keep provider assembly in `jira.ts`.

   Files: `apps/ui/lib/integrations/jira-write.ts`, `apps/ui/lib/integrations/jira.ts`.

8. **Type-only cycle.** Extract the write input/context/receipt contracts into a leaf that imports no integration provider types, or make the shared integration context a neutral type dependency.

   Files: `apps/ui/lib/integrations/types.ts`, `apps/ui/lib/integrations/write-types.ts`.

9. **Type-only cycle.** Extract the type imported by `mcp/personal.ts` from `sync/mcp.ts` into a small MCP contract module.

   Files: `apps/ui/lib/mcp/personal.ts`, `apps/ui/lib/sync/mcp.ts`.

10. **Runtime.** Separate the `sync/skills.ts` primitives consumed by `plugins/install.ts` from the orchestration that imports `plugins/origin-guard.ts`. Separately extract `rowFrom` from `plugins/views.ts` for `registry-write.ts`; then split `destinationFingerprint`/`InstallReceipt` and `listSyncTargets` out of `install.ts` for `store.ts` and `views.ts` if their own mutual dependencies remain. Keep path locks and origin checks intact.

   Files: `apps/ui/lib/plugins/install.ts`, `apps/ui/lib/plugins/origin-guard.ts`, `apps/ui/lib/plugins/registry-write.ts`, `apps/ui/lib/plugins/store.ts`, `apps/ui/lib/plugins/views.ts`, `apps/ui/lib/sync/skills.ts`.

11. **Type-only cycle.** `shared/plugin-registry/materialization.generated.ts` references the registry type; move that type to a neutral contract. Follow PL21 before retiring the generated file.

   Files: `apps/ui/lib/plugins/registry.ts`, `shared/plugin-registry/materialization.generated.ts`.

12. **Type-only cycle.** Move `OrchestrationCheckoutChoice` from `storyboard/types.ts` into a leaf contract shared by `types.ts` and `launch-options.ts`; `AutoLaunchOptions` remains inferred from its Zod schema.

   Files: `apps/ui/lib/storyboard/launch-options.ts`, `apps/ui/lib/storyboard/types.ts`.

13. **Type-only cycle.** Move the `NextAction` type imported by `task-detail.ts` into a leaf contract shared by both modules, including the `CardAttention` type it needs.

   Files: `apps/ui/lib/storyboard/next-action.ts`, `apps/ui/lib/storyboard/task-detail.ts`.

## Batch file inventory

Each path appears once at its earliest required batch. `In closures` identifies all groups that need it; `Seed` identifies the direct W09 entries.

### a) Tasks, storage and event foundation (322 files)

| File | Class | In closures | Seed |
| --- | --- | --- | --- |
| `apps/ui/lib/agent-runs/background.ts` | SBN | TJ | — |
| `apps/ui/lib/agent-runs/budget.ts` | P? | TJ | — |
| `apps/ui/lib/agent-runs/checkout.ts` | SB | TJF | — |
| `apps/ui/lib/agent-runs/claims.ts` | SB | TJ | — |
| `apps/ui/lib/agent-runs/consent.ts` | S | TJF | — |
| `apps/ui/lib/agent-runs/dispatch.ts` | SBN | TJ | — |
| `apps/ui/lib/agent-runs/events.ts` | P? | TJF | — |
| `apps/ui/lib/agent-runs/git.ts` | S | TJ | — |
| `apps/ui/lib/agent-runs/paths.ts` | S | TJF | — |
| `apps/ui/lib/agent-runs/run-files.ts` | S | TJF | — |
| `apps/ui/lib/agent-runs/sqlite.ts` | S | TJF | — |
| `apps/ui/lib/agent-runs/store.ts` | SB | TJF | — |
| `apps/ui/lib/agent-runs/title.ts` | SB | TJ | — |
| `apps/ui/lib/agent/sync-format.ts` | S | TJ | — |
| `apps/ui/lib/ai/activity.ts` | SB | TJF | — |
| `apps/ui/lib/ai/effort.ts` | P? | TJF | — |
| `apps/ui/lib/ai/provider.ts` | SB | TJF | — |
| `apps/ui/lib/ai/tools-skills.ts` | S | TJ | — |
| `apps/ui/lib/api-utils.ts` | SN | TJ | — |
| `apps/ui/lib/atomic-write.ts` | S | TJFC | — |
| `apps/ui/lib/content/dirs.ts` | S | TJSFC | — |
| `apps/ui/lib/content/sync-dirs.ts` | S | TJF | — |
| `apps/ui/lib/content/sync-paths.ts` | P? | TJF | — |
| `apps/ui/lib/dashboard-env-local.ts` | S | TJFC | — |
| `apps/ui/lib/dedupe.ts` | P? | TJF | — |
| `apps/ui/lib/desktop/bootstrap-auth.ts` | SN | TJ | — |
| `apps/ui/lib/desktop/runtime-paths.ts` | S | TJSFC | — |
| `apps/ui/lib/diagram-utils.ts` | P? | TJF | — |
| `apps/ui/lib/entity-links/build-ref.ts` | P? | TJF | — |
| `apps/ui/lib/entity-links/parse-pr.ts` | P? | TJF | — |
| `apps/ui/lib/entity-note.ts` | P? | TJF | — |
| `apps/ui/lib/events/core-events.ts` | P? | TEJF | E |
| `apps/ui/lib/events/task-stream.ts` | S | E | E |
| `apps/ui/lib/events/task-subscription.ts` | B | TE | E |
| `apps/ui/lib/exec-external.ts` | S | TJF | — |
| `apps/ui/lib/exec-registry.ts` | P? | TJF | — |
| `apps/ui/lib/gh-exec.ts` | S | TJF | — |
| `apps/ui/lib/git/command.ts` | S | TJF | — |
| `apps/ui/lib/git/mutation-queue.ts` | S | TJF | — |
| `apps/ui/lib/git/repo-local.ts` | S | TJF | — |
| `apps/ui/lib/github/branch-pr.ts` | S | TJF | — |
| `apps/ui/lib/github/finished-task-feedback.ts` | P? | TJF | — |
| `apps/ui/lib/github/pr-state.ts` | S | T | — |
| `apps/ui/lib/github/prs.ts` | S | TJF | — |
| `apps/ui/lib/github/repo-url.ts` | P? | TJF | — |
| `apps/ui/lib/github/search-types.ts` | P? | TJF | — |
| `apps/ui/lib/github/skipped-prs.ts` | S | TJF | — |
| `apps/ui/lib/graphite-theme.ts` | B | T | — |
| `apps/ui/lib/hooks/panel-visibility.tsx` | B | T | — |
| `apps/ui/lib/hooks/use-fetch.ts` | B | T | — |
| `apps/ui/lib/integrations/accounts.ts` | S | TJ | — |
| `apps/ui/lib/integrations/alert-source.ts` | SBN | T | — |
| `apps/ui/lib/integrations/github-write.ts` | S | TJ | — |
| `apps/ui/lib/integrations/github.ts` | S | TJ | — |
| `apps/ui/lib/integrations/http.ts` | P? | TJ | — |
| `apps/ui/lib/integrations/jira-write.ts` | SB | TJ | — |
| `apps/ui/lib/integrations/jira.ts` | SB | TJ | — |
| `apps/ui/lib/integrations/registry.ts` | SBN | TJ | — |
| `apps/ui/lib/integrations/runtime-provider.ts` | SBN | TJ | — |
| `apps/ui/lib/integrations/types.ts` | P? | TJ | — |
| `apps/ui/lib/integrations/write-types.ts` | P? | TJ | — |
| `apps/ui/lib/jira/adf.ts` | P? | TJF | — |
| `apps/ui/lib/jira/avatars.ts` | SB | TJF | — |
| `apps/ui/lib/jira/client.ts` | SB | TJF | — |
| `apps/ui/lib/jira/env.ts` | SB | TJF | — |
| `apps/ui/lib/jira/issue-type.ts` | P? | TJ | — |
| `apps/ui/lib/jira/tickets-cache.ts` | P? | TJF | — |
| `apps/ui/lib/jira/ttl-cache.ts` | P? | TJF | — |
| `apps/ui/lib/json-file.ts` | S | TJ | — |
| `apps/ui/lib/launch/desktop.ts` | S | TJF | — |
| `apps/ui/lib/local/calendar-date.ts` | P? | TJF | — |
| `apps/ui/lib/markdown-convert.ts` | P? | TJF | — |
| `apps/ui/lib/markdown-convert/index.ts` | P? | TJF | — |
| `apps/ui/lib/mcp/claude-desktop-paths.ts` | S | TJ | — |
| `apps/ui/lib/mcp/codex-config.ts` | S | TJ | — |
| `apps/ui/lib/mcp/cursor-acp-surface.ts` | P? | TJ | — |
| `apps/ui/lib/mcp/cursor-paths.ts` | S | TJ | — |
| `apps/ui/lib/mcp/personal.ts` | S | TJ | — |
| `apps/ui/lib/notes-ai/config.ts` | P? | TJF | — |
| `apps/ui/lib/notes-assets/index.ts` | S | TJSF | — |
| `apps/ui/lib/notes/autosave-invalidation.ts` | B | TJSF | — |
| `apps/ui/lib/notes/dir.ts` | S | TJFC | — |
| `apps/ui/lib/notes/search.ts` | S | TJSF | — |
| `apps/ui/lib/p-limit.ts` | P? | TJF | — |
| `apps/ui/lib/paseo/agent-setup.ts` | S | TJF | — |
| `apps/ui/lib/paseo/client.ts` | S | TJF | — |
| `apps/ui/lib/paseo/dispatch.ts` | S | TJ | — |
| `apps/ui/lib/paseo/idle-runtimes.ts` | SB | TJ | — |
| `apps/ui/lib/paseo/launch.ts` | SBN | TJ | — |
| `apps/ui/lib/paseo/lifecycle.ts` | SBN | TJ | — |
| `apps/ui/lib/paseo/managed.ts` | SBN | TJ | — |
| `apps/ui/lib/paseo/prerequisites.ts` | P? | TJF | — |
| `apps/ui/lib/paseo/providers.ts` | SBN | TJ | — |
| `apps/ui/lib/paseo/user-message.ts` | P? | TJF | — |
| `apps/ui/lib/paseo/workspaces.ts` | S | TJF | — |
| `apps/ui/lib/people/avatar-trust.ts` | P? | TJF | — |
| `apps/ui/lib/plugin-integrations.generated.ts` | P? | TJ | — |
| `apps/ui/lib/plugin-setup-schema.ts` | P? | TJ | — |
| `apps/ui/lib/plugins/alias-contract.ts` | P? | TJ | — |
| `apps/ui/lib/plugins/context.ts` | S | TJ | — |
| `apps/ui/lib/plugins/filesystem.ts` | S | TJF | — |
| `apps/ui/lib/plugins/github-url.ts` | P? | TJ | — |
| `apps/ui/lib/plugins/inspect.ts` | S | TJ | — |
| `apps/ui/lib/plugins/install.ts` | S | TJ | — |
| `apps/ui/lib/plugins/lock.ts` | S | TJF | — |
| `apps/ui/lib/plugins/management-auth.ts` | SN | TJ | — |
| `apps/ui/lib/plugins/manifest.ts` | S | TJ | — |
| `apps/ui/lib/plugins/model.ts` | P? | TJ | — |
| `apps/ui/lib/plugins/origin-guard.ts` | S | TJ | — |
| `apps/ui/lib/plugins/paths.ts` | S | TJF | — |
| `apps/ui/lib/plugins/registry-write.ts` | S | TJ | — |
| `apps/ui/lib/plugins/registry.ts` | S | TJ | — |
| `apps/ui/lib/plugins/runtime-agent.ts` | SBN | TJ | — |
| `apps/ui/lib/plugins/runtime-assets-schema.ts` | P? | TJ | — |
| `apps/ui/lib/plugins/runtime-contract.ts` | P? | TJ | — |
| `apps/ui/lib/plugins/runtime-data-sync.ts` | S | TJ | — |
| `apps/ui/lib/plugins/runtime-environment.ts` | S | TJ | — |
| `apps/ui/lib/plugins/runtime-files.ts` | S | TJ | — |
| `apps/ui/lib/plugins/runtime-host.ts` | SBN | TJ | — |
| `apps/ui/lib/plugins/runtime-mcp.ts` | SBN | TJ | — |
| `apps/ui/lib/plugins/runtime-notes.ts` | S | TJ | — |
| `apps/ui/lib/plugins/runtime-page-contract.ts` | P? | TJ | — |
| `apps/ui/lib/plugins/runtime-reads.ts` | SBN | TJ | — |
| `apps/ui/lib/plugins/runtime-response.ts` | S | TJ | — |
| `apps/ui/lib/plugins/runtime-settings.ts` | S | TJ | — |
| `apps/ui/lib/plugins/runtime-state.ts` | S | TJ | — |
| `apps/ui/lib/plugins/runtime-terminal.ts` | B | TJ | — |
| `apps/ui/lib/plugins/runtime-theme-contract.ts` | P? | TJ | — |
| `apps/ui/lib/plugins/runtime-theme-files.ts` | P? | TJ | — |
| `apps/ui/lib/plugins/runtime.ts` | S | TJF | — |
| `apps/ui/lib/plugins/source.ts` | S | TJ | — |
| `apps/ui/lib/plugins/store.ts` | S | TJ | — |
| `apps/ui/lib/plugins/theme-availability-schema.ts` | P? | TJ | — |
| `apps/ui/lib/plugins/theme-effects-schema.ts` | P? | TJ | — |
| `apps/ui/lib/plugins/theme-palette-schema.ts` | P? | TJ | — |
| `apps/ui/lib/plugins/types.ts` | P? | TJ | — |
| `apps/ui/lib/plugins/views.ts` | S | TJ | — |
| `apps/ui/lib/process-env.ts` | S | TJF | — |
| `apps/ui/lib/process-lock.ts` | S | TJF | — |
| `apps/ui/lib/profile-state.ts` | S | TJSF | — |
| `apps/ui/lib/qa/accessibility-source.ts` | P? | T | — |
| `apps/ui/lib/qa/credentials.ts` | S | T | — |
| `apps/ui/lib/qa/desktop.ts` | S | T | — |
| `apps/ui/lib/qa/interrupted-receipt.ts` | P? | T | — |
| `apps/ui/lib/qa/jev-summary.ts` | P? | TJF | — |
| `apps/ui/lib/qa/lease.ts` | S | T | — |
| `apps/ui/lib/qa/schema.ts` | P? | TJF | — |
| `apps/ui/lib/qa/service.ts` | SB | T | — |
| `apps/ui/lib/qa/store.ts` | S | TJF | — |
| `apps/ui/lib/qa/vision.ts` | SB | T | — |
| `apps/ui/lib/repos/git-parsers.ts` | P? | TJF | — |
| `apps/ui/lib/repos/health.ts` | S | TJF | — |
| `apps/ui/lib/repos/index.ts` | S | TJF | — |
| `apps/ui/lib/repos/remote-parsers.ts` | P? | TJF | — |
| `apps/ui/lib/repos/resolution.ts` | S | TJF | — |
| `apps/ui/lib/repos/upstart.ts` | S | TJF | — |
| `apps/ui/lib/repos/worktree-cleanup.ts` | SB | T | — |
| `apps/ui/lib/repos/worktree-parsers.ts` | P? | TJF | — |
| `apps/ui/lib/request-error.ts` | P? | T | — |
| `apps/ui/lib/schemas.ts` | P? | TJ | — |
| `apps/ui/lib/server-utils.ts` | S | TJ | — |
| `apps/ui/lib/setup/dependencies.ts` | S | TJF | — |
| `apps/ui/lib/setup/git-availability.ts` | S | TJF | — |
| `apps/ui/lib/setup/git-check.ts` | S | TJF | — |
| `apps/ui/lib/setup/git-copy.ts` | P? | TJF | — |
| `apps/ui/lib/sidebar-counts-cache.ts` | P? | TJ | — |
| `apps/ui/lib/skill-catalog.ts` | S | TJ | — |
| `apps/ui/lib/skills/api-types.ts` | P? | TJ | — |
| `apps/ui/lib/skills/provenance.ts` | S | TJ | — |
| `apps/ui/lib/skills/shared.ts` | S | TJ | — |
| `apps/ui/lib/skills/usage.ts` | S | T | — |
| `apps/ui/lib/skills/vendor-audit.ts` | S | TJ | — |
| `apps/ui/lib/standup/config.ts` | P? | TJF | — |
| `apps/ui/lib/standup/git.ts` | S | TJF | — |
| `apps/ui/lib/storage-server.ts` | SB | TJSF | S |
| `apps/ui/lib/storage.ts` | S | TJSF | S |
| `apps/ui/lib/storyboard/attention.ts` | P? | TJF | — |
| `apps/ui/lib/storyboard/auto-mode.ts` | SBN | T | — |
| `apps/ui/lib/storyboard/auto-phase.ts` | P? | T | — |
| `apps/ui/lib/storyboard/auto-tiers.ts` | P? | T | — |
| `apps/ui/lib/storyboard/errors.ts` | S | TJ | — |
| `apps/ui/lib/storyboard/failure-acknowledgements.ts` | S | T | — |
| `apps/ui/lib/storyboard/launch-options.ts` | P? | TJF | — |
| `apps/ui/lib/storyboard/model-tiers-shared.ts` | P? | TJF | — |
| `apps/ui/lib/storyboard/model-tiers.ts` | S | TJ | — |
| `apps/ui/lib/storyboard/next-action.ts` | B | T | — |
| `apps/ui/lib/storyboard/notes-board-shared.ts` | P? | TJF | — |
| `apps/ui/lib/storyboard/notes-board.ts` | SB | T | — |
| `apps/ui/lib/storyboard/orchestration-store.ts` | S | TJ | — |
| `apps/ui/lib/storyboard/orchestration.ts` | P? | TJF | — |
| `apps/ui/lib/storyboard/orchestrator.ts` | SBN | T | — |
| `apps/ui/lib/storyboard/preview.ts` | S | T | — |
| `apps/ui/lib/storyboard/schema.ts` | P? | TJF | — |
| `apps/ui/lib/storyboard/stop-task-work.ts` | SBN | T | — |
| `apps/ui/lib/storyboard/task-detail.ts` | P? | T | — |
| `apps/ui/lib/storyboard/task-tiers.ts` | S | TJ | — |
| `apps/ui/lib/storyboard/types.ts` | P? | TJF | — |
| `apps/ui/lib/storyboard/ui-detect.ts` | P? | T | — |
| `apps/ui/lib/storyboard/work-insights.ts` | P? | T | — |
| `apps/ui/lib/sync/mcp.ts` | S | TJ | — |
| `apps/ui/lib/sync/skills.ts` | S | TJ | — |
| `apps/ui/lib/task-note.ts` | P? | TJF | — |
| `apps/ui/lib/tasks/add-user-note-server.ts` | SBN | T | T |
| `apps/ui/lib/tasks/add-user-note.ts` | P? | T | T |
| `apps/ui/lib/tasks/alert-drafts.ts` | SBN | T | T |
| `apps/ui/lib/tasks/auto-prompts.ts` | P? | T | T |
| `apps/ui/lib/tasks/capture.ts` | SBN | T | T |
| `apps/ui/lib/tasks/create-draft-pr.ts` | SBN | T | T |
| `apps/ui/lib/tasks/create-pr-prompt.ts` | P? | T | T |
| `apps/ui/lib/tasks/feedback-prompt.ts` | P? | T | T |
| `apps/ui/lib/tasks/feedback-worktree.ts` | SB | T | T |
| `apps/ui/lib/tasks/group-by-parent.ts` | P? | T | T |
| `apps/ui/lib/tasks/implement-prompt.ts` | P? | TF | T |
| `apps/ui/lib/tasks/implement-ready-gather.ts` | SBN | TF | T |
| `apps/ui/lib/tasks/implement-ready-prefs.ts` | S | T | T |
| `apps/ui/lib/tasks/implement-ready.ts` | P? | TF | T |
| `apps/ui/lib/tasks/implement-repo.ts` | P? | T | T |
| `apps/ui/lib/tasks/implement-review-prefs.ts` | S | T | T |
| `apps/ui/lib/tasks/implement-review-prompt.ts` | P? | T | T |
| `apps/ui/lib/tasks/jira-intake.ts` | SBN | T | T |
| `apps/ui/lib/tasks/legacy-attention-id.ts` | S | TJF | T |
| `apps/ui/lib/tasks/note-tags.ts` | S | T | T |
| `apps/ui/lib/tasks/owner-notes-server.ts` | SB | TJ | T |
| `apps/ui/lib/tasks/owner-notes.ts` | P? | TJF | T |
| `apps/ui/lib/tasks/plan-markdown.ts` | SBN | T | T |
| `apps/ui/lib/tasks/plan-status-labels.ts` | P? | TF | T |
| `apps/ui/lib/tasks/plan-status.ts` | SBN | TF | T |
| `apps/ui/lib/tasks/plan-task-agent.ts` | SBN | T | T |
| `apps/ui/lib/tasks/profile-context.ts` | S | TJSFC | T |
| `apps/ui/lib/tasks/profile-request.ts` | SN | TJF | T |
| `apps/ui/lib/tasks/profile-scope.ts` | P? | T | T |
| `apps/ui/lib/tasks/profile-types.ts` | P? | T | T |
| `apps/ui/lib/tasks/profiles.ts` | SB | T | T |
| `apps/ui/lib/tasks/ready-linked-prs.ts` | SB | T | T |
| `apps/ui/lib/tasks/reconcile-task-agent-sidecar.ts` | SBN | T | T |
| `apps/ui/lib/tasks/reopen-feedback.ts` | SBN | T | T |
| `apps/ui/lib/tasks/reopen-task.ts` | SBN | T | T |
| `apps/ui/lib/tasks/resolve-task-input.ts` | B | TJF | T |
| `apps/ui/lib/tasks/resume-task-agent.ts` | SBN | T | T |
| `apps/ui/lib/tasks/retro-inputs.ts` | SB | T | T |
| `apps/ui/lib/tasks/run-snapshot.ts` | S | TJF | T |
| `apps/ui/lib/tasks/seed-jira-summary.ts` | SB | TJF | T |
| `apps/ui/lib/tasks/source-context.ts` | SBN | TF | T |
| `apps/ui/lib/tasks/storage.ts` | SB | TJF | T |
| `apps/ui/lib/tasks/task-agent-resume.ts` | P? | TF | T |
| `apps/ui/lib/tasks/task-agent-runs.ts` | S | TJF | T |
| `apps/ui/lib/tasks/task-index.ts` | S | TJF | T |
| `apps/ui/lib/tasks/task-note-sections.ts` | SB | TJF | T |
| `apps/ui/lib/tasks/task-notes.ts` | S | TJF | T |
| `apps/ui/lib/tasks/task-pr-watch.ts` | SBN | T | T |
| `apps/ui/lib/tasks/task-text.ts` | B | TJ | T |
| `apps/ui/lib/tasks/today-attention.ts` | S | TJF | T |
| `apps/ui/lib/tasks/types.ts` | P? | TJF | T |
| `apps/ui/lib/tasks/use-task-agent-runs.ts` | B | T | T |
| `apps/ui/lib/tasks/weekly.ts` | P? | T | T |
| `apps/ui/lib/terminal-inject.ts` | B | TJF | — |
| `apps/ui/lib/terminal-meta.ts` | P? | TJF | — |
| `apps/ui/lib/terminal-proposals.ts` | B | TJF | — |
| `apps/ui/lib/terminal-sessions-registry.ts` | P? | TJF | — |
| `apps/ui/lib/ttl-cache.ts` | P? | TJF | — |
| `apps/ui/lib/upstream-skills-cache.ts` | S | TJ | — |
| `apps/ui/lib/upstream-skills-refresh.ts` | S | TJ | — |
| `apps/ui/lib/utils.ts` | B | TJF | — |
| `apps/ui/lib/vault/vault-codec.ts` | P? | TJSF | — |
| `apps/ui/lib/vault/vault-path.ts` | B | TJSF | — |
| `apps/ui/lib/vault/vault-public.ts` | B | TJSF | — |
| `apps/ui/lib/vault/vault-registry.ts` | SB | TJSF | — |
| `apps/ui/lib/vault/vault-storage.ts` | S | TJSF | — |
| `apps/ui/lib/workflows/fingerprint.ts` | S | TJ | — |
| `apps/ui/lib/workflows/schema.ts` | P? | TJF | — |
| `apps/ui/lib/workflows/service.ts` | SBN | T | — |
| `apps/ui/lib/workflows/store.ts` | S | TJF | — |
| `apps/ui/lib/workflows/types.ts` | P? | TJF | — |
| `packages/shared/actions/define.ts` | P? | TJF | — |
| `packages/shared/actions/integrations.ts` | P? | TJ | — |
| `packages/shared/actions/repos.ts` | P? | TJ | — |
| `packages/shared/actions/share.ts` | P? | TJ | — |
| `packages/shared/actions/storyboard.ts` | P? | TJF | — |
| `packages/shared/actions/tasks.ts` | P? | TJ | — |
| `packages/shared/actions/work.ts` | P? | TJ | — |
| `packages/shared/actions/workflows.ts` | P? | T | — |
| `packages/shared/actions/workspace.ts` | P? | TJ | — |
| `scripts/workspace-paths.mjs` | S | TJSFC | — |
| `shared/entity-note/index.ts` | P? | TJSF | — |
| `shared/integration-ref.ts` | P? | TJSF | — |
| `shared/markdown-convert/index.ts` | P? | TJF | — |
| `shared/mcp-history/index.ts` | S | T | — |
| `shared/notes-assets/index.ts` | S | TJSF | — |
| `shared/notes-assets/markdown.ts` | P? | TJSF | — |
| `shared/notes-assets/server.ts` | S | TJSF | — |
| `shared/plugin-registry/materialization.generated.ts` | P? | TJ | — |
| `shared/storage/contracts.ts` | P? | TJSF | S |
| `shared/storage/file/tasks.ts` | S | TJSF | S |
| `shared/storage/index.ts` | S | TJSF | S |
| `shared/storage/sqlite/db.ts` | S | TJSF | S |
| `shared/task-note/agent-updates.ts` | S | T | — |
| `shared/task-note/index.ts` | P? | TJSF | — |
| `shared/task-note/meta.ts` | P? | TJSF | — |
| `shared/task-note/qa-scenario.ts` | P? | TJF | — |
| `shared/task-note/rank.ts` | P? | TJSF | — |
| `shared/task-note/resolve.ts` | P? | TJF | — |
| `shared/task-note/sections.ts` | P? | TJF | — |
| `shared/task-note/status-update.ts` | P? | TJF | — |
| `shared/task-note/update.ts` | S | TJF | — |
| `shared/tasks/chains.ts` | S | TJF | — |
| `shared/tasks/dates.ts` | P? | TJSF | — |
| `shared/tasks/json.ts` | P? | TJSF | — |
| `shared/tasks/migrate.ts` | S | TJF | — |
| `shared/tasks/paths.ts` | S | TJSF | — |
| `shared/tasks/rank.ts` | P? | TJSF | — |
| `shared/tasks/runs.ts` | S | TJF | — |
| `shared/tasks/store.ts` | S | TJSF | — |
| `shared/tasks/types.ts` | P? | TJSF | — |
| `shared/tasks/view.ts` | P? | TJSF | — |
| `shared/vault/atomic-write.ts` | S | TJSFC | — |
| `shared/vault/content-dirs.ts` | S | TJSFC | — |
| `shared/vault/task-profiles.ts` | S | TJSFC | — |
| `shared/vault/vault-codec.ts` | P? | TJSF | — |
| `shared/vault/vault-path.ts` | P? | TJSF | — |
| `shared/vault/vault-routes.ts` | P? | T | — |
| `shared/vault/vault-storage.ts` | S | TJSF | — |

### b) Scheduler and jobs (74 files)

| File | Class | In closures | Seed |
| --- | --- | --- | --- |
| `apps/ui/lib/ai/cli-limit.ts` | P? | JF | — |
| `apps/ui/lib/capability/aggregate.ts` | S | J | — |
| `apps/ui/lib/capability/ai-enrich.ts` | SB | J | — |
| `apps/ui/lib/capability/detectors.ts` | P? | J | — |
| `apps/ui/lib/capability/diff.ts` | S | J | — |
| `apps/ui/lib/capability/digest.ts` | SB | J | — |
| `apps/ui/lib/capability/exposure.ts` | S | J | — |
| `apps/ui/lib/capability/github-probe.ts` | SB | J | — |
| `apps/ui/lib/capability/headline.ts` | P? | J | — |
| `apps/ui/lib/capability/local-scan.ts` | SB | J | — |
| `apps/ui/lib/capability/paths.ts` | S | J | — |
| `apps/ui/lib/capability/scan.ts` | SB | J | — |
| `apps/ui/lib/capability/snapshots.ts` | S | J | — |
| `apps/ui/lib/capability/types.ts` | P? | J | — |
| `apps/ui/lib/collect/agents.ts` | S | J | — |
| `apps/ui/lib/collect/mcp.ts` | S | J | — |
| `apps/ui/lib/collect/opencode-config.ts` | S | J | — |
| `apps/ui/lib/collect/persona.ts` | S | J | — |
| `apps/ui/lib/collect/skills.ts` | S | J | — |
| `apps/ui/lib/collect/stage.ts` | S | J | — |
| `apps/ui/lib/git/change-coupling.ts` | S | JF | — |
| `apps/ui/lib/git/commit-refs.ts` | P? | J | — |
| `apps/ui/lib/git/hook-failure-persist.ts` | S | J | — |
| `apps/ui/lib/git/hook-failure.ts` | P? | J | — |
| `apps/ui/lib/github/commit-authors.ts` | S | JF | — |
| `apps/ui/lib/keep-awake.ts` | S | J | — |
| `apps/ui/lib/local/catalog-compare.ts` | S | J | — |
| `apps/ui/lib/local/skills-types.ts` | P? | J | — |
| `apps/ui/lib/notes/note-areas.ts` | P? | J | — |
| `apps/ui/lib/notes/note-index.ts` | S | J | — |
| `apps/ui/lib/opencode/secrets.ts` | P? | J | — |
| `apps/ui/lib/ownership/brief.ts` | SB | J | — |
| `apps/ui/lib/ownership/domains.ts` | S | JF | — |
| `apps/ui/lib/ownership/index-view.ts` | B | JF | — |
| `apps/ui/lib/ownership/obligations.ts` | P? | JF | — |
| `apps/ui/lib/ownership/owned-repos.ts` | S | JF | — |
| `apps/ui/lib/ownership/service.ts` | SB | JF | — |
| `apps/ui/lib/ownership/teams.ts` | P? | JF | — |
| `apps/ui/lib/ownership/types.ts` | P? | JF | — |
| `apps/ui/lib/paseo/context.ts` | SBN | J | — |
| `apps/ui/lib/people/identity.ts` | P? | JF | — |
| `apps/ui/lib/people/repo-people.ts` | SB | JF | — |
| `apps/ui/lib/persona-meta.ts` | P? | J | — |
| `apps/ui/lib/pull-core.ts` | S | J | — |
| `apps/ui/lib/repos/change-impact.ts` | SB | JF | — |
| `apps/ui/lib/repos/domains.ts` | S | JF | — |
| `apps/ui/lib/repos/worktree-info.ts` | P? | J | — |
| `apps/ui/lib/repos/worktree-integration.ts` | S | J | — |
| `apps/ui/lib/repos/worktree-inventory.ts` | SB | J | — |
| `apps/ui/lib/repos/worktree-maintenance.ts` | SB | J | — |
| `apps/ui/lib/repos/worktree-merge.ts` | S | J | — |
| `apps/ui/lib/repos/worktree-report.ts` | SB | J | — |
| `apps/ui/lib/repos/worktree-xcode-cache.ts` | S | J | — |
| `apps/ui/lib/run-history-path.ts` | S | JF | — |
| `apps/ui/lib/scheduler-log.ts` | S | J | J |
| `apps/ui/lib/scheduler-paths.ts` | S | J | J |
| `apps/ui/lib/scheduler-plan.ts` | P? | J | J |
| `apps/ui/lib/scheduler.ts` | SBN | J | J |
| `apps/ui/lib/scripts-runner.ts` | SBN | J | — |
| `apps/ui/lib/setup/private-repo.ts` | S | J | — |
| `apps/ui/lib/standup/github-merged.ts` | S | JF | — |
| `apps/ui/lib/status.ts` | P? | JF | — |
| `apps/ui/lib/storyboard/cleanup-work.ts` | SB | J | — |
| `apps/ui/lib/sync/agents.ts` | S | J | — |
| `apps/ui/lib/sync/cowork.ts` | S | J | — |
| `apps/ui/lib/sync/opencode-config.ts` | S | J | — |
| `apps/ui/lib/sync/orchestrator.ts` | SBN | J | — |
| `apps/ui/lib/sync/persona.ts` | SBN | J | — |
| `apps/ui/lib/terminal-ansi.ts` | P? | J | — |
| `apps/ui/lib/terminal-log.ts` | S | J | — |
| `apps/ui/lib/terminal-search.ts` | S | J | — |
| `apps/ui/lib/tree-compare.ts` | S | J | — |
| `apps/ui/lib/validate.ts` | S | J | — |
| `apps/ui/lib/wake-helper.ts` | S | J | — |

### c) Calendar (retained rows)

| File | Class | In closures | Seed |
| --- | --- | --- | --- |
| `apps/ui/lib/agent/cli-env.ts` | S | F | — |
| `apps/ui/lib/ai/cli-runner.ts` | S | F | — |
| `apps/ui/lib/ai/cursor-models.ts` | S | F | — |
| `apps/ui/lib/ai/generate.ts` | SB | F | — |
| `apps/ui/lib/ai/preference.ts` | S | F | — |
| `apps/ui/lib/calendar-cache.ts` | P? | C | C |
| `apps/ui/lib/calendar-selection.ts` | S | FC | C |
| `apps/ui/lib/google-calendar.ts` | S | FC | C |
| `apps/ui/lib/opencode/command.ts` | S | F | — |
| `apps/ui/lib/opencode/listen.ts` | S | F | — |
| `apps/ui/lib/peer-service-availability.ts` | S | F | — |
| `apps/ui/lib/port-probe.ts` | S | F | — |
| `apps/ui/lib/run-history.ts` | S | F | — |
