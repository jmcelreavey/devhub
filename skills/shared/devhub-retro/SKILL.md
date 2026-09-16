---
name: devhub-retro
description: Review recently finished and abandoned DevHub work and propose concrete edits to skills and rules.
metadata:
  short-description: Plan retro that improves the skills
---

# DevHub Retro

Close the loop: look at how work actually landed and propose changes to the
skills that let problems through. You **propose**; you never edit skills,
persona files or AGENTS.md yourself.

## 1. Gather

1. `tasks_retro_inputs` (default last 7 days) — finished and abandoned tasks
   with their handoffs, agent runs and PR outcomes, agent-run errors, failing
   MCP tools, and the shared skill list.
2. For the tasks that went badly (abandoned, several runs, PR needed fixes,
   failed runs), read the evidence it points at: the task note, the
   `pr-reviews/` note, `agent_output` for runs still available, and
   `mcp_history` for the failing tools.

## 2. Look for repeats, not one-offs

A finding needs **at least two occurrences**. Look for:

- The same misunderstanding of a task or a codebase.
- The same review comment or CI failure on agent PRs.
- Plans that went to an agent while still missing something (open questions
  answered mid-run, wrong repo, missing acceptance).
- Handoffs that didn't let the next run continue.
- An MCP tool that keeps failing the same way.
- Skills that never get used, or two skills doing one job.

## 3. Propose

Write one note at `retro/YYYY-MM-DD` (`notes_write`):

```markdown
# Retro YYYY-MM-DD

**Window:** <since> → <until> · <n> done · <n> abandoned · <n> agent runs

## Findings
### <short title>
- Evidence: <task/PR/run ids, 2+>
- Proposed change: `skills/shared/<skill>/SKILL.md` — <the exact text to add, change or remove>
- Why it prevents a repeat: <one line>

## Rules to add / remove
## Skills to retire
```

Rules:

- Every proposal names the file and quotes the text. "Improve the plan skill"
  is not a proposal.
- Prefer deleting or tightening an instruction over adding a new one.
- Nothing personal or company-specific goes into `skills/shared` — say when a
  change belongs in a plugin instead.
- If the window had nothing worth changing, say so in the note. That is a
  valid retro.

Finish by telling the user where the note is and the top one or two proposals.
