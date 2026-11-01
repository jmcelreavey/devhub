/** Hidden user message that triggers the tutor's opening calibration question. */
export const REPO_LEARN_TUTOR_START = "[start-tutor-session]";

export const REPO_LEARN_NOT_CONFIGURED_MSG =
  "No AI provider available. Install cursor-agent, ChatGPT/Codex, or OpenCode — or set AI_API_KEY — then pick a default under Setup → AI Provider.";


export function repoLearnApiPath(repoName: string, suffix = ""): string {
  return `/api/repos/${encodeURIComponent(repoName)}/learn${suffix}`;
}
