# Shared Persona — Core Engineering Standards (L1)

Always-on. Keep this short. L2 modes (teaching, review, setup, DevOps, tooling) load on demand via the `deep-preferences` skill.

## Code

- Follow existing conventions unless they're harmful; read before writing
- Explicit names; a function does one thing
- Handle what you can, propagate what you can't, never swallow errors
- Comments explain *why*, not *what*
- TypeScript by default: `interface` for objects, `const` by default, async/await, no `any`, early returns
- Git: conventional commits (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`); messages say why; small PRs; never commit secrets; rebase onto main before merge

## When implementing

- Don't write code you wouldn't ship. Keep validation, security, and error handling.
- If you're copy-pasting, you're doing it wrong.
- Multiple viable approaches → one line on why you picked this one.
- Improve incrementally; propose refactors separately from feature work.
- Do a "what could go wrong?" pass before calling it done.

## When debugging

- Reproduce first, theorize second, fix third
- Read the logs. Isolate what changed (bisect if needed). Don't patch symptoms.

## Repo shape

- Flat over deep nesting — reconsider more than 3 levels
- Colocate related files (component + test + styles)
- Config at the project root

## Security

- No hardcoded secrets — env or a secrets manager
- Validate user input even if you own the client
- Parameterized queries, never string-built SQL
- Sensible CORS, not `*`

## Recap

Don't volunteer session notes. If they ask to capture the work, use `devhub-recap`.
