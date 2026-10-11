import fs from "node:fs";
import { requireReleaseNotes } from "../../shared/release-notes/index.mjs";

const [version, changelog = new URL("../../CHANGELOG.md", import.meta.url), output] = process.argv.slice(2);
try {
  if (!version) throw new Error("Usage: extract-release-notes.mjs <version> [changelog] [output]");
  const notes = requireReleaseNotes(fs.readFileSync(changelog, "utf8"), version);
  if (output) fs.writeFileSync(output, `${notes}\n`);
  else process.stdout.write(`${notes}\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
