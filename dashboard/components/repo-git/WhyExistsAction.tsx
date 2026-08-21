"use client";

import { Pickaxe } from "lucide-react";
import { launchAgentJob } from "@/lib/agent-job";
import { agentSkillCommand } from "@/lib/terminal-launch";
import { useToast } from "@/lib/hooks/use-toast";

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
  const toast = useToast();
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
          const result = await launchAgentJob({
            title: `why · ${filePath}`,
            kind: "agent",
            cwd: repoPath,
            repoName,
            promptText: `Use the commit-archaeologist skill. ${instruction}`,
            promptCommand: await agentSkillCommand(
              "commit-archaeologist",
              instruction,
              "run commit-archaeologist",
            ),
            mode: "oneshot",
            alreadyConfirmed: true,
            reason: `Why does ${filePath} exist?`,
          });
          toast.info(
            result.channel === "opencode"
              ? "Archaeology running in OpenCode."
              : "Archaeology queued in the Agent tab.",
          );
        })();
      }}
    >
      <Pickaxe size={12} aria-hidden />
    </button>
  );
}
