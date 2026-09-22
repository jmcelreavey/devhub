<!-- ai-dotfiles:identity:start -->
Cursor: L0 is always-on via `~/.cursor/rules/devhub-persona-identity.mdc`. Cloud: read `persona/identity.txt` before the first substantial reply.
<!-- ai-dotfiles:identity:end -->

<!-- ai-dotfiles:shared-persona:start -->
Cursor: L1 is always-on via `~/.cursor/rules/devhub-persona-shared.mdc`. Cloud: read `persona/shared-persona.md` before the first substantial reply.
<!-- ai-dotfiles:shared-persona:end -->

## Cursor Cloud specific instructions

### Persona (Cloud)

This file does **not** inline L0/L1 — Cursor already has them via `~/.cursor/rules/devhub-persona-*.mdc`. If those rules are missing from the system prompt, read `persona/identity.txt` then `persona/shared-persona.md` before the first substantial reply. Paths are repo-root `persona/` only — never `notes/persona/`.

### Repo nature — personal mirror, NOT the public template

- This checkout is the **private mirror**. It holds **everything**: your personal data — notes, diagrams, daily tasks, checklist collections, `persona/identity.txt` — committed alongside the code. This is where day-to-day work lives, and committing personal data here is expected.
- The separate **public / template core** repo is the code-only one: generic, reusable features. It ships personal-data paths empty (`.gitkeep`/`EXAMPLE`), and personal data must **not** be pushed there. See `CONTRIBUTING.md` → "Personal-data boundary" for the exact path list.
- Running the app locally writes personal data into tracked paths (e.g. creating a task writes `tasks/YYYY-MM-DD.json`) — that's fine to commit here. The only place to keep personal data out is when **back-porting a generic feature to the public template**.

### Services

| Service | Command | Port | Notes |
|---------|---------|------|-------|
| Next.js Dashboard | `npm run dev` (repo root) | 1337 default | File-based storage, no DB. **On this machine 1337 is almost always packaged DevHub.app (`next start`), not webpack — do not use it to test checkout changes.** |
| OpenChamber | Lazy on `/chamber` tab | 1336 | Optional companion; requires `openchamber` binary |
| OpenCode | Lazy on `/opencode` tab | ephemeral | Optional companion; never pin 1338 |

### Running the app

- `npm run dev` from the repo root starts the dashboard (and attempts companions). The `predev` health check auto-creates `dashboard/.env.local` if missing.
- Core env vars (`NOTES_DIR`, `REPO_ROOT`, `PORT`) are auto-configured by `postinstall`.
- Optional integrations (Google Calendar, Jira, Datadog) are configured via the `/setup` page; they are not required for the app to function.
- Optional **notes in-editor AI** uses `AI_API_KEY` (any OpenAI-compatible provider; `AI_BASE_URL`/`AI_MODEL` default to z.ai) in `dashboard/.env.local` (see `dashboard/.env.example`); not configured via `/setup`.
- OpenChamber and OpenCode start when you open those tabs. Missing binaries just hide the tab — the dashboard still works.

### Lint / Typecheck / Test

All from the repo root:
- `npm run lint` — ESLint
- `npm run typecheck` — TypeScript (`tsc --noEmit`)
- `npm run test` — Vitest (dashboard unit tests; ~3.7k, about 15 s)
- `npm run verify` — runs lint, typecheck, tests, and production build sequentially

### UI / UX Review

- For any UI change, be critical of the experience as well as correctness: check visual hierarchy, spacing, copy, empty/loading/error states, affordances, and awkward user flows.
- Use screenshots or recordings to review the rendered result, and call out visible UX issues even when the feature technically works.

### Loading & motion vocabulary

- **Shimmer for content arriving, spin only for an action the user just triggered.** Data panels and route loads use skeletons (`SkeletonRows`, `PageSkeleton` via `loading.tsx`) shaped like the content they become; `animate-spin` is reserved for refresh/submit buttons the user clicked.
- Motion is information — healthy systems hold still. 150–350ms, easing `cubic-bezier(.22,1,.36,1)`, transform/opacity only, no infinite loops on healthy state. Respect `prefers-reduced-motion` and the `body[data-motion="off"]` kill-switch (⌘P → "Toggle animations"). See `docs/contributing/motion.md`.

### Plugin Architecture — CRITICAL FOR EDITING

DevHub uses a **tier-2 plugin system**. Private modules (BI ops, CAPI scripts, etc.) live in **separate plugin repos**, not in this repo. On `npm run dev`, the `predev` → `sync_plugins` step **materializes** plugin files into the core dashboard tree via `fs.cpSync`.

**This means:**
- Files like `dashboard/lib/bi-ops.ts`, `dashboard/components/CapiScriptsCard.tsx`, `dashboard/app/api/bi/**` are **copies** — they get overwritten on every server restart.
- **Always edit the plugin source**, never the materialized copy. The materializer will silently destroy your changes.
- Plugin registry: `~/.config/devhub/plugins.json` — lists plugin name + path.
- Plugin `devhub-bi` source: `~/Developer/devhub-bi/dashboard/` — edit files there.
- New files that don't exist in the plugin should be created in the plugin repo, not in core.
- Core-owned files (git-tracked in this repo) are safe — the materializer refuses to clobber them.
- After editing plugin source, restart the dev server (or the materializer will re-copy on next `predev`).

**Quick check:** Before editing any `dashboard/` file, run `git ls-files -- <path>`. If it returns empty, the file is plugin-owned — edit the plugin repo instead.

### Gotchas

- **Dashboard hanging or a page never loading?** One blocked subprocess blocks
  every route, so "the app is dead" and "one git call is stuck" look identical.
  Call `status_exec` (or `GET /api/status/exec`) first — it names the command.
  Full ladder: the `devhub-debug-hang` skill.
- **Writing dashboard UI?** Read `docs/reference/ui-vocabulary.md` first — the
  components, CSS primitives and hooks that already exist. Cheaper than
  rediscovering them, and stops a second near-identical warning style existing.
- **Running an external command?** Use `execExternal` (`lib/exec-external.ts`),
  never `execFile`/`spawn` directly. It enforces a timeout; the default is to
  hang forever.
- **Safe-Chain is required** for `npm install` (dashboard `preinstall` and `scripts/install.sh`). Install globally: `npm install -g @aikidosec/safe-chain@1.1.10`, run `safe-chain setup`, restart the terminal. See README.md.
- **Cloud VMs without sudo:** install Safe-Chain to a user prefix and put it on `PATH` before `npm install`: `npm install -g @aikidosec/safe-chain@1.1.10 --prefix "$HOME/.npm-global"` then `export PATH="$HOME/.npm-global/bin:$PATH"`. The VM update script does this automatically.
- **Tasks vs notes paths:** daily tasks live under repo-root `tasks/YYYY-MM-DD.json` (not under `notes/`). Notes vault files are under `notes/`.
- The `postinstall` script patches OpenChamber's HTML for theming. If `node_modules` is deleted, re-run `npm install --prefix ./dashboard` to restore these.
- The 1Password CLI integration (`op`) is optional and logs warnings if absent — not a real error.
- Git hooks are in `.githooks/` (configured via `core.hooksPath`); `pre-push` runs `npm run verify`.
- **`npm run dev` uses webpack**, not Turbopack — required so `../shared/` vault imports resolve without widening Turbopack's project root (which watches the whole repo and can exhaust RAM).
- **Cold start:** first request after `npm run dev` can take ~30s while webpack compiles; subsequent navigations are fast. Peer startup may also pull/update OpenChamber on first run.
- **Port 1337 is production.** Packaged DevHub.app holds it (`cwd` under `/Applications/DevHub.app/Contents/Resources/server`). Checkout edits are invisible there — no webpack HMR. Verify UI on a free-port `npm run dev` (see `devhub-dashboard-verify`). Do not kill 1337 unless asked; that is the daily driver.
