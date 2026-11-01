import { z } from "zod";
import { defineAction } from "./define.ts";

interface DesktopContext<Input> { execute: (input: Input) => unknown }

// The first-run body remains with its existing dashboard validator.

export const desktopBootstrapInput = z.object({ token: z.string().nullable(), next: z.string().nullable() });
export const desktopBootstrap = defineAction<typeof desktopBootstrapInput, DesktopContext<z.output<typeof desktopBootstrapInput>>, unknown>({
  input: desktopBootstrapInput,
  http: { method: "GET", path: "/api/desktop/bootstrap" },
  mcp: { reason: "The desktop shell bootstraps its authenticated browser session through this token exchange." },
  handler: (input, context) => context.execute(input),
});

export const desktopFirstRunReadInput = z.object({});
export const desktopFirstRunRead = defineAction<typeof desktopFirstRunReadInput, DesktopContext<z.output<typeof desktopFirstRunReadInput>>, unknown>({
  input: desktopFirstRunReadInput,
  http: { method: "GET", path: "/api/desktop/first-run" },
  mcp: { reason: "The setup wizard reads local first-run and migration progress." },
  handler: (input, context) => context.execute(input),
});

export const desktopFirstRunSaveInput = z.object({ body: z.unknown() });
export const desktopFirstRunSave = defineAction<typeof desktopFirstRunSaveInput, DesktopContext<z.output<typeof desktopFirstRunSaveInput>>, unknown>({
  input: desktopFirstRunSaveInput,
  http: { method: "POST", path: "/api/desktop/first-run" },
  mcp: { reason: "The setup wizard saves its local progress through its existing validator." },
  handler: (input, context) => context.execute(input),
});

export const desktopHealthInput = z.object({});
export const desktopHealth = defineAction<typeof desktopHealthInput, DesktopContext<z.output<typeof desktopHealthInput>>, unknown>({
  input: desktopHealthInput,
  http: { method: "GET", path: "/api/desktop/health" },
  mcp: { reason: "The desktop shell authenticates this health handshake before adopting the backend." },
  handler: (input, context) => context.execute(input),
});

export const desktopLocationInput = z.object({});
export const desktopLocation = defineAction<typeof desktopLocationInput, DesktopContext<z.output<typeof desktopLocationInput>>, unknown>({
  input: desktopLocationInput,
  http: { method: "GET", path: "/api/desktop/location" },
  mcp: { reason: "The desktop UI checks whether the running app is translocated." },
  handler: (input, context) => context.execute(input),
});

export const desktopMigrationReadInput = z.object({});
export const desktopMigrationRead = defineAction<typeof desktopMigrationReadInput, DesktopContext<z.output<typeof desktopMigrationReadInput>>, unknown>({
  input: desktopMigrationReadInput,
  http: { method: "GET", path: "/api/desktop/migration" },
  mcp: { reason: "The authenticated desktop migration wizard previews local paths and migration choices." },
  handler: (input, context) => context.execute(input),
});

export const desktopMigrationRunInput = z.object({ choices: z.array(z.object({ key: z.string().max(64), action: z.enum(["keep", "copy", "skip"]) })).max(32) });
export const desktopMigrationRun = defineAction<typeof desktopMigrationRunInput, DesktopContext<z.output<typeof desktopMigrationRunInput>>, unknown>({
  input: desktopMigrationRunInput,
  http: { method: "POST", path: "/api/desktop/migration" },
  mcp: { reason: "Importing an earlier installation requires the authenticated desktop migration wizard." },
  handler: (input, context) => context.execute(input),
});

export const desktopSelftestRoundtripInput = z.object({});
export const desktopSelftestRoundtrip = defineAction<typeof desktopSelftestRoundtripInput, DesktopContext<z.output<typeof desktopSelftestRoundtripInput>>, unknown>({
  input: desktopSelftestRoundtripInput,
  http: { method: "GET", path: "/api/desktop/selftest-roundtrip" },
  mcp: { reason: "The packaged desktop self-test performs an authenticated local storage round-trip." },
  handler: (input, context) => context.execute(input),
});

export const desktopTerminalTicketInput = z.object({});
export const desktopTerminalTicket = defineAction<typeof desktopTerminalTicketInput, DesktopContext<z.output<typeof desktopTerminalTicketInput>>, unknown>({
  input: desktopTerminalTicketInput,
  http: { method: "GET", path: "/api/desktop/terminal-ticket" },
  mcp: { reason: "The desktop browser obtains a short-lived WebSocket ticket through its authenticated session." },
  handler: (input, context) => context.execute(input),
});

export const desktopUpstartReadInput = z.object({ repo: z.string().nullable() });
export const desktopUpstartRead = defineAction<typeof desktopUpstartReadInput, DesktopContext<z.output<typeof desktopUpstartReadInput>>, unknown>({
  input: desktopUpstartReadInput,
  http: { method: "GET", path: "/api/desktop/upstart" },
  mcp: { reason: "The dashboard presents a local upstart script for explicit user review." },
  handler: (input, context) => context.execute(input),
});

export const desktopUpstartActionInput = z.object({
  repo: z.string().max(200),
  action: z.enum(["approve", "revoke", "run"]),
  // Approval requires the hash of the reviewed bytes, so later edits cannot be approved implicitly.
  sha256: z.string().length(64).optional(),
});
export const desktopUpstartAction = defineAction<typeof desktopUpstartActionInput, DesktopContext<z.output<typeof desktopUpstartActionInput>>, unknown>({
  input: desktopUpstartActionInput,
  http: { method: "POST", path: "/api/desktop/upstart" },
  mcp: { reason: "The dashboard records user approval for reviewed script bytes and supplies the local run command." },
  handler: (input, context) => context.execute(input),
});
