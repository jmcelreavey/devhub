# Design it twice

Use this when the user wants alternative interfaces for a deepening candidate they already picked. The first idea is rarely the best. Words: [VOCABULARY.md](./VOCABULARY.md). Dependencies: [DEEPENING.md](./DEEPENING.md).

## 1. Frame the problem

Write a short explanation the user can read:

- Constraints any new interface has to satisfy.
- Dependencies, and which category each falls into.
- A rough sketch that makes the constraints concrete. Not a proposal.

Show it, then start the parallel designs. The user reads while those run.

## 2. Three different interfaces

Spawn at least three parallel passes. Each one gets the file paths, the coupling, the dependency category, and a different constraint:

1. Minimise the interface. One to three entry points. Maximise leverage per entry point.
2. Maximise flexibility. Many use cases, room to extend.
3. Optimise for the most common caller. The default case is trivial.

A fourth, only when the dependencies are remote or external: design the ports and adapters.

Each pass returns:

1. The interface: types, methods, params, invariants, ordering, error modes.
2. A usage example.
3. What the implementation hides behind the seam.
4. Adapters, if the dependency category needs them.
5. Where leverage is high and where it is thin.

Name domain concepts with `GLOSSARY.md` and architecture with the vocabulary file.

## 3. Compare

Put the options side by side against depth, locality, and where the seam sits. Recommend one. The user picks. Record a surprising trade-off with `grill-with-docs` (an ADR only when it earns one).
