# Capability Radar — implementation plan

> Status: Phases 0–4 + lab-experience enhancements BUILT & VERIFIED · a few stretch items remain
> Author: John (with Claude)
> Scope: DevHub dashboard (`dashboard/`)

---

## ⏱ Resumable progress (keep this current — survives a corrupt session)

**Last verified:** 2026-07-01 · `tsc` clean (dashboard + MCP server) · **43** capability unit tests green · lint clean · **browser-verified** (Chrome): enhanced lab panel renders with clickable evidence, Regenerate + Mark done, a **stale banner**, the **guardrail** flagging a hallucinated path, the **hands-on workspace** callout, and a **live Socratic session** streaming a repo-grounded question. Live checks: lab generation scaffolds `~/Developer/kitchen-sink/<repo>__<signal>/` (README, STEPS, docker-compose for Mongo, .env.example); lab tasks link to the doc; MCP `capability_*` tools compile.

**How to re-verify (mac tools, port 1337):**
```bash
cd dashboard
npx tsc --noEmit                       # typecheck
npx vitest run lib/capability          # unit tests (43)
npm run dev                            # dev server binds :1337
curl -s http://localhost:1337/api/capability/radar          # latest snapshot+diff
curl -s -X POST http://localhost:1337/api/capability/scan \
     -H 'Content-Type: application/json' -d '{"includeGithub":true,"githubFilter":"businessinsider"}'  # scan incl. un-cloned org repos
curl -s -X POST http://localhost:1337/api/capability/journey \
     -H 'Content-Type: application/json' -d '{"signalId":"flux"}'  # AI lab → Learnings + workspace (kitchen-sink/) + task
curl -s -X POST http://localhost:1337/api/capability/journey/complete -d '{"category":"labs/eks-config/flux"}'  # mark done + tick task
curl -s -X POST http://localhost:1337/api/capability/digest \
     -H 'Content-Type: application/json' -d '{"includeGithub":true,"githubFilter":"businessinsider"}'  # weekly digest (honors GitHub toggle)
open http://localhost:1337/radar
```

### DONE ✅
- **Detection engine** — `lib/capability/detectors.ts` (+ `detectors.test.ts`, 11 tests). Filename + content rules: Terraform, Helm, Kustomize, Docker, Flux/Argo (GitOps), Crossplane, K8s, OpenTelemetry, Datadog, Atlas/Kafka/Postgres, plus concept signals: workload identity/IRSA, external secrets, event-driven, feature flags. Pure/testable.
- **Types** — `lib/capability/types.ts` (DetectedSignal, RepoScan, CapabilitySnapshot, CapabilityDiff).
- **Local scan + aggregate** — `lib/capability/local-scan.ts`, `aggregate.ts`, `scan.ts`.
- **Snapshot store** — `lib/capability/snapshots.ts`. Dated snapshots under `notes/.cache/capability/snapshots/<id>.json` + `latest` pointer (gitignored — confirmed not tracked).
- **Diff engine + drift** — `lib/capability/diff.ts` (+ `diff.test.ts`, 7 tests). added / spread / removed + knowledge-drift from real git-author history (e.g. MongoDB Atlas 141d, Docker 134d, Flux 133d). Second scan correctly reports zero changes.
- **Personal exposure** — `lib/capability/exposure.ts` (last-touched-by-me / commit share).
- **Adaptive GitHub prober** — `lib/capability/github-probe.ts`. Deep probe on first sight, mid on branch-SHA move, cached-skip when unchanged. Filename rules run free off the git tree; only concept detection spends API budget.
- **AI explainer** — `lib/capability/explain.ts`. Gathers introducing-commit evidence and explains *why* a tech appeared; falls back to evidence-only when `AI_API_KEY` is unset.
- **API routes** — `app/api/capability/scan/route.ts`, `radar/route.ts`, `explain/route.ts`, `journey/route.ts`.
- **/radar page** — `app/radar/page.tsx` + `client.tsx`; wired into Library nav (`lib/nav.ts`, `components/NavLink.tsx` — `radar` icon = lucide `Radar`).
- **Phase 3 — Journeys / labs (AI).** `lib/capability/journey.ts` (+ `journey.test.ts`, 8 tests). Turns a signal into a repo-grounded lab (orient → read the real change → sandbox → Socratic checkpoint → explain-back → debug mission), grounded in the local clone with the most evidence + its introducing commit. Saves as editor blocks to `notes/learnings/labs/<repo>/<signal>.json` (surfaces on `/learnings`), adds a follow-up Task on first creation, idempotent on repeat, AI-off fallback scaffold. Route `app/api/capability/journey/route.ts`. Surfaced via **"Build lab"** buttons on `/radar` (delta cards + drift rows) and a repo-level **Capability radar** section inside `LearnPanel` (`app/repos/RepoRadarSection.tsx`).
- **Phase 4 — Continuous.** `lib/capability/digest.ts` (+ `digest.test.ts`, 7 tests). Runs a scan, diffs vs previous, builds a one-line headline + full markdown digest ("New / Spreading / Retired / Knowledge drift"), deterministic with an optional AI narrative paragraph. Persists a structured digest to `notes/.cache/capability/digests/` (for the UI) and a browsable note to `notes/learnings/digests/<date>.json`. Route `app/api/capability/digest/route.ts` (GET latest+list, POST generate). Registered as the schedulable **`capability_digest`** action in `lib/scripts-runner.ts` so the in-app cron scheduler runs it weekly (a `Weekly Capability Digest` job at Mon 08:00 is created). Surfaced as the **"This week"** section on `/radar`.
- **Evolution strip on `/repos`** — `app/repos/EvolutionStrip.tsx`, wired into `app/repos/client.tsx`. Compact "This week: +X · +Y — N arch shifts" banner linking to `/radar`; renders nothing on a steady week (no noise).

### DONE ✅ — Lab-experience enhancements (round 2)
- **Grounding guardrail + freshness** — `verifyCitedPaths`/`extractCitedPaths` in `journey.ts` flag cited file paths that don't exist in the repo (appended as a ⚠ note in the lab). Each lab stores its `groundedSha`; the UI shows a **stale** banner + **Regenerate** when the repo HEAD has moved. (`journey.test.ts` covers these.)
- **Clickable evidence** — labs render the introducing commit + evidence files as links to the repo's GitHub blob/commit (from the normalized remote + grounded SHA). `normalizeGitRemote`/`buildEvidenceLinks`.
- **Completion tracking** — every lab persists a `LabRecord` (gitignored, `notes/.cache/capability/labs/`). **Mark done** ticks the linked follow-up task (`markLabComplete` + `/api/capability/journey/complete`); done state shown on drift rows + in the panel.
- **Hands-on training workspace ("kitchen sink")** — `lib/capability/lab-workspace.ts` scaffolds `~/Developer/kitchen-sink/<repo>__<signal>/` per lab: README (the training path), STEPS checklist, `.gitignore`, and a deterministic `docker-compose.yml` + `.env.example` for signals that need a service (Mongo/Postgres/Redis/Kafka). Path + `docker compose up -d` hint surfaced in the lab panel. (`lab-workspace.test.ts`, 3 tests.)
- **Repo-specific starter source (AI)** — `lib/capability/lab-starter.ts` asks the model for a minimal runnable starter grounded in the repo's real excerpts, wired to the workspace's compose services, with TODOs for the learner. Written under `starter/` next to a `GENERATED.md` disclaimer. Hardened: `sanitizeStarterFiles` blocks absolute/traversal paths and secret/key files, caps count (8) and size (8 KB), dedupes; `extractJsonObject` robustly parses fenced/pross-wrapped model output; `scaffoldLabWorkspace` re-validates every write stays under `starter/`. Best-effort — falls back to the deterministic scaffold when AI is off/unavailable. (`lab-starter.test.ts`, 9 tests incl. path-safety.)
- **Live resumable Socratic session** — `components/LabTutor.tsx` + `/api/capability/journey/tutor` + `/api/capability/journey/session`. One combined surface: notes as reference + a live tutor that holds your hand, gives tasks in the workspace, and **checks your work** (asks you to paste output). Transcript persists per lab (`notes/.cache/capability/sessions/`) so you can **come and go**; Reset clears it.
- **Shared lab UI** — extracted to `components/LabInline.tsx` (`useLab`, `LabButton`, `LabPanel`) so `/radar` and `LearnPanel` share one implementation.
- **Task links** — follow-up tasks now use a markdown link to the note (`Lab: [<label>](/notes/learnings/<category>)`); existing tasks migrated.
- **GitHub toggle fix** — the "This week" **Generate** now honors the *Also scan un-cloned GitHub repos* checkbox + org filter (e.g. `businessinsider`); previously it ignored them and returned instantly (local-only).
- **MCP coverage** — `mcp-servers/devhub-server/src/tools/capability.ts` exposes `capability_radar`, `capability_scan`, `capability_digest`, `capability_build_lab`, `capability_complete_lab` (registered in `mcp.ts`). Everything the /radar UI does is now doable via the MCP.
- **Mobile** — `/radar` no longer `desktopOnly` in `lib/nav.ts` (reachable on phones); lab panels/evidence/tutor use responsive wrapping + truncation; coverage labels shrink on narrow screens.
- **UX polish** — reduced-motion-safe micro-interactions in `globals.css` (`.lab-panel-enter`, `.lab-msg-enter`, `.lab-evidence-link` hover, `.lab-done-pop`) + a spinner on the Build-lab button while generating.

### Browser UX pass (2026-07-01)
Tested the full lab flow live in Chrome. Confirmed: panel **entrance animation**, the hands-on **workspace callout** (folder icon, `kitchen-sink` path, services, starter-file list), **Mark done → Done** (accent + check-pop + toast), Regenerate, and clickable evidence — all on-brand.
Found & fixed one real issue: `SimpleMarkdown` renders line-by-line and can't do fenced code blocks, so the command-heavy labs showed raw ``` fences. Added **`components/LabMarkdown.tsx`** — renders fenced code as styled, **copyable** blocks (language label + Copy button), plus ordered lists and `---` rules — and used it for the lab body and tutor messages. Commands now read as proper code blocks. Motion is reduced-motion-safe (`globals.css` `.lab-*` classes). A short screen recording (`capability-radar-lab-ux.gif`) was captured to review the feel.

### Lab pedagogy — reviewed & tuned (2026-07-01)
Read real generated output and improved the prompts so labs actually teach, not just describe:
- **Lab prompt** (`buildLabPrompt`) is now workspace-aware: it knows the exact generated starter files + compose services, adds an **Objective** and **Takeaway**, teaches the transferable concept (not just this repo's code), and makes the Sandbox + Debug mission **hands-on** (start services, run/extend the *existing* starter, connect to localhost, exact commands). Debug mission teaches a real diagnostic method (reproduce → isolate app-vs-infra → fix → map back to the repo).
- **Ordering**: the starter is generated *before* the lab so the lab references the real files and extends them (coherent workspace) instead of rewriting them.
- **Starter prompt** now requires it to run end-to-end out of the box, print observable output, and include a PASS/FAIL self-check the tutor can verify against.
- **Token budget**: gpt-5.5 is a reasoning model (spends hidden tokens), and content-heavy labs are long — raised lab budget to 9000 / starter to 8000 and told the model to budget length so every section (through Takeaway) is complete. Fixed truncation observed on Flux.
- **Guardrail** refined to ignore URLs/git remotes (was a false positive) while still catching genuinely non-existent file paths.
- Verified on two very different signals: **MongoDB Atlas** (service-backed, runnable Python smoke test tied to the repo's `connection_url`) and **Flux/GitOps** (no service; a local script that parses the repo's real Flux YAML) — both complete, grounded, and hands-on.

### AI provider — now OpenAI (gpt-5.5), verified live
Swapped from the expired GLM plan to **OpenAI** (`AI_BASE_URL=https://api.openai.com/v1`, `AI_MODEL=gpt-5.5`). `lib/ai-provider.ts` now branches: OpenAI proper uses the official **`@ai-sdk/openai`** provider (it emits `max_completion_tokens` for the gpt-5 family; the generic `openai-compatible` provider sends `max_tokens`, which gpt-5.5 rejects) — every other endpoint (GLM/z.ai, OpenRouter, Together, local Ollama/LM Studio) still uses `openai-compatible`. Verified live: AI labs, **AI starter files** (`starter/main.py` grounded in the repo's real cluster name + Mongo version, wired to the compose Mongo), and the digest narrative all return `source: ai`.

### NOT DONE ⬜ (stretch / open questions)
- **Drift-based proactive nudges:** surface stale-signal reminders on `/today` or as auto-created tasks. Not built.
- **Mobile:** verified via responsive classes + nav fix; not yet confirmed on a real device/true-narrow viewport (the resize-based sim here stayed desktop-width).
- **Concept-detector tuning / remote-only depth / exposure identity** — as before.

_Note: labs and digests land in `notes/learnings/` (git-tracked). Records, sessions, snapshots, and digest caches under `notes/.cache/capability/` stay gitignored. The `kitchen-sink/` training repo lives at the repos root — version it yourself if you want to keep it._

### NOTE — is the session actually corrupt?
The chat transcript for the "Capability Radar feature plan" session didn't reload, but **all of its output is on disk and works**. Nothing was lost. If the session corrupts again, this section + the code under `lib/capability/` is the source of truth — re-run the verify block above.

---

## One-line

DevHub continuously builds a model of how your engineering environment is
_evolving_ — which technologies, patterns and concepts your repos depend on,
what changed since you last looked and **why** — then turns each change into a
repo-specific, hands-on learning journey.

The differentiator is not "AI explains code" (Copilot, Sourcegraph do that). It
is the **scan → snapshot → diff → explain → lab** loop: the second run compares
against the last, surfaces what's new across your org, explains the reason from
commit/PR evidence, and generates a lab grounded in your real code.

## What already exists (build on this, don't rebuild)

Verified against the current codebase:

| Primitive | Where | Reuse for |
| --- | --- | --- |
| `scanRepoContext()` → `primaryStack`, `manifests`, `recentCommits`, `languageBreakdown`, key dirs | `lib/repo-context.ts` | Base repo scan. **Extend** detection (infra/GitOps/concepts). |
| Local sibling-repo + GitHub repo enumeration | `lib/repos.ts` (`REPO_ROOT`, `gh` CLI) | Breadth: which repos to scan. |
| AI generation via `generateText` + `getNotesAiModel` / `getNotesAiCallOptions`, gated by `isNotesAiConfigured()` (`AI_API_KEY`) | `lib/repo-learn-ai.ts`, `lib/notes-ai/config.ts`, `lib/ai-provider.ts` | "Why did this appear" explainer + journey generation. |
| Cache pattern keyed by `gitHead`, atomic writes under `notes/.cache/…` | `lib/repo-learn-cache.ts`, `lib/atomic-write.ts` | Snapshot store. |
| Learn flow: `LearnPanel` slide-out → `/api/repos/<name>/learn` → brief + `RepoLearnTutor` (Socratic) + NotebookLM pack | `app/repos/LearnPanel.tsx`, `components/RepoLearnTutor.tsx` | Host for the **repo-level** radar tab + labs. |
| Learnings archive: `/learnings` page + `/api/learnings` + `notes/learnings/` | `app/learnings/`, `lib/learnings-index.ts` | Archive of generated labs / completed journeys. |
| Notes + Tasks APIs | `/api/notes`, `/api/tasks` | Persist human-readable journey output + follow-up tasks. |
| Scheduled tasks (Cowork) | scheduled-tasks MCP | Weekly auto-scan → "Monday evolution" digest. |

## What's genuinely new

1. **Deep detector** — beyond web/JS. Infra + GitOps + concept signals with evidence.
2. **Snapshot store** — persist each aggregate scan, dated, so runs are comparable.
3. **Diff engine** — added/removed tech & patterns, per-repo, plus personal drift.
4. **Evolution explainer (AI)** — for each delta, gather evidence and explain *why*.
5. **Journey generator (AI)** — turn a delta into a repo-grounded lab.

Everything else is glue + UI.

---

## UX

Two altitudes, both anchored on the repos screen (which already owns "learn").

### Repo-level (inside `LearnPanel`)
Add a **Radar / Evolution** tab alongside the existing brief/tutor/pack:
- Detected stack for _this_ repo, grouped by area (runtime, infra, deploy, data,
  observability) with evidence file paths and a confidence signal.
- "What changed here since last scan" (this repo's slice of the diff).
- Repo-specific labs (reuse `RepoLearnTutor` for the Socratic/debug mission).

This is the natural home: the panel already does per-repo AI learning.

### Global (aggregate)
The cross-repo picture deserves more room than a card. Recommendation:
- A compact **Evolution strip** pinned at the top of `/repos`:
  `This week: +Crossplane · +Karpenter · +External Secrets — 2 arch shifts` →
  clicks through to…
- A dedicated **`/radar`** route: the Capability Radar (tech coverage + drift
  bars), the Engineering-Evolution feed (diff + AI "why"), and active labs.
- `/learnings` stays the archive of generated/completed journeys.

Rationale for a separate `/radar` rather than cramming it onto `/repos`: the
aggregate view is a _time series_ (snapshots, drift, weekly digest), not a
per-repo action, and it will grow. Keep the repos page action-oriented; give the
evolving-org narrative its own screen. Open to folding the strip differently if
you'd rather keep everything on one screen.

---

## Data model

### Detection output (per repo)
```ts
interface DetectedSignal {
  id: string;            // "flux", "terraform", "crossplane", "workload-identity"
  kind: "technology" | "pattern" | "concept";
  area: "runtime" | "infra" | "deploy" | "data" | "observability" | "ci" | "arch";
  evidence: string[];    // file paths / matched globs, e.g. ["apps/*/HelmRelease.yaml"]
  confidence: number;    // 0..1 from signal strength / count
  count: number;         // occurrences
}

interface RepoScan {
  repoName: string;
  repoPath: string;      // local clone path, or "github:owner/repo" when remote-only
  gitHead: string | null;
  scannedAt: string;
  signals: DetectedSignal[];
  // personal exposure
  lastTouchedByMe: string | null;   // git log --author=<me> most recent on signal files
  myCommitShare: number;            // rough authored-vs-total on relevant paths
}
```

### Aggregate snapshot (org-wide, dated)
```ts
interface CapabilitySnapshot {
  id: string;            // ISO timestamp
  createdAt: string;
  repoCount: number;
  source: { local: number; github: number };
  technologies: Record<string, { repos: string[]; count: number }>;
  patterns: Record<string, { repos: string[]; count: number }>;
  concepts: Record<string, { repos: string[]; count: number }>;
  repos: RepoScan[];     // trimmed
}
```
Stored at `notes/.cache/capability/snapshots/<id>.json`, with
`notes/.cache/capability/latest.json` as the baseline pointer.

### Diff
```ts
interface CapabilityDiff {
  from: string | null; to: string;   // snapshot ids
  added:   DiffEntry[];              // new tech/pattern/concept
  removed: DiffEntry[];
  spread:  DiffEntry[];              // existing, now in more repos
  drift:   DriftEntry[];            // you haven't touched X in N days while it grew
}
interface DiffEntry { id: string; kind: string; area: string; repos: string[]; evidence: string[]; }
interface DriftEntry { id: string; daysSinceMine: number; repoDelta: number; }
```

### Evolution (diff + AI)
Each `added`/`spread` entry gets an AI explanation grounded in evidence
(introducing commit(s), PR title/body, README/ADR changes), cached so we only
pay the model once per delta.

---

## Detector design

Extend, don't replace, `repo-context.ts`. Add `lib/capability/detectors.ts`
that runs over the already-collected file list plus a few cheap content probes.

Signal families (initial set, tuned to your stack):
- **Infra / IaC**: `*.tf`, `*.tfvars`, `.terraform.lock.hcl` → Terraform;
  `Chart.yaml`, `values*.yaml` → Helm; `kustomization.yaml` → Kustomize;
  Crossplane `Composition`/`CompositeResourceDefinition`/`apiVersion:*crossplane.io`.
- **GitOps / K8s**: Flux CRDs by `kind:` — `HelmRelease`, `Kustomization`,
  `GitRepository`, `OCIRepository`; Argo `Application`.
- **CI**: `.github/workflows/*.yml`, `.gitlab-ci.yml`, `Jenkinsfile`.
- **Data**: MongoDB / Atlas (`mongodb+srv`, `atlas` in tf), Postgres, Redis, Kafka.
- **Observability**: OpenTelemetry (`otel`, `opentelemetry`), Datadog, Prometheus.
- **Concepts** (higher-value, pattern-level): workload identity / IRSA
  (`serviceaccount` + `role-arn` annotations, OIDC), External Secrets
  (`ExternalSecret`, `SecretStore`), feature flags, event-driven (domain events
  vs sync calls), monorepo, hexagonal.

Each detector returns `DetectedSignal` with the matched paths as evidence.
Guardrails already present in `repo-context.ts` (secret-file regex, ignore dirs,
`MAX_FILES_SCANNED`) are reused — do not read secret files.

**Concept detection** is where this beats framework-version diffing: "your org
started adopting workload identity" is more useful than "external-secrets bumped
to v0.11". Start with a small, high-signal concept set and grow it.

### Personal exposure
Per signal, run `git log --author=<me> --since=<window> -- <evidence paths>` to
get `lastTouchedByMe`; compare authored vs total commits on those paths for a
rough `myCommitShare`. Drives the drift bars ("Terraform ▓▓ down — 84 days since
you touched it; Crossplane now in 7 repos").

---

## API surface

- `POST /api/capability/scan` — enumerate repos (local + `gh` org), run detectors,
  write a new snapshot, compute diff vs `latest`, return `{ snapshot, diff }`.
  Long-running → run through the existing jobs mechanism (`/api/jobs`) with
  streaming progress, like scripts do.
- `GET  /api/capability/radar` — latest snapshot + latest diff + cached evolution.
- `POST /api/capability/explain` — (idempotent) generate/return AI "why" for a delta id.
- `POST /api/capability/journey` — generate a lab for a delta or a repo signal;
  writes a note under `notes/learnings/labs/<repo>/…` and optionally a task.
- Repo-level radar reuses `/api/repos/<name>/learn` shape; add a `radar` block to
  its payload (or a sibling `/api/repos/<name>/radar`).

## GitHub org scan (v1 includes this)

- Use `gh` (already wired in `lib/repos.ts`) to list org + personal repos.
- Don't full-clone. Two-tier:
  1. Repos already cloned locally under `REPO_ROOT` → full detector (best signal).
  2. Remote-only → shallow signal via GitHub API/`gh`: file-tree + targeted
     content probes (Contents API on candidate paths), no working tree.
- Cache aggressively (repo tree keyed by default-branch SHA). Respect rate limits;
  degrade to "local-only" cleanly if unauthenticated.

---

## Phases

**Phase 0 — Detector + one-shot radar (no diff, no AI). ✅ DONE**
`lib/capability/detectors.ts`, aggregate scan across `REPO_ROOT` + org, `/radar`
showing detected stack and coverage. Ships value immediately; pure/testable.

**Phase 1 — Snapshot + diff (the differentiator). ✅ DONE (Evolution strip on `/repos` still TODO)**
Snapshot store, `latest` pointer, diff engine, exposure/drift. Second run shows
"what changed". Evolution strip on `/repos`. No AI yet — diff alone is useful.

**Phase 2 — Evolution explainer (AI). ✅ DONE**
Gather evidence per delta (introducing commits/PRs, README/ADR changes), AI
"why", cached per delta. Feeds the Engineering-Evolution feed.

**Phase 3 — Journeys / labs (AI), wired into existing learn surfaces. ✅ DONE**
Generate repo-grounded labs (overview → PR to inspect → sandbox → Socratic →
explain-back → debug mission). Save to `notes/learnings`, add follow-up Task,
reuse `RepoLearnTutor`. Add the Radar tab to `LearnPanel`.

**Phase 4 — Continuous. ✅ DONE (drift-based nudges remain as a stretch)**
Weekly scheduled scan → "Your engineering ecosystem changed this week" digest
(3 new tech, 2 arch shifts, 1 recommended path). Drift-based proactive nudges.

## Testing

- Detectors: fixture repos (tiny dirs with Flux/TF/Crossplane/OTel files) →
  assert exact signals + evidence. Mirrors existing `*.test.ts` in `lib/`.
- Diff engine: two synthetic snapshots → assert added/removed/spread/drift.
- AI layers: mock the provider (as `repo-learn-ai.test.ts` does); assert prompt
  shape and evidence-grounding, not model output.
- Guardrail test: secret files never read; ignore dirs honored.

## Open questions

- Concept-detection breadth for v1 — which 5–8 concepts matter most to your day-to-day?
- Remote-only depth — how much GitHub API budget to spend on repos you haven't cloned.
- "You" identity for exposure — git author email(s) to attribute commits to.
- Global surface — dedicated `/radar` vs everything folded onto `/repos` (leaning `/radar`).
