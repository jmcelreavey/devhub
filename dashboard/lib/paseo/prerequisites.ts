/** What a clean machine is missing before Agents can run. No subprocesses. */

export const SETUP_TOOLS_HREF = "/setup?step=tools";
export const NODE_DOWNLOAD_URL = "https://nodejs.org/en/download";

export interface AgentPrerequisites {
  node: boolean;
  npm: boolean;
  safeChain: boolean;
  paseoRunning: boolean;
}

export type AgentBlocker = "node" | "npm" | "safe-chain" | "paseo" | null;

export function agentBlocker(input: AgentPrerequisites): AgentBlocker {
  if (!input.node) return "node";
  if (!input.npm) return "npm";
  if (!input.safeChain) return "safe-chain";
  if (!input.paseoRunning) return "paseo";
  return null;
}

export function safeChainRowState(npmPresent: boolean): { enabled: boolean; hint: string | null; downloadUrl: string | null } {
  if (npmPresent) return { enabled: true, hint: null, downloadUrl: null };
  return {
    enabled: false,
    hint: "Install Node.js first. Agents need Node.js, then Safe-Chain, then Paseo.",
    downloadUrl: NODE_DOWNLOAD_URL,
  };
}

const ORDER = "Agents need Node.js, then Safe-Chain, then Paseo.";
const CHECKOUT_DETAIL = "Developer detail: the dashboard looks for the daemon at DEVHUB_PASEO_URL (default ws://127.0.0.1:6767).";

export function agentSetupMessage(input: AgentPrerequisites, opts?: { checkout?: boolean; packaged?: boolean }): {
  message: string;
  detail: string | null;
  setupHref: string;
} {
  const detail = opts?.checkout ? CHECKOUT_DETAIL : null;
  const blocker = agentBlocker(input);
  if (blocker === "node" || blocker === "npm") {
    return {
      message: opts?.packaged ? "Bundled tools are unavailable. Update or reinstall DevHub, then click Re-check." : `Install Node.js first. ${ORDER} Download the LTS installer, then come back and click Re-check.`,
      detail,
      setupHref: SETUP_TOOLS_HREF,
    };
  }
  if (blocker === "safe-chain") {
    return {
      message: `Safe-Chain isn't installed. ${ORDER} Install Safe-Chain from Setup → Tools, then set up Paseo.`,
      detail,
      setupHref: SETUP_TOOLS_HREF,
    };
  }
  if (blocker === "paseo") {
    return {
      message: `Paseo isn't set up or isn't running. ${ORDER} Set it up from Setup → Tools.`,
      detail,
      setupHref: SETUP_TOOLS_HREF,
    };
  }
  return { message: "", detail: null, setupHref: SETUP_TOOLS_HREF };
}
