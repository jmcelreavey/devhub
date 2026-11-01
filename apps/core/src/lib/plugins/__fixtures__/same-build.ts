import fs from "node:fs";
import path from "node:path";
import { hashFile } from "../inspect";
import { readManifest } from "../manifest";
import { themePaletteTokens } from "../../../../../../packages/shared/ui-lib/plugins/theme-palette-schema";

export const reviewedFixtures = ["views", "slots", "service", "theme", "mcp"] as const;
export type ReviewedFixture = typeof reviewedFixtures[number];

/** Create a reviewed candidate outside the core tree, using the shipped worker template. */
export function writeReviewedFixture(source: string, kind: ReviewedFixture) {
  fs.cpSync(path.resolve("../../templates/runtime-plugin"), source, { recursive: true });
  const parsed = readManifest(source);
  if (!parsed.ok || !parsed.manifest.runtime) throw new Error("Invalid runtime fixture");
  const manifest = parsed.manifest;
  const runtime = manifest.runtime!;
  manifest.name = `fixture-${kind}`;
  runtime.aliases = [{ kind: "api", path: `/api/fixture-${kind}/status`, target: "/status", method: "GET" }];
  if (kind === "slots") runtime.capabilities = { slots: [{ id: "setup", location: "setup", label: "Fixture setup", routes: [] }] };
  if (kind === "service") runtime.capabilities = { service: { id: "fixture", label: "Fixture service", maxRunSeconds: 30 } };
  if (kind === "theme") {
    const palette = Object.fromEntries(themePaletteTokens.map(token => [token, "#112233"])) as Record<typeof themePaletteTokens[number], string>;
    runtime.capabilities = { themes: [{ id: "fixture-theme", label: "Fixture theme", description: "Fixture palette", dark: palette, light: palette }] };
  }
  const save = () => fs.writeFileSync(path.join(source, "devhub-plugin.json"), JSON.stringify(manifest));
  const update = () => {
    fs.appendFileSync(path.join(source, runtime.entry), "\n// reviewed replacement\n");
    runtime.sha256 = hashFile(path.join(source, runtime.entry));
    save();
  };
  save();
  return { manifest, runtime, update };
}
