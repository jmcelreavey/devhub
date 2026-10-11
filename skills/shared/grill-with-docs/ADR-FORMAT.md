# ADR format

ADRs live in `docs/adr/` as `0001-slug.md`, `0002-slug.md`, and so on. Create the directory when the first ADR is needed. Scan the directory and increment the highest number.

```md
# {Short title of the decision}

{One to three sentences: the context, what we decided, and why.}
```

An ADR can be one paragraph. The point is that a decision was made, and why.

Add these only when they earn their place:

- **Status** (`proposed`, `accepted`, `deprecated`, `superseded by ADR-NNNN`) when the decision might be revisited.
- **Considered options** when a rejected alternative is worth remembering.
- **Consequences** when a downstream effect is not obvious.

Offer an ADR only when it is hard to reverse, surprising without the context, and the result of a real trade-off. Easy, obvious, or "we did the only thing" does not get one.

Worth recording when those three hold:

- Shape: monorepo, event-sourced write model, projected read model.
- How two contexts talk: domain events, not synchronous HTTP.
- A technology choice that would take a quarter to swap: database, bus, auth, deploy target. Not every library.
- Who owns a concept, and the explicit no. "Customer data lives in the Customer context. Everyone else holds an id."
- A deliberate deviation. "Manual SQL, not an ORM, because X." This stops the next person "fixing" it.
- A constraint the code does not show. Compliance, a partner latency budget.
- A rejected alternative someone will suggest again in six months.
