import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let notesDir: string;

vi.mock("@/lib/notes/dir", () => ({
  getNotesDir: () => notesDir,
}));

const {
  acknowledge,
  acknowledgementFor,
  acknowledgementsPath,
  isSuppressed,
  partitionByAcknowledgement,
  pruneAcknowledgements,
  readAcknowledgements,
  unacknowledge,
} = await import("./acknowledgements");

beforeEach(() => {
  notesDir = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-ack-"));
});

afterEach(() => {
  fs.rmSync(notesDir, { recursive: true, force: true });
});

describe("storage location", () => {
  it("lives under notes/, not notes/.cache/", () => {
    // An acknowledgement is the only non-derived thing this feature writes. In
    // the cache, a cache clear silently discards the user's triage.
    const file = acknowledgementsPath();
    expect(file.startsWith(notesDir)).toBe(true);
    expect(file).not.toContain(".cache");
  });

  it("hides in a dot-directory so the notes vault never lists it", () => {
    // notes/ is a browsable vault and both note-index.ts and search.ts index
    // .json, so a plain notes/radar/ path surfaced this machine-state file as a
    // note called "acknowledgements". Both walkers skip dot-prefixed names.
    // It also kept company with the user's own notes/radar/personal-radar.md.
    expect(acknowledgementsPath()).toContain(`${path.sep}.radar${path.sep}`);
  });

  it("creates the directory on first write", () => {
    acknowledge("capability", "kubernetes", 3);
    expect(fs.existsSync(acknowledgementsPath())).toBe(true);
  });

  it("returns an empty store when nothing has been acknowledged", () => {
    expect(readAcknowledgements()).toEqual({});
  });
});

describe("acknowledge / unacknowledge", () => {
  it("records the magnitude at acknowledgement time", () => {
    acknowledge("capability", "kubernetes", 3);
    const ack = acknowledgementFor(readAcknowledgements(), "capability", "kubernetes");
    expect(ack?.watermark).toBe(3);
    expect(Date.parse(ack!.ackedAt)).not.toBeNaN();
  });

  it("namespaces kinds so ids cannot collide", () => {
    acknowledge("capability", "redis", 2);
    const store = readAcknowledgements();
    expect(acknowledgementFor(store, "capability", "redis")).not.toBeNull();
    expect(acknowledgementFor(store, "release", "redis")).toBeNull();
  });

  it("clamps a nonsense watermark instead of trusting the caller", () => {
    // A negative watermark would make `current > watermark` trivially true and
    // the acknowledgement a no-op; NaN would make it never true, hiding the
    // item forever.
    acknowledge("capability", "a", -5);
    acknowledge("capability", "b", Number.NaN);
    const store = readAcknowledgements();
    expect(acknowledgementFor(store, "capability", "a")?.watermark).toBe(0);
    expect(acknowledgementFor(store, "capability", "b")?.watermark).toBe(0);
  });

  it("undoes an acknowledgement", () => {
    acknowledge("capability", "kubernetes", 3);
    unacknowledge("capability", "kubernetes");
    expect(acknowledgementFor(readAcknowledgements(), "capability", "kubernetes")).toBeNull();
  });
});

describe("isSuppressed — watermark, not delete", () => {
  it("hides an item that has not changed since acknowledgement", () => {
    acknowledge("capability", "kubernetes", 3);
    expect(isSuppressed(readAcknowledgements(), "capability", "kubernetes", 3)).toBe(true);
  });

  it("keeps hiding an item that shrank", () => {
    acknowledge("capability", "kubernetes", 5);
    expect(isSuppressed(readAcknowledgements(), "capability", "kubernetes", 2)).toBe(true);
  });

  it("re-surfaces an item that grew past where it was acknowledged", () => {
    // The whole point. "In 3 repos" and "in 11 repos" are different facts, and
    // dismissing the first must not silence the second.
    acknowledge("capability", "kubernetes", 3);
    expect(isSuppressed(readAcknowledgements(), "capability", "kubernetes", 11)).toBe(false);
  });

  it("does not hide anything that was never acknowledged", () => {
    expect(isSuppressed(readAcknowledgements(), "capability", "never-seen", 99)).toBe(false);
  });
});

describe("partitionByAcknowledgement", () => {
  interface Row {
    id: string;
    repoCount: number;
  }
  const rows: Row[] = [
    { id: "kubernetes", repoCount: 3 },
    { id: "redis", repoCount: 8 },
    { id: "kafka", repoCount: 1 },
  ];
  const partition = () =>
    partitionByAcknowledgement(rows, "capability", (r) => r.id, (r) => r.repoCount);

  it("shows everything when nothing is acknowledged", () => {
    const { visible, acknowledged } = partition();
    expect(visible).toHaveLength(3);
    expect(acknowledged).toHaveLength(0);
  });

  it("moves unchanged acknowledged rows aside rather than dropping them", () => {
    // Available behind a toggle: a surface that can hide things but not show
    // them again teaches people not to use the hide button.
    acknowledge("capability", "kubernetes", 3);
    const { visible, acknowledged } = partition();
    expect(visible.map((r) => r.id)).toEqual(["redis", "kafka"]);
    expect(acknowledged.map((r) => r.id)).toEqual(["kubernetes"]);
    expect(acknowledged[0].acknowledgedAt_watermark).toBe(3);
  });

  it("keeps a grown row visible even though it was acknowledged", () => {
    acknowledge("capability", "redis", 4);
    const { visible } = partition();
    expect(visible.map((r) => r.id)).toContain("redis");
  });
});

describe("resilience", () => {
  it("ignores a corrupt file rather than throwing", () => {
    fs.mkdirSync(path.dirname(acknowledgementsPath()), { recursive: true });
    fs.writeFileSync(acknowledgementsPath(), "{ not json");
    expect(readAcknowledgements()).toEqual({});
  });

  it("drops entries with a non-numeric watermark", () => {
    // A NaN watermark makes `current <= watermark` false forever in one
    // direction and true in the other depending on comparison order — either
    // way the item's visibility stops being explicable. Better to forget it.
    fs.mkdirSync(path.dirname(acknowledgementsPath()), { recursive: true });
    fs.writeFileSync(
      acknowledgementsPath(),
      JSON.stringify({
        "capability:good": { ackedAt: "2026-01-01T00:00:00.000Z", watermark: 2 },
        "capability:bad": { ackedAt: "2026-01-01T00:00:00.000Z", watermark: "lots" },
        "capability:alsobad": { watermark: 3 },
      }),
    );
    const store = readAcknowledgements();
    expect(Object.keys(store)).toEqual(["capability:good"]);
  });
});

describe("pruneAcknowledgements", () => {
  it("forgets ids that no longer exist", () => {
    acknowledge("capability", "kubernetes", 3);
    acknowledge("capability", "gone", 1);
    pruneAcknowledgements("capability", ["kubernetes"]);
    const store = readAcknowledgements();
    expect(acknowledgementFor(store, "capability", "kubernetes")).not.toBeNull();
    expect(acknowledgementFor(store, "capability", "gone")).toBeNull();
  });

  it("leaves other kinds alone", () => {
    acknowledge("release", "left-pad", 1);
    pruneAcknowledgements("capability", []);
    expect(acknowledgementFor(readAcknowledgements(), "release", "left-pad")).not.toBeNull();
  });

  it("does not confuse an id containing the kind separator", () => {
    acknowledge("capability", "scope:weird", 1);
    pruneAcknowledgements("capability", ["scope:weird"]);
    expect(acknowledgementFor(readAcknowledgements(), "capability", "scope:weird")).not.toBeNull();
  });
});
