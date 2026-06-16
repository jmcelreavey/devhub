# Jumpbox Integration — Ops UI + CAPI Script Runner

## Overview

Integrate jumpbox capabilities into the DevHub ops page with two features:

1. **Jumpbox Card** — interactive jumpbox access (connect, sync repos)
2. **CAPI Script Runner — Jumpbox Target** — run CAPI scripts on a jumpbox instead of locally

## Jumpbox Card

### UI Layout

```
┌─ Jumpbox ──────────────────────────────────────────────┐
│ Environment: [dev] [sbx] [prd]                         │
│                                                         │
│ Instance: i-0b4a1f195d40c63d8  Status: running         │
│                                                         │
│ ┌─ Sync Repo to Jumpbox ───────────────────────────┐   │
│ │ Repo:      [dropdown: repos from ~/Developer/]   │   │
│ │ Branch:    [dropdown: branches for selected repo] │   │
│ │ Custom install: [npm install]  (editable)         │   │
│ │ [Sync to Jumpbox]                                 │   │
│ └───────────────────────────────────────────────────┘   │
│                                                         │
│ [Connect in Terminal]  [Open in Warp]                   │
│                                                         │
│ ─── CLI Equivalents ───                                 │
│ bike connect jumpbox --profile prd                      │
│ aws ssm start-session --target <id> ...                │
└─────────────────────────────────────────────────────────┘
```

### Features

- **Environment selector** — dev/sbx/prd, auto-discovers jumpbox instance
- **Repo sync workflow**:
  1. Pick repo from `~/Developer/` folder
  2. Pick branch
  3. Creates a git worktree (temp branch) in `/tmp/`
  4. Runs optional custom install command (default: `npm install`)
  5. Tars the worktree (excluding `node_modules` if install happens on jumpbox, or including if private packages)
  6. Uploads tarball to `s3://{env}-jumpbox-scripts/{repo-name}/repo.tar.gz`
  7. Cleans up worktree
- **Connect buttons**:
  - "Connect in Terminal" — opens Terminal.app with the SSM command
  - "Open in Warp" — opens Warp terminal with the SSM command
- **CLI equivalents** panel showing raw shell commands

### Connect Flow

The connect buttons run an AppleScript/osascript command to open a new terminal window with the SSM session:

```bash
osascript -e 'tell application "Terminal" to do script "AWS_PROFILE=prd-dad+ AWS_DEFAULT_REGION=us-east-1 aws ssm start-session --target i-0b4a1f195d40c63d8 --document-name prd-default-document"'
```

For Warp:
```bash
open -a Warp -- args the same command
```

### Sync Flow (backend)

```
POST /api/bi/jumpbox/sync
{
  "env": "prd",
  "repoPath": "/Users/jmcelreavey/Developer/capi",
  "branch": "pr-478",
  "installCommand": "npm install",
  "includeNodeModules": true
}
```

Steps:
1. Create git worktree: `git worktree add -b temp-jumpbox-sync /tmp/{repo}-jumpbox {branch}`
2. If `installCommand`: run it in the worktree
3. Tar: `tar czf /tmp/{repo}-jumpbox.tar.gz -C /tmp/{repo}-jumpbox .`
4. Upload: `aws s3 cp /tmp/{repo}-jumpbox.tar.gz s3://{env}-jumpbox-scripts/{repo}/repo.tar.gz`
5. Clean up: `git worktree remove /tmp/{repo}-jumpbox --force`, delete temp branch

## CAPI Script Runner — Jumpbox Target

### UI Changes

Add execution target toggle to `CapiScriptsCard`:

```
Execution Target: [Local] [Jumpbox]

When Jumpbox selected:
  ┌─ Jumpbox Config ──────────────────────────────────┐
  │ Environment: prd                                   │
  │ Repo synced: ✓ capi @ pr-478 (just now)           │
  │                                                     │
  │ Environment Variables:                              │
  │ MONGO_ATLAS_URI     [auto-filled from bimongo]     │
  │ AI_CONTENT_SUMMARY_OPENAI_API_KEY  [___________]   │
  │ AI_CONTENT_SUMMARY_MODEL           [gpt-5-mini]    │
  │ AI_CONTENT_SUMMARY_EMBEDDING_MODEL [text-embed..]  │
  │ ... (show all required env vars from script.module) │
  │                                                     │
  │ [Save vars to profile]                              │
  └─────────────────────────────────────────────────────┘
```

### Execution Flow

When "Jumpbox" target selected + "Run" clicked:

1. **Prep locally**:
   - Ensure repo is synced (or auto-sync)
   - Build the full command with env vars

2. **Generate a run script**:
   - Write a shell script to S3 that sets env vars, pulls the repo, and runs the command
   - Upload to `s3://{env}-jumpbox-scripts/{repo}/run-{timestamp}.sh`

3. **User connects to jumpbox** (or we open terminal):
   - On jumpbox: `aws s3 cp s3://.../run-{ts}.sh /tmp/run.sh && bash /tmp/run.sh`
   - Output is streamed/logged to a file on the jumpbox
   - JSONL output file can be pulled back via S3

### Env Var Management

- Script modules that use `requireEnv()` are parsed to extract required env var names
- Common vars like `MONGO_ATLAS_URI` are auto-filled based on environment
- Sensitive vars (API keys) are stored encrypted in the browser's localStorage
- Saved profiles per repo/env combination

### Why Not SendCommand?

`ssm:SendCommand` is in the IAM policy but blocked on document resource permissions. Interactive sessions only. The workflow therefore:
1. Generates a run script + uploads to S3
2. Opens a terminal for the user
3. User pastes a one-liner to execute the script
4. Output stays on jumpbox, can be pulled back via S3

Future: if CloudEng adds `SendCommand` on `AWS-RunShellScript`, we can switch to non-interactive execution with output streaming through SSE.

## Implementation Plan

### Files to create/modify

1. **`dashboard/components/JumpboxCard.tsx`** — new component
2. **`dashboard/app/api/bi/jumpbox/route.ts`** — update POST to support `repoPath`, add worktree+tar flow
3. **`dashboard/app/api/bi/jumpbox/sync/route.ts`** — new route for repo sync
4. **`dashboard/app/api/bi/jumpbox/connect/route.ts`** — new route for terminal launch
5. **`dashboard/app/ops/client.tsx`** — add JumpboxCard to ops page
6. **`dashboard/components/CapiScriptsCard.tsx`** — add jumpbox execution target
7. **`dashboard/app/api/bi/capi/run/route.ts`** — add jumpbox execution mode
8. **`dashboard/lib/bi-ops.ts`** — add `syncRepoToJumpbox()` with worktree support

### Existing code to reuse

- `discoverJumpbox()` — already in `bi-ops.ts`
- `syncToJumpbox()` — already in `bi-ops.ts` (needs refactoring for worktree approach)
- `CapiScriptsCard` — already scans scripts, handles dry-run/apply modes
- `CliEquivalents` — pattern for showing shell commands
- `bimongo` connection string logic — for auto-filling MONGO_ATLAS_URI

### Terminal Launch

Use `osascript` for Terminal.app and `open -a Warp` for Warp. Both are macOS-specific. The connect command is:

```bash
AWS_PROFILE={profile} AWS_DEFAULT_REGION=us-east-1 aws ssm start-session --target {instanceId} --document-name {env}-default-document
```

## Gotchas Discovered During Phase 0

1. **`AWS_PROFILE` env var override** — global `AWS_PROFILE=prd-subscriptions+` was overriding everything. Must use explicit `AWS_PROFILE=prd-dad+` for jumpbox access.
2. **Region must be `us-east-1`** — `.aws/config` defaults to `eu-west-1` but jumpbox is in `us-east-1`.
3. **`prd-dad-basic-okta` can't SSM** — only `prd-dad-data-writer-okta` has `ssm:StartSession`.
4. **No `SendCommand`** — policy has it on instances but not on SSM documents. Interactive only.
5. **No git on jumpbox** — must tar and upload.
6. **Private npm packages** — `npm install` fails on jumpbox (no GitHub token). Must bundle `node_modules` from local.
7. **Jumpbox has Node 16** — via nvm, must `source /etc/profile.d/nvm.sh` first.
8. **S3 bucket already grants access** — `prd-dad-data-writer-okta` is in `script_bucket_access_roles` for prd. Upload works with correct `AWS_PROFILE`.
9. **Secrets Manager denied** — resource-based policy on `prd-capi-external-secrets` blocks our role.
10. **MongoDB URI** — `mongodb+srv://www-pl-1.cwbkm.mongodb.net/insider?authMechanism=MONGODB-AWS&authSource=%24external` for prd. Uses AWS IAM auth.
11. **`git clean -dfx` is dangerous** — never run on the main working tree. Always use a git worktree.
