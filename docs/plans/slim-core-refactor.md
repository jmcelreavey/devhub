---
title: Slim core refactor
description: Checklist for cutting DevHub down to a smaller core, moving side features to plugins, merging pages and reviewing the runtime.
order: 1
icon: ListChecks
tags: [plans, refactor]
---

# Slim core refactor

Status: in progress, started 26 October 2026 on `refactor/slim-core`. Work now lands directly on `main`; tick items as they land.

Starting point: about 370k lines of TypeScript, about 100k of them tests. 319 API route files, 58
pages, 128 SWR polling intervals, 109 sync subprocess calls, 4 dev processes plus a file-copying
plugin materializer.

Goal: a smaller core that does tasks, notes, repos/PRs, agents, terminal and jobs well, with
everything else in a plugin or gone.

## 0. Tests: go lighter

- [x] Write the test policy: [Testing](../contributing/testing.md)
- [x] Point agents at it from `AGENTS.md` and `devhub-implement-task`
- [x] Cull pass 1: dashboard render tests, route tests, presentation and copy tests (825 → 175 files; kept data, security and path tests plus `lib/storyboard/auto-mode.test.ts`)
- [x] Cull pass 2: `mcp-servers/`, `shared/`, `desktop/`, `gateway/`
- [x] Keep the slimmed Playwright e2e suite: CI runs it on Chromium and WebKit

## 1. Delete

- [x] Pong easter egg: `components/shell/pong/`, `KonamiPong.tsx`, `KonamiGate.tsx`
- [x] Demo and social recording scripts: `dashboard/scripts/record-*.ts`, `social-*.ts`, `scripts/demos/`
- [x] Research digests page: `/research`. Briefing can still queue Last30Days digs into `notes/research/`; decide when Today absorbs Briefing.
- [x] code-server runtime from `/editor`. Pairing and Send to AI stay.
- [x] Redirect-only routes: `/brief`, `/activity`, `/agent-activity`, `/chamber`, `/opencode`, `/own`, `/tickets`, `/tasks`, `/workflow`, `/collections`
- [x] Pong leftovers: `scripts/pong-assets/`, `private/scripts/pong-assets/`, `private/docs/guides/pong-easter-egg.md`
- [x] Keep Windows, WSL and Docker desktop targets (`desktop/windows`, `desktop/wsl`, `desktop/docker`) working through the runtime and storage changes.
  Checked on 31 Oct: native Windows tests pass on Windows host, WSL runs the service, and the Docker fixture gate passes on a clean clone. Dispatching Windows CI and an isolated Mac session stay manual.
- [x] LAN proxy, mobile shelf and PWA; use Paseo for phone access
- [x] Root clutter: archive the local results and private planning documents

## 2. Move to plugins

- [x] Hollow → first seasonal theme pack on the plugin theme-effects schema (`lib/plugins/theme-effects-schema.ts`); remove `HollowGate` from `app/layout.tsx`
- [x] Christmas pack on the same path
  Both packs are registered locally and their source is on private remotes. Installed packaging still needs checking.
- [x] Appraisal (`/appraisal`) and 1:1 (`/one-on-one`) → career plugin
  Core removal is on main and the plugin source is on a private remote. Installed packaging still needs checking.
- [x] Team Slack gateway (`gateway/`, `shared/slack-gateway`, `lib/integrations/slack`) and `/team/answer` → team plugin
  Core removal and local enable/disable checks are complete; the plugin source is on a private remote. Installed packaging and a live Slack exchange still need checking.
- [x] Datadog (`/datadog`) → the BI plugin
  Core removal and local enable/disable checks are complete. BI source is on its private remote main; installed packaging still needs checking.

Staying in core: My voice (`/voice`), Live links (`/shared`), editor pairing and Send to AI, QA and Jev.

## 2a. Make QA actually run

Jev routing in Slack works well and stays as it is. The QA side (`/qa`, `lib/qa/`, `packages/qa`, Jev review in Storyboard auto mode) almost never runs.

- [x] Find out why: trace an auto-mode task from build to review in `lib/storyboard/auto-mode.ts` and `orchestrator.ts`, and check where the QA run is meant to start (`lib/qa/service.ts`, the `storyboard_jev_run` and `storyboard_jev_review` MCP tools)
- [x] Check the preconditions it silently needs: `TYPESAFE_API_KEY`, a runnable preview (`lib/storyboard/preview.ts`, `ui-detect.ts`), the QA lease and the model tier settings
- [x] Make a skipped QA run say why on the task card instead of doing nothing
- [x] Run it end to end on one real UI task and keep the receipt
- [x] Keep `/qa` for manual scenarios and run history; task Evidence links to the same receipt

Manual QA, 27 October 2026: a task-linked Jev run passed against the Library change in `c29a971ec`
with isolated data, and its receipt and video were retained. The verification task was created after
the change and its Storyboard record was initialised manually. The user accepted this for the checklist;
automatic task-to-QA verification remains an active follow-up. A separate Chromium check at 320px covered the mobile layout. Task:
`486af1c0-0629-4c5a-be46-06277aa7e81c`; run: `f208f08e-289f-4f86-9c73-74d41ebb83cd`.

Investigation, 26 October 2026: auto mode checks for a UI change, then starts QA alongside code review
after the draft PR. It skips when there is no runnable preview; GitHub and PR links are not app
previews. The old generated scenario also expected the task title and acceptance text to appear
literally in the page, and offered visible controls to the runner. That is neither a reliable
outcome check nor safe against a preview connected to real data. `storyboard_jev_run` starts a
saved scenario manually; `storyboard_jev_review` only reads results.

Jev decisions need `TYPESAFE_API_KEY` (or a configured fallback); assertions can finish without a
model call. A run also needs a reachable preview, Chrome and Playwright's video binary, a free QA
lease and room under the two-heavy-job limit. Model tiers select the code-review agent, not Jev's
credentials. A baseline video only runs when requested before implementation.

Preview ownership, 27 October 2026: a different process can take the chosen port after the free-port
check. A responsive URL and a still-running preview child were enough for auto QA to treat that
other server as the task's preview. Bind the QA connection to the launched preview before treating
automatic review as verified; a port check alone does not prove ownership.

## 3. Merge pages (UX)

- [x] **Today** (`/`): absorb `/briefing` and a calendar panel; one "needs you" queue (tasks, PRs, alerts, agents waiting)
  The page merge is accepted. Older agent and workflow activity is shown as anonymous counts when profile ownership is unknown; individual legacy actions remain a follow-up.
- [x] **Search**: fold `/recall` in as a mode
- [x] **Library**: notes, docs, learnings and diagrams as one place with filters
- [x] **Work**: `/work` and `/storyboard` as one pipeline (task → branch → agent → PR); `/review` and `/review/rep` become views
- [x] **Repos**: radar, conventions, repo learning and owned repos as tabs
- [x] **Settings**: status, logs, actions, setup, recovery, plugins, skills, skill proposals and changelog
- [x] Editor pairing button moves into Repos → Changes; old `/editor` links redirect there
- [x] Command palette as the main way around; sidebar down to the destinations above
- [x] Themes: Graphite Neon light and dark, plus seasonal packs
  The local packs include Halloween, Christmas, Easter, St Patrick's, Valentine's and New Year; saved choices are preserved outside their picker windows. Packaged delivery is still unverified.

## 4. Architecture

The user accepted the QA, page and developer-experience sections while their specific follow-ups continue.
The aim is a smaller, simpler DevHub, not a rewrite for its own sake.

- [x] **Simplification audit:** reviewed the plugin registry, materialisation receipts and packaging staging. Keep the existing receipt to stop stale built contributions making new calls after disable, and staged replacement to protect installed files. Reuse existing executable checks and Git conflict handling rather than adding duplicate helpers. The copy-based plugin workflow still needs a clearer source-of-truth experience.

Keep that audit short and work from the real checkout, not another set of parallel prototypes.
For each architecture change:

- Say what existing complexity it removes and how to check the improvement; avoid extra processes, layers or compatibility paths without a current need.
- Ship a working slice and remove the code it replaces. Use existing code where it already works rather than building a second implementation.
- Follow the [lightweight test policy](../contributing/testing.md): keep focused data-loss and security coverage, but don't repeat the same proof across several temporary setups. Run the relevant tests while working and the full suite once before delivery.
- Preserve existing links, settings, notes, plugin behaviour and supported desktop targets. Don't trade away safety or working features just to reduce line counts.

The user reopened the architecture work on 28 October. Implement it in working slices, remove the code
each slice replaces, and keep existing data, links, plugins and the installed app's origin intact.
Tick an item only when the change and its relevant checks are complete.

### Longer-term direction

DevHub should be able to run its core in the cloud later, with a local desktop shell and agent
connecting to it. Multiple users are a possible next step, not a capability the current app has.
Keep a standalone local install working throughout this refactor.

- Separate core services and their API from the dashboard and from machine-local operations.
  Git, terminals, local files and other host commands stay with a trusted local agent; a hosted
  core must not assume it can access the user's machine or credentials directly.
- Use explicit user and workspace ownership in shared contracts. A hosted multi-user deployment
  needs authentication, authorisation and isolation across data, events, jobs, plugins and local
  agent actions before it is safe to expose. Today's task profiles are not user accounts.
- Keep storage behind a domain interface: SQLite can serve local installs without deciding the
  eventual hosted database or cloud provider now. Preserve existing data during migration.
- Keep plugin permissions and local credential access explicit. Don't add another runtime or
  cloud deployment merely to prepare for a future requirement.

- [x] **Subprocesses:** replace the remaining synchronous calls and coordinate Git writes across processes. Done: runtime subprocesses are asynchronous (the last plugin `spawnSync` went in cdab22ec8), and core Git writers, including plugin materialisation, take the shared Git-directory queue; reads outside the queue set `GIT_OPTIONAL_LOCKS=0`. Direct external Git writers and older installed builds do not take this lock.
- [x] Extract core storage, jobs and events from the dashboard; run Git and machine-local subprocesses through a local agent. Support both a local core and a future hosted core. Core lives in `apps/core` and machine-local work goes through one local-ops seam (cb4f54b81, merged 836c8bb8c). Cloud phase done locally: storage seam with SQLite + Postgres adapter, opt-in local-agent transport; a hosted deployment and multi-user auth remain future work. The storage slice is agent request claims; see [Local cloud seams](../architecture/local-cloud-seams.md) for the limits.
- [x] Make MCP use the same core API as the dashboard rather than a dashboard-specific HTTP API. Done: MCP calls the core server's routes (81a7a05a2, ae72f4966); there is no separate dashboard API since Next was removed.
- [x] Move tasks, runs, jobs and history to SQLite locally behind a storage interface, preserving existing data. Done, narrowed: agent runs use SQLite by default (a1a240546) behind the storage interface; tasks, jobs and history stay as files by plan decision.
- [x] Replace SWR polling with a core event stream, including reconnection and hidden-tab catch-up. Done, narrowed: core event stream with per-domain health and reconnect catch-up (6782c1ec3); local data polls only while the stream is unhealthy. Remaining intervals poll external sources (GitHub, Jira, Calendar, Datadog).
- [x] Generate API routes and MCP tools from shared domain schemas. Done: every dashboard HTTP method is wired through a shared action contract or carries a specific classification in `packages/mcp/src/actions/contracts.test.ts` (no TODO exclusions left; vault routes keep documented HTTP-only semantics).
  Z13 shares the remaining core action contracts and classifies browser-only workflows, MCP resources/prompts and local shipping.
  Z14 is enforced by `packages/mcp/src/actions/contracts.test.ts`, which checks each tracked HTTP method against its action contract or a documented TODO exclusion. Audit retirement remains open.
- [x] Replace dashboard plugin materialisation with runtime registration. Done: manifests reject `dashboard`; pages, navigation, themes and services use reviewed runtime contributions. Core no longer copies plugin UI sources or generates branding or providers in the checkout.
  PL12 is complete: Career `0d0b545` publishes the version-two MCP descriptor
  in 0.3.5, retaining the released worker and all eight tool contracts. Its real
  registration now uses a reviewed managed snapshot with the same ID and enabled
  state; the old source and appraisal/meeting vault bytes were preserved. The
  running installed app followed both legacy redirects and rendered the runtime
  Appraisal page in its authenticated desktop session without a restart.
  The isolated 1437 fixture passed task CRUD/health, old/new pages and APIs,
  validation, foreign-origin refusal, keyboard and disable/re-enable checks.
  Headless stdio parity, all tools, stale-peer replacement and enabled/disabled
  legacy migrations passed, as did 27 Career tests, strict build, changed-source
  lint and normal core verify (282 files, 3,053 passed, six skipped). Build-path
  labels changed during the rebuild check; the released worker bytes were kept.
  PL13a adds reviewed `permissions.publicEnv` so public profile names and service
  domains survive provider responses while credentials remain redacted. Reviewed
  names resolve current saved settings without granting access to the host file;
  injected contexts remain isolated. BI runtime
  0.8.2 bundles its existing Datadog provider through PL06, preserving setup,
  application-key aliases, sites, queries and alert mapping. Its 15 runtime tests,
  27 focused core checks and real worker/provider checks pass. The 1437 app passed
  provider accounts, internal HTTP refusal, disable/re-enable, task CRUD/health and
  the Career regression smoke. No real BI registration or cloud action occurred.
  The trusted headless adapter now loads through the scoped CJS loader; all nine
  MCP checks pass on Node 22 and 24, including real stdio outside the dashboard.
  The provider fixture omits legacy MCP sources: startup otherwise installs their
  dependencies inside the approved snapshot and invalidates its tree hash. PL14
  must port that path before real BI cutover.
  PL13b completes the BI providers in runtime 0.8.3 (private plugin `a56bd40`).
  It bundles the existing database provider, preserves IAM-derived scopes and IDs,
  caches IAM reads across workers, and retains preflight, credential resolution,
  write guards and invalidation. Reviewed POST routes return a public AWS_PROFILE
  patch for the host to merge into its existing settings; the worker cannot read
  that file. Home writes are limited to reviewed paths. The database UI confirms
  machine changes and renders structured worker failures without crashing.
  The 16 BI runtime tests, 33 focused core checks and real worker/provider fixture
  pass. On 1437, task CRUD/health, live profile changes, read-only/prd-write guards,
  disable/re-enable and keyboard/pending/error states pass; screenshots were
  inspected. Normal verify passes on pinned Node 22 (3,064 tests before the final
  error-parser regression; the normal pre-push hook covers that final change).
  No real BI registration, database socket or infrastructure write occurred.
  Plan progress is 10/20 full slices.
  PL14a ports six original GET aliases in runtime 0.8.4 (private plugin `10eeff1`):
  status, services, IAM config, DB access, user email and Tailscale. Four original
  MCP read tools retain their schemas, descriptions and output. The worker bundles
  those source contracts with locked dependencies; it needs no runtime install.
  All 17 plugin tests and the real 1437 alias/MCP, task CRUD, health, origin and
  disable/re-enable checks pass. No real registration or infrastructure changed.
  Normal verify on pinned Node 22 passes lint, types and 3,068 tests (six skipped).
  The first full run hit a Git-queue timeout during cold webpack compilation;
  its ten focused checks and the full quiet retry pass without a source change.
  The orchestrator requested a fresh agent after this sub-slice. PL14 stays open;
  plan progress remains 10/20 full slices. Continue with the remaining mutation,
  cluster/diagnostic and database HTTP routes, script streams/cancellation and
  remote-access contracts, then the Ops
  and Datadog views, repo slot and remaining original MCP tools. Retire legacy MCP
  dependency installation before real BI cutover. Then finish PL15 Team slots,
  PL16 Slack service, PL17 Hollow, PL18 Christmas, PL19 Seasonal, PL20 live
  navigation/aliases, PL21 copy-consumer removal and PL22 same-build/desktop proof.
  The external plugin plan records the fixture, clones, evidence and exact next
  steps. This paragraph records the earlier migration plan.
- [x] Split the loose `dashboard/lib/` files into domain folders. Done: 287 → 36 top-level files in `apps/ui/lib` (ae6ebf1d9, 16d6f7ebf).
- [x] Move components from route folders without a page into `components/`; existing routes and the owned-repo detail stay in `app/`.
- [x] Rearrange the repository into `apps/` and `packages/` workspaces. Done: `apps/{core,ui,desktop}` and `packages/{mcp,shared,qa}` with one root lockfile (75718e9dd, 407d27556).
- [x] Replace Next.js with a Vite SPA after moving its API routes. Done: Vite SPA served by the core; Next removed (7beb6a7f9, d37a3f446).

## 5. Developer experience

- [x] One `dev` command for core and UI without the `predev` materializer. Done: root `npm run dev` is the PL24 supervisor (80276a9cf); `predev` only generates core routes.
  Working slice: `npm run dev` starts the current Next.js backend, UI and terminal without
  `sync_plugins`; health checks and the editor extension build remain. Source-based plugins
  use existing copies. PL23 still needs every source registration migrated, the copy
  consumers removed and the same-build proof passed. Then verify root dev, plugin
  enable/disable and terminal WebSocket on 1437/1439 in a clean fixture. The existing
  `predev` health check and editor extension build already
  run without plugin sync. Separate core/UI supervision is PL24 in the Vite item after V15;
  it isn't a remaining step for this item. Keep this item open until PL23 passes.
  Checked 29 October at `a0d64dfd` in an independent clone with an empty fixture registry:
  root dev, environment health, extension build, home rendering and keyboard focus, task
  create/edit/read/delete, desktop health and a terminal command passed on 1437/1439.
  This proves core startup without copies; the real plugin migrations remain unverified
  here. The fixture was stopped and installed 1337 kept the same PID.
  Rechecked at `06a96df7` in a fresh independent clone on 29 October: root dev still
  runs the environment health check and editor-extension build without plugin sync.
  Home, task create/edit/read/delete, desktop health, a terminal command on 1439 and
  Chrome rendering/keyboard focus passed on 1437 with no plugin copies. This closes no
  further slice: item 3 still owns PL12–PL22, including real runtime migrations,
  copy-consumer removal and the same-build proof. PL23 and this item remain open until
  those pass. No real registration or plugin descriptor was changed. The fixture was
  stopped; the agent did not stop, restart or launch the installed app.
- [x] The packaged app and checkout use separate ports and data by default without colliding. Done: checkout defaults to 1437/1439/1440 and its own data; the packaged app keeps 1337/1339/1340 (1e8f9a390, 443c67445).
  Preserve the installed app's origin and saved WebView data. Unsupervised checkout development, including WSL, defaults to 1437/1439/1440; real installed-app and WSL checks remain open.
- [x] `verify` runs lint, typecheck and the slim test suite only; build check in CI
- [x] Keep the DevHub name; no rename or alias migration.

## Active follow-ups

- **Automatic QA:** no-PR verification and opt-in trusted command previews are implemented. A Next preview loaded in Chromium, and a reproducible busy-preview 502 is fixed. Verify Expo and retain a real automatic task-linked receipt; the manual receipt above is not proof of this path.
- **Today queue:** anonymous legacy activity counts are visible without exposing profile details. Item-level legacy actions still require reliable ownership; the counts can overlap.
- **Development isolation:** verify the checkout defaults against real installed apps, including WSL, without moving existing WebView drafts or duplicating shared background work. A standalone checkout must opt in to scheduling.
- **Plugin delivery and editing:** verify installed enable/disable and packaged behaviour. Edit plugin source, not its materialised core copy: syncing can overwrite changes made to the copy.
