import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { profileConfigDir } from "@/lib/profile-state";
import { readDashboardEnvLocalFile, resolveEnvValue } from "@/lib/dashboard-env-local";
import { IntegrationError } from "./types";
const envRef = z.string().regex(/^[A-Z][A-Z0-9_]{1,127}$/);
export const AccountSchema = z.object({
  provider: z.enum(["jira", "github"]), id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).refine((id) => id !== "default", "Default accounts use existing setup."),
  label: z.string().trim().min(1).max(80), tokenRef: envRef,
  domain: z.string().regex(/^[a-z0-9][a-z0-9-]*\.atlassian\.net$/).optional(), emailRef: envRef.optional(),
}).strict().refine((account) => account.provider !== "jira" || Boolean(account.domain && account.emailRef), "Jira needs its cloud domain and email variable.");
export type SavedAccount = z.infer<typeof AccountSchema>;
const FileSchema = z.object({ version: z.literal(1), accounts: z.array(AccountSchema).max(30) });
function file(root = profileConfigDir()) { return path.join(root, "integration-accounts.json"); }
export function readAccounts(root?: string): SavedAccount[] {
  try { return FileSchema.parse(JSON.parse(fs.readFileSync(file(root), "utf8"))).accounts; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}
export function credential(ref: string): string {
  const value = resolveEnvValue(ref, readDashboardEnvLocalFile().overrides);
  if (!value) throw new IntegrationError("auth", "Set the referenced server environment variable and restart DevHub, then retry.");
  return value;
}
export function accountConfig(provider: string, id: string): SavedAccount {
  const account = readAccounts().find((item) => item.provider === provider && item.id === id);
  if (!account) throw new IntegrationError("not-found", "This integration account is no longer configured.");
  return account;
}
export function accountsFor(provider: "jira" | "github") {
  return [{ provider, id: "default", label: "Existing " + (provider === "jira" ? "Jira setup" : "gh login") },
    ...readAccounts().filter((item) => item.provider === provider).map(({ provider, id, label }) => ({ provider, id, label }))];
}
