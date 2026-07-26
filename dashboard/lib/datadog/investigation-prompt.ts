export interface DatadogInvestigationInput {
  scope: "oncall" | "team" | "general";
  title?: string;
  status?: string;
  tags?: string[];
  timestampMs?: number;
}

const SCOPE_LABEL: Record<DatadogInvestigationInput["scope"], string> = {
  oncall: "@oncall-dad (urgent — pages/SMS)",
  team: "@slack-dad-team-alerts (team channel, non-paging)",
  general: "Datadog alerts",
};

/** Build the investigation prompt handed to an OpenCode session. */
export function buildDatadogInvestigationPrompt(input: DatadogInvestigationInput): string {
  const lines: string[] = [];
  lines.push(`Investigate a Datadog alert from ${SCOPE_LABEL[input.scope]}.`);
  lines.push("");

  if (input.title || input.status || input.tags?.length || input.timestampMs) {
    lines.push("## Alert");
    if (input.title) lines.push(`- Title: ${input.title}`);
    if (input.status) lines.push(`- Status: ${input.status}`);
    if (input.timestampMs) lines.push(`- Fired: ${new Date(input.timestampMs).toISOString()}`);
    if (input.tags?.length) lines.push(`- Tags: ${input.tags.join(", ")}`);
    lines.push("");
  }

  lines.push("## What to do");
  lines.push("1. Summarise what this alert means and which service/team owns it (use the tags).");
  lines.push("2. Check recent deploys and commits around the alert time — correlate likely causes.");
  lines.push("3. Suggest the specific Datadog dashboards, logs, or metrics to query next.");
  lines.push("4. Recommend an immediate mitigation if the impact is user-facing.");
  lines.push("");
  lines.push("Keep it concise and actionable. If you use the `datadog-investigation` skill, follow it.");

  return lines.join("\n");
}
