# Scripts

DevHub scripts are split between root-level convenience scripts and dashboard lifecycle scripts.

## Root Scripts

Run these from the repo root.

| Command                  | Purpose                                                |
| ------------------------ | ------------------------------------------------------ |
| `npm install`            | Install dashboard dependencies and prepare local setup |
| `npm run dev`            | Start the dashboard in development mode                |
| `npm run start`          | Start the dashboard in production mode                 |
| `npm run build`          | Build the dashboard                                    |
| `npm run verify`         | Run lint, typecheck, and tests                         |
| `npm run lint`           | Run dashboard linting                                  |
| `npm run typecheck`      | Run TypeScript checks                                  |
| `npm run test`           | Run tests                                              |
| `npm run doctor`         | Run diagnostics                                        |
| `npm run setup`          | Show setup guidance                                    |
| `npm run electron`       | Start the Electron launcher                            |
| `npm run electron:build` | Build the Electron launcher                            |

## Bootstrap Script

```bash
bash scripts/install.sh
```

Use this on a new machine or when you want to re-run the full setup flow.

## Fork Workflow Scripts

For mirrors that track the public core via an `upstream` remote (see `CONTRIBUTING.md` and
the [Fork Workflow](../guides/fork-workflow.md) guide):

> The **pull** direction is also available from the dashboard **Actions** page —
> **Pull Core Updates (Preview)** (read-only) and **Pull Core Updates** (apply) wrap
> `devhub-update.sh`. The **push** (backport) direction stays CLI-only on purpose: it opens
> a public, irreversible PR and wants a deliberate human in the loop.

| Command                                                                                 | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bash scripts/devhub-update.sh [--since <ref>] [--dry-run] [--no-sync] [--mark-synced]` | Pull core updates from `upstream` by porting hunks (`git apply --3way`, since public history is unrelated), then validate + sync. Tracks the last pull in `refs/devhub/upstream-sync`; first run needs `--since`. `--mark-synced` records sync without applying (use after a backport). Guards: on main/master, upstream remote present, and no _non-personal_ uncommitted changes (live-dirty `notes/`/`tasks/`/`collections/`/`upstarts/` are ignored).                                                                             |
| `bash scripts/devhub-backport.sh <source-ref> [--base <ref>] [--execute] [--title "…"]` | Build a clean PR branch off `upstream` and port the feature's hunks onto it (`git apply --3way`, preserving public-side templatisation). Only explicit generic catalog paths are eligible (`skills/shared/`, never root-level local skills); personal data is excluded and added lines are leak-scanned. `--base` defaults to `<source-ref>^`. Previews by default; `--execute` pushes the branch to `upstream` and opens the PR.                                                                                                     |
| `bash scripts/devhub-ship.sh ["commit message"] [--dry-run] [--no-upstream]`            | One-shot **ship everything**: commit personal paths separately, import newer public-core changes, commit remaining work, push `origin main` (pre-push verify runs), preview and port the generic catalog patch onto `upstream` main directly (leak-scanned, no PR), then commit+push every enabled plugin repo. `--dry-run` prints the actual public patch, including committed divergence. Requires `main`/`master`. `--no-upstream` skips reconciliation and the public-core push. MCP `repo_ship` previews unless `confirm: true`. |

These call the CLI action runner, which is also usable directly:

```bash
cd dashboard
npx tsx scripts/run-action.ts validate                 # repo integrity checks
npx tsx scripts/run-action.ts sync_plugins             # materialise plugin dashboard + branding files only
npx tsx scripts/run-action.ts sync                     # skills + agents + MCP + persona → tools
npx tsx scripts/run-action.ts update_and_sync --push   # full origin update + sync
```

## Dashboard Lifecycle Scripts

The dashboard owns most operational scripts. They handle tasks such as:

- Health checks before startup.
- Full diagnostics.
- Post-install setup.
- Action runner execution.
- Plugin dashboard/branding materialisation before `dev`, `build`, `start`, and full sync.
- Chained OpenChamber and OpenCode startup (`start-peer-services.ts`; standalone `start-chamber.ts`, `start-opencode.ts`).
- 1Password secret fallback (`op-secrets.ts`) before services bind ports.
- Standup diagnostics.
- PWA icon generation.

Prefer root commands or dashboard UI actions unless you are debugging a specific script.

## In-Process Action Catalog

Maintenance actions run in-process via `dashboard/lib/scripts-runner.ts` (not shell scripts). The Actions page, Status page, top-bar sync indicator, and scheduled jobs all call `POST /api/scripts` with one of these IDs.

`GET /api/scripts` returns `{ scripts: string[], catalog: ScriptCatalogEntry[] }` where each catalog entry includes `id`, `label`, `description`, `mutates`, `effects[]`, and `cmd`.

### Git and content sync

| ID                      | Label                        | Mutates | Notes                                                         |
| ----------------------- | ---------------------------- | ------- | ------------------------------------------------------------- |
| `update_and_sync`       | Update & Sync                | yes     | Pull/rebase, sync skills+agents+persona, optional commit+push |
| `commit_dirty_push`     | Commit & Push Dirty Files    | yes     | `commitMessage` required (max 180 chars)                      |
| `sync_notes_tasks_push` | Sync content (Commit + Push) | yes     | `notes/`, `collections/`, `tasks/`, `docs/` only              |
| `sync_notes_push`       | Sync Notes (Commit + Push)   | yes     | Legacy notes-only variant                                     |
| `dry_run_scoped_sync`   | Dry Run Scoped Sync          | no      | Preview content sync without committing                       |
| `push_unpushed_commits` | Push Unpushed Commits        | yes     | Push existing ahead commits only                              |
| `pull_core_preview`     | Pull Core Updates (Preview)  | no      | Read-only upstream diff                                       |
| `pull_core`             | Pull Core Updates            | yes     | Apply upstream public-core changes                            |

### Catalog sync (repo → local tools)

| ID                     | Label                | Mutates | Optional POST fields                     |
| ---------------------- | -------------------- | ------- | ---------------------------------------- |
| `sync_skills`          | Sync Skills          | yes     | `prune`, `skills[]`, `excludeSkills[]`   |
| `sync_agents`          | Sync Agents          | yes     | `prune`, `agents[]`, `excludeAgents[]`   |
| `sync_mcp_servers`     | Sync MCP Servers     | yes     | `prune`, `servers[]`, `excludeServers[]` |
| `sync_native_persona`  | Sync Persona         | yes     | —                                        |
| `sync_opencode_config` | Sync OpenCode Config | yes     | —                                        |

### Collect (local tools → repo)

| ID                          | Label                   | Mutates | Optional POST fields                                         |
| --------------------------- | ----------------------- | ------- | ------------------------------------------------------------ |
| `collect_local_skills`      | Collect Skills          | yes     | `importSkillNames[]`, `excludeSkills[]`                      |
| `collect_local_agents`      | Collect Agents          | yes     | `importAgentNames[]`, `excludeAgents[]`                      |
| `collect_local_mcp_servers` | Collect MCP Servers     | yes     | `importServerNames[]`, `excludeServers[]`, `importMcpTarget` |
| `collect_opencode_config`   | Collect OpenCode Config | yes     | —                                                            |
| `collect_local_persona`     | Collect Persona         | yes     | `personaTool` (required), `personaSources[]`                 |

### Validation

| ID                  | Label                    | Mutates |
| ------------------- | ------------------------ | ------- |
| `validate`          | Validate                 | no      |
| `verify_sync`       | Verify Sync Health       | no      |
| `capability_digest` | Weekly Capability Digest | yes     | Runs scan + diff + digest; writes `notes/learnings/digests/<date>.json` |

All mutating actions require same-origin `POST /api/scripts`. Only one instance of a given script ID can run at a time (`409` if already running). Output streams via `GET /api/scripts/stream/<runId>`; history persists under `~/.local/state/devhub/runs.jsonl`.

## Git Hooks

DevHub can install a pre-push hook that runs verification before pushing.

The hook (`.githooks/pre-push`) runs `scripts/scan-leaks.sh` then `npm run verify` (lint, typecheck, tests, production build with `DEVHUB_SKIP_NEXT_TYPECHECK=true`). It is wired during `dashboard/scripts/postinstall.ts` and `scripts/install.sh`.

When the active shell's Node does not match `.nvmrc`, the hook sources `nvm.sh` and runs `nvm use` before verify — so pushes from IDEs or GUI clients do not false-fail under a system Node. Install the pinned version (`nvm install` from repo root) if you see a warning about a Node mismatch.

Emergency bypass — use sparingly, then run `npm run verify` locally before merging:

```bash
DEVHUB_SKIP_VERIFY=1 git push
```

See [Environment Variables](environment-variables.md#development-and-ci).
