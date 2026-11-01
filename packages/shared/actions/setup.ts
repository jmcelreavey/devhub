import { z } from "zod";
import { defineAction } from "./define.ts";

interface SetupContext<Input> { execute: (input: Input) => unknown }

// Opaque bodies stay with their existing dashboard validators and credential handling.

export const setupDatadogCheckInput = z.object({ body: z.unknown() });
export const setupDatadogSavedCheck = defineAction<typeof setupDatadogCheckInput, SetupContext<z.output<typeof setupDatadogCheckInput>>, unknown>({
  input: setupDatadogCheckInput,
  http: { method: "GET", path: "/api/setup/check/datadog" },
  mcp: { reason: "Checking saved Datadog credentials is an authenticated setup-wizard operation." },
  handler: (input, context) => context.execute(input),
});

export const setupDatadogFormCheck = defineAction<typeof setupDatadogCheckInput, SetupContext<z.output<typeof setupDatadogCheckInput>>, unknown>({
  input: setupDatadogCheckInput,
  http: { method: "POST", path: "/api/setup/check/datadog" },
  mcp: { reason: "Checking entered Datadog credentials belongs to the authenticated setup wizard." },
  handler: (input, context) => context.execute(input),
});

export const setupJiraSavedCheckInput = z.object({});
export const setupJiraSavedCheck = defineAction<typeof setupJiraSavedCheckInput, SetupContext<z.output<typeof setupJiraSavedCheckInput>>, unknown>({
  input: setupJiraSavedCheckInput,
  http: { method: "GET", path: "/api/setup/check/jira" },
  mcp: { reason: "Checking saved Jira credentials is a setup-wizard operation, not an MCP tool." },
  handler: (input, context) => context.execute(input),
});

export const setupJiraFormCheckInput = z.object({ body: z.unknown() });
export const setupJiraFormCheck = defineAction<typeof setupJiraFormCheckInput, SetupContext<z.output<typeof setupJiraFormCheckInput>>, unknown>({
  input: setupJiraFormCheckInput,
  http: { method: "POST", path: "/api/setup/check/jira" },
  mcp: { reason: "Checking unsaved Jira credentials belongs to the setup wizard and its existing credential handling." },
  handler: (input, context) => context.execute(input),
});

export const setupTypesafeCheckInput = z.object({ body: z.unknown() });
export const setupTypesafeCheck = defineAction<typeof setupTypesafeCheckInput, SetupContext<z.output<typeof setupTypesafeCheckInput>>, unknown>({
  input: setupTypesafeCheckInput,
  http: { method: "POST", path: "/api/setup/check/typesafe" },
  mcp: { reason: "Checking an entered or saved Typesafe key belongs to the setup wizard and its existing credential handling." },
  handler: (input, context) => context.execute(input),
});

export const setupDependenciesInput = z.object({ goals: z.string().nullable() });
export const setupDependencies = defineAction<typeof setupDependenciesInput, SetupContext<z.output<typeof setupDependenciesInput>>, unknown>({
  input: setupDependenciesInput,
  http: { method: "GET", path: "/api/setup/dependencies" },
  mcp: { reason: "Dependency probes support the setup wizard and its platform-specific installation guidance." },
  handler: (input, context) => context.execute(input),
});

export const setupGitCheckInput = z.object({});
export const setupGitCheck = defineAction<typeof setupGitCheckInput, SetupContext<z.output<typeof setupGitCheckInput>>, unknown>({
  input: setupGitCheckInput,
  http: { method: "GET", path: "/api/setup/git" },
  mcp: { reason: "Git availability and installation guidance are local setup diagnostics." },
  handler: (input, context) => context.execute(input),
});

export const setupGitInstallGetInput = z.object({});
export const setupGitInstallGet = defineAction<typeof setupGitInstallGetInput, SetupContext<z.output<typeof setupGitInstallGetInput>>, unknown>({
  input: setupGitInstallGetInput,
  http: { method: "GET", path: "/api/setup/git/install" },
  mcp: { reason: "This method only rejects attempts to start the local Git installer without POST." },
  handler: (input, context) => context.execute(input),
});

export const setupGitInstallInput = z.object({});
export const setupGitInstall = defineAction<typeof setupGitInstallInput, SetupContext<z.output<typeof setupGitInstallInput>>, unknown>({
  input: setupGitInstallInput,
  http: { method: "POST", path: "/api/setup/git/install" },
  mcp: { reason: "Launching the platform Git installer requires the local setup workflow." },
  handler: (input, context) => context.execute(input),
});

export const setupGithubDeviceInput = z.object({ body: z.unknown() });
export const setupGithubDevice = defineAction<typeof setupGithubDeviceInput, SetupContext<z.output<typeof setupGithubDeviceInput>>, unknown>({
  input: setupGithubDeviceInput,
  http: { method: "POST", path: "/api/setup/github/device" },
  mcp: { reason: "GitHub device login is an interactive credential flow owned by the setup wizard." },
  handler: (input, context) => context.execute(input),
});

export const setupPrivateRepoReadInput = z.object({});
export const setupPrivateRepoRead = defineAction<typeof setupPrivateRepoReadInput, SetupContext<z.output<typeof setupPrivateRepoReadInput>>, unknown>({
  input: setupPrivateRepoReadInput,
  http: { method: "GET", path: "/api/setup/private-repo" },
  mcp: { reason: "Private content repository setup reveals local paths and requires dashboard authentication." },
  handler: (input, context) => context.execute(input),
});

export const setupPrivateRepoWriteInput = z.object({ body: z.unknown() });
export const setupPrivateRepoWrite = defineAction<typeof setupPrivateRepoWriteInput, SetupContext<z.output<typeof setupPrivateRepoWriteInput>>, unknown>({
  input: setupPrivateRepoWriteInput,
  http: { method: "POST", path: "/api/setup/private-repo" },
  mcp: { reason: "Creating, cloning, or linking the private content repository requires the authenticated setup workflow." },
  handler: (input, context) => context.execute(input),
});

export const setupSaveInput = z.object({ body: z.unknown() });
export const setupSave = defineAction<typeof setupSaveInput, SetupContext<z.output<typeof setupSaveInput>>, unknown>({
  input: setupSaveInput,
  http: { method: "POST", path: "/api/setup/save" },
  mcp: { reason: "Saving setup changes local configuration and credentials under the existing dashboard checks." },
  handler: (input, context) => context.execute(input),
});

export const setupStatusInput = z.object({});
export const setupStatus = defineAction<typeof setupStatusInput, SetupContext<z.output<typeof setupStatusInput>>, unknown>({
  input: setupStatusInput,
  http: { method: "GET", path: "/api/setup/status" },
  mcp: { reason: "Setup status includes local configuration and integration details for the dashboard." },
  handler: (input, context) => context.execute(input),
});

export const setupValidatePathInput = z.object({ repoRoot: z.string().optional(), notesDir: z.string().optional(), reposDir: z.string().optional() });
export const setupValidatePath = defineAction<typeof setupValidatePathInput, SetupContext<z.output<typeof setupValidatePathInput>>, unknown>({
  input: setupValidatePathInput,
  http: { method: "POST", path: "/api/setup/validate-path" },
  mcp: { reason: "Local filesystem path validation supports the setup form." },
  handler: (input, context) => context.execute(input),
});
