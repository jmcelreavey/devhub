/** Hidden user message that triggers the tutor's opening calibration question. */
export const REPO_LEARN_TUTOR_START = "[start-tutor-session]";

export const REPO_LEARN_NOT_CONFIGURED_MSG =
  "Set AI_API_KEY in dashboard/.env.local and restart the dev server.";

export function repoLearnApiPath(repoName: string, suffix = ""): string {
  return `/api/repos/${encodeURIComponent(repoName)}/learn${suffix}`;
}
