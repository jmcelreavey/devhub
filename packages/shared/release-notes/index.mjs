export const RELEASE_VERSION_PATTERN = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function normaliseReleaseVersion(value) {
  if (typeof value !== "string" || !RELEASE_VERSION_PATTERN.test(value.trim())) return null;
  return value.trim().replace(/^v/, "");
}

export function parseChangelog(source) {
  const releases = [];
  const versions = new Set();
  let current = null;
  let body = [];
  let highlights = [];
  let fence = null;
  const finish = () => {
    if (!current) return;
    const markdown = body.join("\n").trim();
    releases.push({ ...current, markdown, highlights });
  };
  for (const line of source.replace(/\r\n?/g, "\n").split("\n")) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      body.push(line);
      continue;
    }
    const heading = !fence ? /^##\s+(?:\[([^\]]+)\]|(\S+))(?:\s+.*)?$/.exec(line) : null;
    if (!heading) {
      body.push(line);
      if (!fence && /^-\s+/.test(line)) highlights.push(line.replace(/^-\s+/, ""));
      continue;
    }
    finish();
    body = [];
    highlights = [];
    const label = heading[1] ?? heading[2];
    const version = /^unreleased$/i.test(label) ? "Unreleased" : normaliseReleaseVersion(label);
    current = null;
    if (!version) continue;
    if (versions.has(version)) throw new Error(`Duplicate CHANGELOG entry for ${version}.`);
    versions.add(version);
    current = { version, date: /\b(\d{4}-\d{2}-\d{2})\b/.exec(line)?.[1] ?? null };
  }
  finish();
  return releases;
}

export function requireReleaseNotes(source, version) {
  const normalised = normaliseReleaseVersion(version);
  if (!normalised) throw new Error(`Invalid release version: ${version}`);
  const release = parseChangelog(source).find((entry) => entry.version === normalised);
  if (!release?.markdown) throw new Error(`CHANGELOG.md has no non-empty entry for ${normalised}. Update CHANGELOG before release.`);
  return release.markdown;
}
