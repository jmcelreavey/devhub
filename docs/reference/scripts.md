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

| Command | Purpose |
| ------- | ------- |
| `bash scripts/devhub-update.sh [--since <ref>] [--dry-run] [--no-sync] [--mark-synced]` | Pull core updates from `upstream` by porting hunks (`git apply --3way`, since public history is unrelated), then validate + sync. Tracks the last pull in `refs/devhub/upstream-sync`; first run needs `--since`. `--mark-synced` records sync without applying (use after a backport). Guards: on main/master, upstream remote present, and no *non-personal* uncommitted changes (live-dirty `notes/`/`tasks/`/`collections/` are ignored). |
| `bash scripts/devhub-backport.sh <source-ref> [--base <ref>] [--execute] [--title "…"]` | Build a clean PR branch off `upstream` and port the feature's hunks onto it (`git apply --3way`, preserving public-side templatisation), personal data excluded, leak-scanned. `--base` defaults to `<source-ref>^`. Previews by default; `--execute` pushes the branch to `upstream` and opens the PR. |

These call the CLI action runner, which is also usable directly:

```bash
cd dashboard
npx tsx scripts/run-action.ts validate                 # repo integrity checks
npx tsx scripts/run-action.ts sync                     # skills + agents + MCP + persona → tools
npx tsx scripts/run-action.ts update_and_sync --push   # full origin update + sync
```

## Dashboard Lifecycle Scripts

The dashboard owns most operational scripts. They handle tasks such as:

- Health checks before startup.
- Full diagnostics.
- Post-install setup.
- Action runner execution.
- Chained OpenChamber and OpenCode startup (`start-peer-services.ts`; standalone `start-chamber.ts`, `start-opencode.ts`).
- 1Password secret fallback (`op-secrets.ts`) before services bind ports.
- Standup diagnostics.
- PWA icon generation.

Prefer root commands or dashboard UI actions unless you are debugging a specific script.

## Git Hooks

DevHub can install a pre-push hook that runs verification before pushing.

If you must bypass it in an emergency, use the documented environment override, then run verification as soon as practical.
