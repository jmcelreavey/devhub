# GLOSSARY.md format

One context, the usual case: a single `GLOSSARY.md` at the repo root.

```md
# {Context name}

{One or two sentences: what this context is.}

## Language

**Order**:
{What it is. One or two sentences. Not what the code does with it.}
_Avoid_: Purchase, transaction

**Customer**:
A person or organisation that places orders.
_Avoid_: Client, buyer, account
```

Rules:

- Be opinionated. When several words mean the same thing, pick one and list the others under `_Avoid_`.
- Define what it is, not what it does. One or two sentences.
- Only terms specific to this context. General programming words (timeout, error, repository) stay out.
- Group under subheadings when clusters appear. A flat list is fine when they don't.

Several contexts: a root `GLOSSARY-MAP.md` points at each `GLOSSARY.md` and says how the contexts relate. If the map exists, read it and pick the context. If it is unclear which context, ask. If neither file exists, create a root `GLOSSARY.md` when the first term is resolved.

System-wide decisions still go in `docs/adr/`. Context-specific decisions go in that context's `docs/adr/` when the map says the context has its own.
