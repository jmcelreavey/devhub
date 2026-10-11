# Codebase design vocabulary

Design deep modules: a lot of behaviour behind a small interface, at a clean seam, tested through that interface. The aim is leverage for callers, locality for maintainers, and testability for both.

Use these terms exactly.

**Module.** Anything with an interface and an implementation. A function, a class, a package, or a slice that crosses tiers. Not: unit, component, service.

**Interface.** Everything a caller must know to use the module correctly. The types, and also the invariants, ordering, error modes, required config, and performance. Not: API, signature. Those are only the type surface.

**Implementation.** The body of the module. Distinct from an adapter. A thing can be a small adapter with a large implementation (a Postgres repo) or a large adapter with a small implementation (an in-memory fake). Say adapter when the seam is the topic.

**Depth.** How much behaviour a caller or a test can exercise per unit of interface they have to learn. Deep: a lot of behaviour behind a small interface. Shallow: the interface is nearly as complex as the implementation.

**Seam.** A place where you can alter behaviour without editing in that place. Where the interface lives. Where to put it is its own decision. Not: boundary.

**Adapter.** A concrete thing that satisfies an interface at a seam. The role, not the substance.

**Leverage.** What callers get from depth. More capability per unit of interface. One implementation pays back across many call sites and tests.

**Locality.** What maintainers get from depth. Change, bugs, knowledge, and verification sit in one place. Fix once, fixed everywhere.

## Principles

- Depth is a property of the interface, not the line count of the body. Padding the implementation is not depth. A deep module can be made of small internal parts. Those parts are not part of the interface.
- A module can have internal seams (private, used by its own tests) and one external seam at its interface. Do not expose an internal seam just because a test uses it.
- The deletion test. Delete the module in your head. If the complexity vanishes, it was a pass-through. If it reappears across the callers, it was earning its keep.
- The interface is the test surface. Callers and tests cross the same seam. A test that has to reach past the interface means the module is the wrong shape.
- One adapter means a hypothetical seam. Two adapters means a real one. Do not introduce a seam unless something actually varies across it. Production plus a test double is the usual pair.

## Testability

- Accept dependencies. Do not construct them inside the module.
- Return results. Do not hide the outcome in a side effect the test has to poke.
- A smaller surface needs fewer tests. Fewer parameters means simpler setup.

## Relationships

A module has one interface. Depth is measured against that interface. The seam is where the interface lives. An adapter sits at the seam and satisfies the interface. Depth produces leverage for callers and locality for maintainers.
