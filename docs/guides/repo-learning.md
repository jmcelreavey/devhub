# Repo Learning

Repo Learning helps you get oriented in a local checkout from the **Repos** page. It combines deterministic repo facts with optional z.ai-generated learning artifacts.

Use it when you want a quick architecture brief, a handoff prompt for OpenCode, a NotebookLM source pack, or a tutor that quizzes you through a codebase.

## Prerequisites

| Requirement | Why it matters |
| ----------- | -------------- |
| The repo is a direct child of the repos scan directory | DevHub only resolves repo names under the directory returned by `REPO_ROOT`'s parent. |
| The repo has a `.git` directory | Non-git folders are not listed or resolved for learning. |
| `AI_API_KEY` is set in `dashboard/.env.local` | Generated briefs, NotebookLM packs, and the tutor use your configured OpenAI-compatible provider (z.ai by default). |

The scan directory is the parent of the DevHub checkout. For example, if DevHub lives at `~/Developer/devhub`, Repo Learning can use sibling clones like `~/Developer/my-service`.

Without `AI_API_KEY`, the panel still shows deterministic detected facts. AI-generated artifacts are disabled and the API reports `not_configured`.

## Typical Use

1. Open **Repos**.
2. Find a local repo card.
3. Click **Learn**.
4. Review **Detected facts** for stack, package manager, important directories, docs, manifests, and run/test commands.
5. Use one of the AI-assisted actions when z.ai is configured:
   - **Copy brief** for a concise onboarding summary.
   - **OpenCode handoff** to copy the handoff prompt and open an OpenCode terminal in that repo.
   - **Quiz me** to start the tutor.
   - **Download ZIP** to export a NotebookLM source pack.

## How It Works

```text
Repos page
  -> GET /api/repos/:name/learn
  -> resolve sibling git repo by name
  -> scan deterministic repo context
  -> read HEAD-keyed cache, or generate z.ai artifacts
  -> return facts and optional artifacts to the Learn panel
```

The scan is local and best-effort. It collects:

- Primary stack signals from manifests and common config files.
- Package manager from lockfiles or `package.json`.
- Scripts, run commands, test commands, key directories, docs, manifests, language counts, and recent commits.
- Short snippets from useful text sources such as README files, `AGENTS.md`, `CLAUDE.md`, `package.json`, language manifests, and files under `docs/`.

The generated brief is instructed to use only detected facts and snippets. Unknowns should be reported as `not detected` instead of guessed.

## Scanning Constraints

Repo Learning intentionally skips paths and files that are noisy or risky:

| Skipped | Examples |
| ------- | -------- |
| VCS, dependencies, build output, coverage, vendored code | `.git`, `node_modules`, `.next`, `dist`, `build`, `coverage`, `vendor` |
| Secret-like files | `.env`, `.npmrc`, `.pypirc`, SSH keys, names containing `secret`, `token`, or `credential` |
| Oversized source snippets | Preferred files above the size limits are ignored for snippets. |

The scanner caps traversal and prompt input to keep responses fast and bounded. That means very large repos may produce a useful overview without exhaustive coverage.

## Generated Artifacts

| Artifact | Where to use it | Notes |
| -------- | --------------- | ----- |
| Generated brief | Learn panel, copied Markdown | Covers what the repo is, run/verify commands, architecture map, reading path, and gotchas. |
| OpenCode handoff | Terminal opened from DevHub | The copied prompt asks OpenCode to read first, cite files, list commands, and quiz without modifying files. |
| NotebookLM source pack | Downloaded ZIP | Contains generated Markdown sections, an import README, and curated source excerpts. |
| Tutor | Learn panel chat | Asks one question at a time, evaluates answers, escalates hints, and cites only scanned paths. |

NotebookLM does not accept ZIP files natively. Use the NotebookLM Tools extension for ZIP import, or unzip the archive and upload Markdown files manually. NotebookLM free plans may cap source count, so split or select files if needed.

## Cache Behavior

Generated artifacts are cached at:

```text
notes/.cache/repo-learn/<repo-name>.json
```

The cache is keyed by the repo's current git `HEAD`. If `HEAD` changes, DevHub regenerates artifacts on the next load. The **Refresh** button forces regeneration for the current `HEAD`.

The tutor keeps an in-memory scan cache per repo and `HEAD` for about a minute so each answer does not re-walk the tree.

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
| Brief, tutor, or ZIP are unavailable | The AI provider may be unconfigured, unreachable, or returned a generation error. Deterministic facts should still load. |
| Output looks stale | Confirm the repo `HEAD` changed, or click **Refresh** to bypass the cache. |
| NotebookLM cannot import the ZIP | NotebookLM itself does not support ZIP upload; unzip manually or use the NotebookLM Tools extension. |
| Generated content omits parts of a large repo | The scanner and prompts are intentionally capped. Add or improve README/docs files so the preferred snippets contain the important context. |

## Related Docs

- [Environment Variables](../reference/environment-variables.md) - z.ai configuration.
- [OpenCode and OpenChamber](opencode-and-chamber.md) - terminal and OpenCode service behavior.
- [Notes System](../architecture/notes-system.md) - learnings vault and notes storage.
