# Shared Persona — Core Engineering Standards (L1)

This file contains the engineering standards and preferences that apply across all sessions. Loaded at session start (~685 tokens).

## Code Standards

### General
- Follow existing project conventions unless they're actively harmful
- Prefer explicit over implicit — naming should make intent clear
- Functions should do one thing well; if it needs "and", consider splitting
- Error handling: handle what you can, propagate what you can't, never silently swallow
- Comments explain *why*, not *what* — the code should explain what

### TypeScript / JavaScript
- Use TypeScript by default for any new project
- Prefer `interface` over `type` for object shapes
- Use `const` by default, `let` only when reassignment is needed
- Prefer async/await over raw promises
- No `any` — use `unknown` and narrow, or define the type
- Prefer early returns over deep nesting

### Python
- Type hints on function signatures, optional on internals
- Use dataclasses or pydantic models for structured data
- Follow PEP 8, but don't be pedantic about line length if readability suffers
- Prefer pathlib over os.path
- Use f-strings, not .format() or %

### Git
- Write conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`
- Keep PRs small and focused — one concern per PR
- Don't commit secrets, ever
- Rebase feature branches onto main before merging

## Architecture Preferences

### Project Structure
- Flat structure over deep nesting — if you need more than 3 levels, reconsider
- Colocate related files (component + test + styles) in feature folders
- Keep configuration at the project root, not buried in subdirectories

### API Design
- REST for CRUD, consider GraphQL for complex data relationships
- Consistent error response format across all endpoints
- Version APIs from day one
- Document with OpenAPI/Swagger for any public-facing API

### Database
- Use migrations, never hand-write schema changes in prod
- Index for actual query patterns, not hypothetical ones
- Prefer UUIDs over auto-increment IDs for distributed systems

## Security Defaults
- Never hardcode secrets — use environment variables or a secrets manager
- Validate and sanitize all user input, even if you control the client
- Use parameterized queries, never string interpolation for SQL
- Set sensible CORS policies, not `*`

## Notes System

This repo includes a two-tier notes system for capturing and reusing knowledge:
- After significant work, capture notes using the `session-notes` skill
- Reference past learnings via the `learnings` skill
- Notes are stored in `notes/` and synced with this repo via git

For full details on the notes architecture, see `docs/TOKEN_BUDGET.md`.

## Context-specific modes (L2)

Teaching, code review, debugging, scaffolding, and other modes live under `persona/modes/`. Load them **on demand** via the **`deep-preferences`** skill — not on every session. See `persona/deep-preferences.md` for the index.
