# Repo Learning

Repo Learning helps you get oriented in a local checkout from the **Repos** page. It combines deterministic repo facts with optional AI-generated learning artifacts from any OpenAI-compatible provider.

Use it when you want a quick architecture brief, a handoff prompt for OpenCode, a NotebookLM source pack, or a tutor that quizzes you through a codebase.

## Prerequisites

| Requirement | Why it matters |
| ----------- | -------------- |
| The repo is a direct child of the repos scan directory | DevHub only resolves repo names under the directory returned by `REPO_ROOT`'s parent. |
| The repo has a `.git` directory | Non-git folders are not listed or resolved for learning. |
| `AI_API_KEY` is set in `dashboard/.env.local` | Generated briefs, NotebookLM packs, and the tutor use your configured OpenAI-compatible provider. |

The scan directory is the parent of the DevHub checkout. For example, if DevHub lives at `~/Developer/devhub`, Repo Learning can use sibling clones like `~/Developer/my-service`.

Without `AI_API_KEY`, the panel still shows deterministic detected facts. AI-generated artifacts are disabled and the API reports `not_configured`.

## AI Provider Setup

Repo Learning shares the same provider configuration as Notes AI and daily briefing enrichment:

| Variable | Default | Notes |
| -------- | ------- | ----- |
| `AI_API_KEY` | - | Required for generated briefs, NotebookLM packs, and tutor chat. |
| `AI_BASE_URL` | `https://api.z.ai/api/coding/paas/v4` | OpenAI-compatible chat-completions base URL, with no trailing slash. |
| `AI_MODEL` | `glm-5-turbo` | Model id passed to the provider. |

Examples:

```bash
# OpenAI
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4o-mini

# Default z.ai Coding Plan
AI_BASE_URL=https://api.z.ai/api/coding/paas/v4
AI_MODEL=glm-5-turbo
```

Set `AI_API_KEY` in `dashboard/.env.local` or a matching 1Password `devhub` item. Set `AI_BASE_URL` and `AI_MODEL` in `dashboard/.env.local` when you want something other than the z.ai defaults; non-secret URLs/model names are not pulled from 1Password by default.

## Typical Use

1. Open **Repos**.
2. Find a local repo card.
3. Click **Learn**.
4. Review **Detected facts** for stack, package manager, important directories, docs, manifests, and run/test commands.
5. Use one of the AI-assisted actions when an AI provider is configured:
   - **Copy brief** for a concise onboarding summary.
   - **OpenCode handoff** to copy the handoff prompt and open an OpenCode terminal in that repo.
   - **Quiz me** to start the tutor.
   - **Download ZIP** to export a NotebookLM source pack.

## DX Audit (same page)

**DX Audit** on a repo card launches the `dx-audit` skill through the configured agent CLI
(OpenCode or Cursor — see [Agent CLI selection](opencode-and-chamber.md#agent-cli-selection)).
The agent inspects the checkout (dev loop, CI, dependencies, release path), optionally
researches current ecosystem guidance, and writes a prioritised report to DevHub notes:

```text
notes/reviews/dx-audit-<repo-name>-<YYYY-MM-DD>.json
```

Reports are BlockNote JSON like other notes. Read them in the notes tree, or via MCP
`dx_audit_list` / `dx_audit_read` without the dashboard running. Re-run audits over time
to diff against prior reports — the skill reads the latest note for the repo when present.

Requires the agent CLI handoff env vars (`DEVHUB_AGENT_*`) and a synced `dx-audit` skill.
No separate API route — the Repos button opens a terminal session with the skill prompt.

## How It Works

```text
Repos page
  -> GET /api/repos/:name/learn
  -> resolve sibling git repo by name
  -> scan deterministic repo context
  -> read HEAD-keyed cache, or generate AI artifacts
  -> return facts and optional artifacts to the Learn panel
```

The scan is local and best-effort. It collects:

- Primary stack signals from manifests and common config files.
- Package manager from lockfiles or `package.json`.
- Scripts, run commands, test commands, key directories, docs, manifests, language counts, and recent commits.
- Short snippets from useful text sources such as README files, `AGENTS.md`, `CLAUDE.md`, `package.json`, language manifests, and files under `docs/`.

The generated brief is instructed to use only detected facts and snippets. Unknowns should be reported as `not detected` instead of guessed.

### API Surface

| Route | Purpose | Failure behavior |
| ----- | ------- | ---------------- |
| `GET /api/repos/:name/learn` | Returns deterministic context plus cached or newly generated artifacts. Add `?refresh=1` to bypass the cache for the current `HEAD`. | `404` when the repo name is invalid or not a sibling git checkout; `ok: false` only for generation errors. |
| `GET /api/repos/:name/learn/status` | Lightweight readiness check for the current `HEAD` cache. | `404` when the repo cannot be resolved. |
| `GET /api/repos/:name/learn/pack.zip` | Downloads the NotebookLM pack, generating it first if no cache exists. | `503` when `AI_API_KEY` is missing; `404` when generation produced no pack. |
| `POST /api/repos/:name/learn/tutor` | Streams Socratic tutor responses with Vercel AI SDK UI messages. | `503` when AI is unconfigured; `404` when the repo cannot be resolved. |

All repo names are constrained to letters, numbers, `_`, `.`, and `-`, and must resolve to a direct child of the scan directory with a `.git` directory.

## Scanning Constraints

Repo Learning intentionally skips paths and files that are noisy or risky:

| Skipped | Examples |
| ------- | -------- |
| VCS, dependencies, build output, coverage, vendored code | `.git`, `node_modules`, `.next`, `dist`, `build`, `coverage`, `vendor` |
| Secret-like files | `.env`, `.npmrc`, `.pypirc`, SSH keys, names containing `secret`, `token`, or `credential` |
| Oversized source snippets | Preferred files above the size limits are ignored for snippets. |

The scanner caps traversal and prompt input to keep responses fast and bounded. That means very large repos may produce a useful overview without exhaustive coverage.

Current caps:

- Up to 2,000 files are scanned.
- Up to 120,000 characters of preferred text snippets are collected.
- Individual preferred snippet files larger than 80 KB are skipped.
- Model prompts use the first few snippets, capped again before generation.

## Generated Artifacts

| Artifact | Where to use it | Notes |
| -------- | --------------- | ----- |
| Generated brief | Learn panel, copied Markdown | Covers what the repo is, run/verify commands, architecture map, reading path, and gotchas. |
| OpenCode handoff | Terminal opened from DevHub | The copied prompt asks OpenCode to read first, cite files, list commands, and quiz without modifying files. |
| NotebookLM source pack | Downloaded ZIP | Contains `README-import.md`, generated Markdown sections, and curated source excerpts under `05-source-excerpts/`. |
| Tutor | Learn panel chat | Asks one question at a time, evaluates answers, escalates hints, and cites only scanned paths. |

NotebookLM does not accept ZIP files natively. Use the NotebookLM Tools extension for ZIP import, or unzip the archive and upload Markdown files manually. NotebookLM free plans may cap source count, so split or select files if needed.

## Cache Behavior

Generated artifacts are cached at:

```text
notes/.cache/repo-learn/<repo-name>.json
```

The cache is keyed by the repo's current git `HEAD`. If `HEAD` changes, DevHub regenerates artifacts on the next load. The **Refresh** button forces regeneration for the current `HEAD`.

The tutor keeps an in-memory scan cache per repo and `HEAD` for about a minute so each answer does not re-walk the tree.

Concurrent generation for the same repo and `HEAD` is de-duplicated in-process, so multiple panel loads share the same pending provider call instead of stampeding the API.

## Saving Learning Gaps

The tutor marks a response after it explains a knowledge gap. When that happens, the UI shows **Save to learnings**.

Saving writes a note under:

```text
learnings/inbox/<repo-name>-<slug>
```

The saved note contains the tutor explanation, with the internal marker stripped.

## Troubleshooting

| Symptom | Check |
| ------- | ----- |
| Repo is missing from the Repos page | The clone must be a direct child of the repos scan directory and contain `.git`. |
| Learn panel says AI is not configured | Set `AI_API_KEY` in `dashboard/.env.local` and restart DevHub. |
| Brief, tutor, or ZIP are unavailable | The AI provider may be unconfigured, unreachable, using the wrong base URL/model, or returning a generation error. Deterministic facts should still load. |
| Output looks stale | Confirm the repo `HEAD` changed, or click **Refresh** to bypass the cache. |
| NotebookLM cannot import the ZIP | NotebookLM itself does not support ZIP upload; unzip manually or use the NotebookLM Tools extension. |
| Generated content omits parts of a large repo | The scanner and prompts are intentionally capped. Add or improve README/docs files so the preferred snippets contain the important context. |

## Related Docs

- [Environment Variables](../reference/environment-variables.md) - AI provider configuration.
- [OpenCode and OpenChamber](opencode-and-chamber.md) - terminal and OpenCode service behavior.
- [Notes System](../architecture/notes-system.md) - learnings vault and notes storage.
