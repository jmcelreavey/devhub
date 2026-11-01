import path from "node:path";
import { fileURLToPath } from "node:url";

const checkoutRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

export function applyCheckoutDevDefaults(env: Partial<NodeJS.ProcessEnv> = process.env): void {
  if (env.DEVHUB_SHELL_SUPERVISED === "1") {
    delete env.DEVHUB_CHECKOUT_DEV;
    return;
  }
  env.PORT = env.PORT?.trim() || "1437";
  env.TERMINAL_PORT = env.TERMINAL_PORT?.trim() || "1439";
  env.DEVHUB_MCP_HTTP_PORT = env.DEVHUB_MCP_HTTP_PORT?.trim() || "1440";
  env.DEVHUB_SCHEDULER = env.DEVHUB_SCHEDULER?.trim() === "1" ? "1" : "0";
  // Opting into local jobs must not update CLIs shared with the installed app.
  env.DEVHUB_AGENT_AUTO_UPDATE = env.DEVHUB_AGENT_AUTO_UPDATE?.trim() || "0";
  if (env.DEVHUB_SCHEDULER === "0") env.DEVHUB_MCP_HTTP = "0";
  env.DEVHUB_APP_DATA = env.DEVHUB_APP_DATA?.trim() || path.resolve(env.REPO_ROOT?.trim() || checkoutRoot);
  env.DEVHUB_CONFIG_DIR = env.DEVHUB_CONFIG_DIR?.trim() || path.join(env.DEVHUB_APP_DATA, ".devhub", "config");
  env.DEVHUB_CHECKOUT_DEV = "1";
}
