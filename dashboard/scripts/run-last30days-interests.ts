import { loadEnvWithOnePasswordFallback } from "./op-secrets";
import { readBriefingPrefs } from "../lib/briefing-prefs";
import { runLast30DaysForInterests } from "../lib/last30days-runner";

async function main(): Promise<number> {
  await loadEnvWithOnePasswordFallback(process.cwd());
  const prefs = readBriefingPrefs();
  const interests = [...new Set(prefs.interests.map((i) => i.trim()).filter(Boolean))];
  if (interests.length === 0) {
    process.stdout.write("No briefing interests configured; nothing to research.\n");
    return 0;
  }
  const result = await runLast30DaysForInterests(interests);
  process.stdout.write(`Saving Last30Days briefs to ${result.saveDir}\n`);
  process.stdout.write(result.output.join(""));
  if (!result.ok) process.stderr.write(`${result.failed.length} Last30Days run(s) failed.\n`);
  return result.ok ? 0 : 1;
}

main().then((code) => process.exit(code));
