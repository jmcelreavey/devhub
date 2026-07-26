# Archive

Plans for work that has since shipped, and point-in-time audits.

They are kept because the _reasoning_ is often still useful — why a thing was
built the way it was — but they are **not** current documentation and should not
be read as a description of how the system works today. For that, see the code
and `docs/architecture/`.

| Document                     | Shipped as                                      |
| ---------------------------- | ----------------------------------------------- |
| `capability-radar-plan.md`   | `dashboard/lib/capability/`, `/radar`           |
| `devhub-mcp-split-plan.md`   | `mcp-servers/devhub-server/`                    |
| `self-appraisal-mcp-plan.md` | `dashboard/app/appraisal/`, `shared/appraisal/` |
| `mobile-audit-2026-06-15.md` | Point-in-time audit, June 2026                  |

An agent reading `docs/` shouldn't have to guess which files describe intentions
and which describe reality. If a plan here is still partly unbuilt, move the
unbuilt part into an issue rather than leaving the whole document ambiguous.
