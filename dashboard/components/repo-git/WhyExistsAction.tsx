"use client";

import { Pickaxe } from "lucide-react";
import { agentSkillCommand, openTerminal } from "@/lib/terminal-launch";
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
          openTerminal({
            cwd: repoPath,
            label: `why · ${filePath}`,
            command: await agentSkillCommand(
              "commit-archaeologist",
              `Explain why ${filePath} exists in ${repoName}.`,
              "run commit-archaeologist",
            ),
          });
          toast.info("Archaeology running in the terminal.");
        })();
      }}
    >
      <Pickaxe size={12} aria-hidden />
    </button>
  );
}
