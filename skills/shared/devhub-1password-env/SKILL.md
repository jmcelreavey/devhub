---
name: devhub-1password-env
description: Use when configuring DevHub or shell environment variables to load local secrets from the 1Password CLI instead of plaintext .env.local or zsh exports.
metadata:
  short-description: DevHub 1Password env secrets
---

# DevHub 1Password Env

## Overview

Use this skill to move local DevHub and shell secrets into a 1Password item and wire DevHub to fetch them safely with the `op` CLI.

DevHub's default item title is `devhub`. Field labels should match env var names exactly, such as `JIRA_API_TOKEN`, `DATADOG_API_KEY`, or `Z_AI_API_KEY`.

## When To Use

- The user wants DevHub `.env.local` secrets managed by 1Password.
- The user wants shell API keys removed from `.zshrc`, `.zprofile`, or similar startup files.
- DevHub reports unresolved `{env:VAR}` OpenCode provider credentials.
- `npm run doctor` warns that the 1Password CLI is missing, not signed in, or cannot find the `devhub` item.

## Workflow

1. Inspect the current repo support first: `dashboard/scripts/op-secrets.ts`, `dashboard/.env.example`, and `docs/reference/environment-variables.md`.
2. Check the CLI without printing secrets: `command -v op`, `op --version`, and `op whoami >/dev/null`.
3. If `op` is missing, install the official 1Password CLI and restart the shell. On macOS, prefer the 1Password docs or Homebrew cask/package already used on the machine.
4. If `op` is installed but not signed in, ask the user to run `op signin` or unlock 1Password desktop integration. Do not try to capture passwords or session tokens in chat.
5. Create or update one 1Password item titled `devhub`, optionally pinned by `DEVHUB_OP_VAULT`, with fields named exactly after env vars.
6. Keep local path/preference vars out of 1Password: `NOTES_DIR`, `DOCS_DIR`, `REPO_ROOT`, bind hosts, ports, `AWS_PROFILE`, and local repo paths.
7. For DevHub startup, let `loadEnvWithOnePasswordFallback` fetch missing managed secrets. Set `DEVHUB_OP_CACHE=0` when 1Password should stay the source of truth and secrets should not be written back to `dashboard/.env.local`.
8. For OpenCode shared provider keys, keep repo config as `{env:VAR}` placeholders; add matching fields to the `devhub` item.
9. For shell startup, prefer a guarded helper that reads fields only when `op` is installed and already signed in. Never hardcode plaintext secrets in shell files.

## Useful Commands

Check status without exposing values:

```bash
command -v op
op --version
op whoami >/dev/null
npm run doctor
```

Create the item manually in the 1Password app, or create an empty CLI item after sign-in and add secret fields through hidden prompts or the app:

```bash
op item get devhub >/dev/null 2>&1 || op item create --category=password --title devhub
```

Avoid one-line `op item edit FIELD=value` commands for real secret values when possible; command arguments can be visible to local process inspection and may end up in shell history.

Force DevHub to re-fetch after adding or rotating fields:

```bash
DEVHUB_OP_REFRESH=1 npm run dev
```

Load without caching secrets back to `.env.local`:

```bash
DEVHUB_OP_CACHE=0 npm run dev
```

## Verification

- Run `npm run doctor` and confirm the `1password` check is OK or has a clear sign-in/setup warning.
- Run `DEVHUB_OP_REFRESH=1 npm run dev` once to refresh `dashboard/.env.local` after field changes.
- For code changes, run targeted tests around `op-secrets` and `dashboard-env-local`, then broader `npm run typecheck` when practical.

## Safety Rules

- Do not print, paste, commit, or log secret values.
- Do not store 1Password session tokens in repo files.
- Do not put machine-local paths or non-portable preferences in the shared `devhub` item unless the user explicitly wants machine-specific vault data.
- If a secret was exposed in chat, shell history, or git, tell the user to rotate it before storing the replacement.
