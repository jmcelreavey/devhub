import { execGh, githubCliErrorInfo } from "../gh-exec";
import { accountConfig, credential } from "./accounts";
import { providerJson, statusError } from "./http";
import { IntegrationError, type IntegrationContext } from "./types";

export async function githubRequest(account: string, endpoint: string, context: IntegrationContext, method = "GET", body?: unknown): Promise<unknown> {
  if (account !== "default") {
    const config = accountConfig("github", account);
    return providerJson("https://api.github.com/" + endpoint, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { "Content-Type": "application/json", Authorization: "Bearer " + credential(config.tokenRef), Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" } }, context.signal);
  }
  try {
    const result = await execGh(["api", "--method", method, endpoint, ...(body === undefined ? [] : ["--input", "-"])], { signal: context.signal, timeoutMs: 15000, input: body === undefined ? undefined : JSON.stringify(body) });
    return result.stdout.trim() ? JSON.parse(result.stdout) : null;
  } catch (error) {
    if (context.signal.aborted) throw error;
    const message = error instanceof Error ? error.message : "";
    const status = message.match(/HTTP (\d{3})/);
    if (status) throw statusError(Number(status[1]));
    const info = githubCliErrorInfo(error);
    throw new IntegrationError(info.kind === "auth" ? "auth" : "unavailable", info.kind === "auth" ? "Sign in with gh auth login." : "GitHub CLI is unavailable or could not complete this request.");
  }
}
