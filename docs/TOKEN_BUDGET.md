# Token Budget
DevHub keeps AI context useful by separating always-loaded guidance from on-demand knowledge.
## Why Token Budget Matters
AI tools have limited context. Loading too much stale or irrelevant information makes sessions slower and less focused.
DevHub uses layers so the assistant sees the right amount of context at the right time.
## Persona Layers
| Layer | Size Goal | Purpose |
| --- | --- | --- |
| L0 Identity | Very small (~200 tok) | Communication style and role |
| L1 Shared persona | Small (~685 tok) | Core engineering standards |
| L2 Deep preferences | On demand (~500 tok total) | Mode files under `persona/modes/` via `deep-preferences` skill |
## Notes Layers
| Layer | Purpose |
| --- | --- |
| Daily notes | Current working context |
| Learnings | Distilled reusable knowledge |
| Index or map | Helps decide what to load |
## Good Practices
- Keep always-loaded files short.
- Move detailed examples into on-demand docs or learnings.
- Distill repeated session notes into focused learnings.
- Archive old notes when they stop being useful.
- Avoid duplicating the same instruction in many places.
## What Not To Put In Persona
- Long project documentation.
- Temporary task context.
- Secrets.
- Facts that change often.
Use docs and notes for those instead.
