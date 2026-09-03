# Terminal dock

Every open gets its own tab. There is no reuse, and nothing waits on another session.

- Do not reintroduce tab reuse. "Is this tab free?" has no reliable answer — a shell at a prompt, a quiet long-running server and a wedged process are indistinguishable from here — and guessing wrong meant a command that silently never ran. A spare tab is the cheaper failure.
- `addTab` always creates. It takes no reuse hints; if you find yourself adding one, you are rebuilding the thing that was deleted.
- A second dev server on a taken port is fine. It fails loudly, in a tab the user can see.
- Give each repo a distinct `label` so the dock stays readable once tabs accumulate.
- Busy state is for display only — the tab spinner and `terminal_list`. Nothing routes, queues, or blocks on it.
- Propose → confirm → inject stays. It is the gate on agents writing to a shell, not a reuse mechanism: destructive commands force the modal, everything else gets a chip.
- Regression coverage: `dashboard/lib/terminal-features.test.ts`.
