<!-- ai-dotfiles:identity:start -->
Cursor: L0 is always-on via `~/.cursor/rules/devhub-persona-identity.mdc`. Cloud: read `persona/identity.txt` before the first substantial reply.
<!-- ai-dotfiles:identity:end -->

<!-- ai-dotfiles:shared-persona:start -->
Cursor: L1 is always-on via `~/.cursor/rules/devhub-persona-shared.mdc`. Cloud: read `persona/shared-persona.md` before the first substantial reply.
<!-- ai-dotfiles:shared-persona:end -->

## Cursor Cloud specific instructions

### Persona (Cloud)

This file does **not** inline L0/L1 — Cursor already has them via `~/.cursor/rules/devhub-persona-*.mdc`. If those rules are missing from the system prompt, read `persona/identity.txt` then `persona/shared-persona.md` before the first substantial reply. Paths are repo-root `persona/` only — never `notes/persona/`.

### Public core and private mirrors

- The **public core** ships generic code and empty personal-data paths (`.gitkeep`/`EXAMPLE`). Never publish notes, tasks, identity, voice samples or local credentials there. See `CONTRIBUTING.md` → "Personal-data boundary" for the exact path list.
- A **private mirror** keeps personal data alongside the code. Committing that data to the private remote is expected. Check the remotes before choosing where to publish.
- Running the app writes local data (e.g. `tasks/YYYY-MM-DD.json`). Keep it in your private mirror and move generic changes as content patches when the histories differ.

### Services

| Service | Command | Port | Notes |
|---------|---------|------|-------|
| Next.js Dashboard | `npm run dev` (repo root) | 1337 default | File-based storage, no DB. **If packaged DevHub.app holds 1337 (`next start`), checkout changes won't appear there. Use a free port and `DEVHUB_DIST_DIR` to test them.** |
| Agents (Paseo) | Separate launchd/systemd user daemon (`npm run agents:install`) | 6767 | Backs `/agents`; managed separately, with setup/restart controls in Agents → Connection |
| Terminal peer | Started by `npm run dev` | 1339 | Docked PTY; localhost only |

### Running the app

- `npm run dev` from the repo root starts the dashboard (and attempts companions). The `predev` health check auto-creates `dashboard/.env.local` if missing.
- Core env vars (`NOTES_DIR`, `REPO_ROOT`, `PORT`) are auto-configured by `postinstall`.
- Optional integrations (Google Calendar, Jira, Datadog) are configured via the `/setup` page; they are not required for the app to function.
- Optional **notes in-editor AI** uses `AI_API_KEY` (any OpenAI-compatible provider; `AI_BASE_URL`/`AI_MODEL` default to z.ai) in `dashboard/.env.local` (see `dashboard/.env.example`); not configured via `/setup`.
- `/chamber` and `/opencode` redirect to `/agents`. Without Paseo, Agents shows a connection error and the rest of the dashboard still works. OpenCode is only lazy-started (ephemeral port) for session recap.

### Lint / Typecheck / Test

All from the repo root:
- `npm run lint` — ESLint
- `npm run typecheck` — TypeScript (`tsc --noEmit`)
- `npm run test` — Vitest (dashboard unit tests)
- `npm run verify` — checks MCP types, runs dashboard lint/typecheck/tests in parallel, then checks vendored skills and builds

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
- Core-owned tracked files are protected unless the plugin manifest explicitly lists a tracked overlay. Check those overlays too; their materialised copies must not be edited.
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
  never `execFile`/`spawn` directly. It enforces a timeout; raw subprocess calls can
  otherwise hang indefinitely.
- **Safe-Chain is required** by `scripts/install.sh` and plugins that declare it. The dashboard preinstall checks plugin requirements; a core-only `npm install` doesn't require it. Install globally: `npm install -g @aikidosec/safe-chain@1.1.10`, run `safe-chain setup`, restart the terminal. See README.md.
- **Cloud VMs without sudo:** install Safe-Chain to a user prefix and put it on `PATH` before `npm install`: `npm install -g @aikidosec/safe-chain@1.1.10 --prefix "$HOME/.npm-global"` then `export PATH="$HOME/.npm-global/bin:$PATH"`. The VM update script does this automatically.
- **Tasks vs notes paths:** daily tasks live under repo-root `tasks/YYYY-MM-DD.json` (not under `notes/`). Notes vault files are under `notes/`.
- The 1Password CLI integration (`op`) is optional and logs warnings if absent — not a real error.
- Git hooks are in `.githooks/` (configured via `core.hooksPath`); `pre-push` runs `npm run verify`.
- **`npm run dev` uses webpack**, not Turbopack — required so `../shared/` vault imports resolve without widening Turbopack's project root (which watches the whole repo and can exhaust RAM).
- **Cold start:** first request after `npm run dev` can take ~30s while webpack compiles; subsequent navigations are fast.
- **Protect the packaged app's port.** When DevHub.app holds 1337 (`cwd` under `/Applications/DevHub.app/Contents/Resources/server`), checkout edits are invisible there. Verify UI on a free port with `DEVHUB_DIST_DIR` set (see `devhub-dashboard-verify`). Do not stop the packaged app unless asked.
