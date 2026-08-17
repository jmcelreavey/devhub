import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Advisory } from "./analyse";
import type { ReleaseRadarResult } from "./scan";

let notesDir: string;

vi.mock("@/lib/notes/dir", () => ({
  getNotesDir: () => notesDir,
}));

const { acknowledge, acknowledgementFor, readAcknowledgements } = await import(
  "@/lib/radar/acknowledgements"
);
const { presentReleaseRadar } = await import("./present");

function advisory(
  partial: Partial<Advisory> & Pick<Advisory, "id" | "devOnly" | "behindRepos" | "repoCount">,
): Advisory {
  return {
    name: partial.id,
    latestLine: "19",
    lines: [],
    spread: 1,
    ...partial,
  };
}

function scan(advisories: Advisory[]): ReleaseRadarResult {
  return {
    advisories,
    reposWithManifests: 4,
    reposScanned: 4,
    manifestsRead: 4,
    scannedAt: "2026-08-14T00:00:00.000Z",
  };
}

beforeEach(() => {
  notesDir = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-release-ack-"));
});

afterEach(() => {
  fs.rmSync(notesDir, { recursive: true, force: true });
});

describe("presentReleaseRadar", () => {
  it("does not prune a dev-only ack just because the view is prodOnly", () => {
    acknowledge("release", "eslint", 2);
    const result = presentReleaseRadar(
      scan([
        advisory({ id: "eslint", devOnly: true, behindRepos: ["a", "b"], repoCount: 5 }),
        advisory({ id: "react", devOnly: false, behindRepos: ["a", "b", "c"], repoCount: 6 }),
      ]),
      true,
    );

    expect(result.advisories.map((row) => row.id)).toEqual(["react"]);
    expect(acknowledgementFor(readAcknowledgements(), "release", "eslint")).not.toBeNull();
  });

  it("uses behindRepos.length as the watermark, not repoCount", () => {
    acknowledge("release", "react", 2);
    const grown = presentReleaseRadar(
      scan([advisory({ id: "react", devOnly: false, behindRepos: ["a", "b", "c"], repoCount: 2 })]),
      false,
    );
    expect(grown.advisories.map((row) => row.id)).toEqual(["react"]);
    expect(grown.acknowledged).toHaveLength(0);

    const held = presentReleaseRadar(
      scan([advisory({ id: "react", devOnly: false, behindRepos: ["a", "b"], repoCount: 9 })]),
      false,
    );
    expect(held.advisories).toHaveLength(0);
    expect(held.acknowledged.map((row) => row.id)).toEqual(["react"]);
  });
});
