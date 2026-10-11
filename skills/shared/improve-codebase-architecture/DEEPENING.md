# Deepening

How to deepen a cluster of shallow modules, given what they depend on. Uses the words in [VOCABULARY.md](./VOCABULARY.md).

## Dependency categories

The category decides how the deepened module is tested across its seam.

1. **In-process.** Pure computation, in-memory state, no I/O. Merge the modules and test through the new interface. No adapter.
2. **Local-substitutable.** A local stand-in exists (PGLite for Postgres, an in-memory filesystem). Test with the stand-in. The seam stays internal. No port on the external interface.
3. **Remote but owned.** Your own service across a network boundary. Define a port at the seam. The deep module owns the logic. Production gets an HTTP, gRPC, or queue adapter. Tests get an in-memory adapter.
4. **True external.** A third party you do not control (Stripe, Twilio). The module takes that dependency as an injected port. Tests pass a mock adapter.

## Seam discipline

- One adapter is a hypothetical seam. Two adapters make it real. Do not add a port for a single implementation.
- Internal seams stay inside the implementation. The external seam is the interface callers and tests share.

## Tests: replace, do not layer

- Once tests exist at the deepened interface, the old unit tests on the shallow modules are waste. Delete them.
- New tests assert observable outcomes through the interface, not internal state.
- A test that must change when the implementation changes is testing past the interface.
