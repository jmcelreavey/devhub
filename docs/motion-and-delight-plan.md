# Motion, Loaders & Delight — Improvement Plan

Date: 2026-06-10. Follow-up to `docs/codebase-review-2026-06-09.md` and the UX Explorations handoff. Focus: transitions, loading states, and tasteful fun.

**Ground rules (carried from the design handoff):** motion is information — healthy systems hold still. 150–350ms, one easing curve (`cubic-bezier(.22,1,.36,1)`), transform/opacity only, no infinite loops on healthy state, everything behind `prefers-reduced-motion` + the `data-motion="off"` kill-switch. And the design's own words: **no confetti.**

## What exists today (inventory)

Already good: skeleton shimmer, `hub-enter` page rise, Today grid stagger, check-pulse, count tick-ups, briefing shimmer→settle, urgency-gated pulses (Join <10min, firing alerts), `NavProgress` top bar, sidebar width transition, toast slide-in, seasonal brand marks + theme presets (a fun foundation already in place).

Gaps: 22 files hand-roll `animate-spin` spinners; zero `loading.tsx` route skeletons (first visit to a page = blank main area until client JS fetches); no page-to-page transition (content pops); collapse/expand of Today cards snaps instantly; `EmptyState` is plain text; Work/Section tabs swap with no transition; the palette appears with no entrance; task completion has no row-exit (done items teleport into the Done section).

## Phase 1 — Loaders (consistency first, ~1 day)

1. **Route-level skeletons.** Add `loading.tsx` to the heavy routes (`/work`, `/prs`, `/tickets`, `/status`, `/repos`, `/skills`, `/calendar`) rendering 3–4 `SkeletonRows` inside the standard page chrome. Cheap (one ~10-line file each) and kills the blank-page flash — the single biggest perceived-speed win available.
2. **One loading vocabulary.** Rule: *shimmer for content arriving, spin only for an action the user just triggered* (refresh buttons keep `animate-spin`; data panels never spin). Sweep the 22 `animate-spin` call sites — most panel-level ones should become skeletons. Add the rule to AGENTS.md so new code follows it.
3. **Skeletons match the content's shape.** `SkeletonRows` gets optional `avatar`/`badge` variants so PR lists, ticket cards, and calendar rows shimmer in their real silhouette instead of generic bars (the settle feels seamless when the shapes line up).
4. **Button busy states.** A tiny `useBusy` helper + `.btn[data-busy]` style (label dims, inline 3-dot pulse) replaces ad-hoc `disabled` flips on async buttons (Standup, Context pack, sync actions).

## Phase 2 — Transitions (~1–2 days)

5. **Page-to-page view transitions.** Next 16 supports the View Transitions API (`experimental.viewTransition`). Default crossfade (~180ms) between routes + `view-transition-name` on the sidebar/topbar so chrome holds still while content swaps. Falls back to nothing in unsupported browsers — pure progressive enhancement. This is the highest-impact "app feels finished" change.
6. **Tab crossfades.** Work tabs (`/work`) and the main Today card tabs swap content instantly; wrap panels in a keyed 150ms fade-rise (the `briefing-settle` class already does exactly this — reuse it).
7. **Collapse/expand glide.** Today cards snap on collapse. Animate via CSS grid trick (`grid-template-rows: 0fr→1fr`, 200ms) on the card body — no JS height measurement needed.
8. **Sidebar active pill slide.** The active nav background jumps between items; animate a shared pill (transform between item positions, 200ms). Small `NavLink` change, big perceived polish.
9. **Palette entrance.** ⌘K overlay: backdrop fade (120ms) + panel scale `0.98→1` rise (180ms), exit reversed. Results list gets a 20ms-stagger on first open only.
10. **Done-row exit.** Completing a task: row holds 300ms (let the check-draw land), then height-collapses out (200ms) as the Done count ticks up — completion reads as *departure*, not teleport.

## Phase 3 — Micro-interactions (~1 day)

11. **Check draw-in.** Replace the scale-pop with the design's SVG stroke draw (`stroke-dashoffset`, 180ms) in `TaskList` + the Focus view's THEN list — the single most-repeated act of the day should be the best-feeling one.
12. **Press feedback.** Global `.btn:active { transform: scale(.97) }` (80ms) — buttons currently only brightness-shift.
13. **Card hover lift.** Today/Focus cards get the design's hover treatment: accent-tinted border + soft shadow lift (already in the prototype CSS, 150ms).
14. **Focus timer ring.** The top-bar timer is text-only; add a 16px conic-gradient progress ring around the icon so a glance shows session progress. On completion: one gentle accent pulse (not looping) + the existing chime.
15. **NOW card handoff.** When the NOW item changes (review merged, task done), settle the new content in with `briefing-settle` instead of an instant swap.

## Phase 4 — Sparkles & fun (~1 day, the restraint phase)

16. **Queue-cleared moment.** When the last open task completes, the Focus view's THEN section settles into a one-time "Done for today." state — check sweep + a rotating line ("Inbox zero. Touch grass.", "Nothing owed. Go build something."). One pass, never loops, gone tomorrow.
17. **Greeting personality.** `greetingForHour` learns a few variants ("Morning." / "Early start." before 7am / "Late one." after 22pm) — date-seeded so it doesn't change on re-render.
18. **Empty states with a voice.** `EmptyState` gets an optional one-liner pool in the same dry tone ("No PRs waiting. Suspiciously quiet."). Keep icons, add personality copy only.
19. **Streak whisper.** The Focus whisper line adds e.g. "3rd day clearing the queue" computed from `tasks/*.json` history — quiet positive reinforcement, text only.
20. **Seasonal ambience.** The seasonal brand-mark system already exists; extend it with a subtle accent tint per season (one CSS var) so the app drifts with the calendar without a redesign.

## Explicitly not doing

Confetti, particle effects, looping ambient animation on healthy state, sound beyond the existing focus chime, mascots. The product's charm is calm competence — the fun lives in copy, timing, and tiny rewards, not spectacle.

## Order & verification

Ship phases as separate commits (1 → 2 → 3 → 4); each phase ends with `npm run verify` plus a manual reduced-motion + `data-motion="off"` sweep. Phase 5 (later): revisit the design's "The Wire" (direction C) as a Work tab once the motion language is fully landed.

## Status (2026-06-10) — all four phases landed

- **Phase 1** (commit `b656549`): route `loading.tsx` skeletons everywhere, `SkeletonRows` list variant, `.btn[aria-busy]` busy states, vocabulary rule in AGENTS.md. Most of the 22 spinner sites turned out to be legitimate action feedback — left alone.
- **Phase 2**: route entrance via `app/template.tsx` (replaces the per-`.hub` animation; no experimental flags needed), tab crossfades (`.fade-rise`) on Work + Today tabs, Done-section glide (grid-rows 0fr→1fr), sidebar active-item slide-in (one pass, CSS-only), ⌘K palette entrance, done-row exit (row holds 440ms while the check lands, then collapses out).
- **Phase 3**: check stroke draw-in (`check-draw` on the lucide paths), `.btn:active` press scale, card hover lift (hover devices only). Focus-timer ring skipped — the running pill already shows progress as a horizontal fill; a ring would duplicate the same information.
- **Phase 4**: queue-cleared line in TaskList (date-seeded, one pass), greeting variants (Early start / Late one), `EmptyState` quips (PR reviews + tickets), n-day completion streak in the Focus whisper (from `/api/tasks/history`, shown from 2 days). Seasonal accent tint skipped — it would fight the user-owned AccentPicker.

Everything is `prefers-reduced-motion`-gated and killed by `body[data-motion="off"]`. Remaining future idea: "The Wire" triage queue as a Work tab.
