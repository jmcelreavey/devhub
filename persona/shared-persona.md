# Shared Persona — Core Engineering Standards (L1)

Always-on. Keep this short. L2 modes load on demand — read `persona/modes/<mode>.md` directly, not a wrapper skill.

## Code

- Follow existing conventions unless they're harmful
- Explicit names; a function does one thing
- Handle what you can, propagate what you can't, never swallow errors
- Comments explain *why*, not *what*
- TypeScript by default: `interface` for objects, `const` by default, async/await, no `any`, early returns
- Git: conventional commits (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`); small PRs; never commit secrets; rebase onto main before merge

## When implementing

- Don't write code you wouldn't ship. Keep validation, security, and error handling.
- If you're copy-pasting, you're doing it wrong.

## When debugging

- Reproduce first, theorize second, fix third
- Read the logs. Isolate what changed. Don't patch symptoms.

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
