"use client";

import { launchAgentJob } from "@/lib/agent-job";
import { Pickaxe } from "lucide-react";

/** Icon-only launch of commit-archaeologist for the selected history file. */
export function WhyExistsAction({
  repoPath,
  repoName,
  filePath,
  disabled = false,
}: {
  repoPath: string;
  repoName: string;
  filePath: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="btn btn-ghost"
      style={{ fontSize: 11, gap: 4, padding: "3px 8px" }}
      title="Why does this exist?"
      aria-label={`Why does ${filePath} exist?`}
      disabled={disabled}
      onClick={() => {
        void (async () => {
          const instruction = `Explain why ${filePath} exists in ${repoName}.`;
          await launchAgentJob({
            title: `why · ${filePath}`,
            kind: "agent",
            cwd: repoPath,
            repoName,
            promptText: `Use the commit-archaeologist skill. ${instruction}`,
            mode: "oneshot",
            alreadyConfirmed: true,
            reason: `Why does ${filePath} exist?`,
          });

        })();
      }}
    >
      <Pickaxe size={12} aria-hidden />
    </button>
  );
}
