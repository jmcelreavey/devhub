import { describe, expect, it } from "vitest";
import {
  DEFAULT_GRAPH_COLUMNS,
  fitColumns,
  graphGridTemplate,
  groupRefLabels,
  pickSwitchTarget,
  resolveColumns,
} from "./CommitGraph";

describe("resolveColumns", () => {
  it("defaults to the default columns", () => {
    expect(resolveColumns()).toEqual(DEFAULT_GRAPH_COLUMNS);
    expect(resolveColumns({})).toEqual(DEFAULT_GRAPH_COLUMNS);
  });

  it("merges partial overrides over the defaults", () => {
    expect(resolveColumns({ author: true })).toEqual({
      hash: true,
      refs: true,
      author: true,
      date: true,
    });
    // An explicitly false entry must not be "filled in" back to true.
    const cols = resolveColumns({ hash: false, refs: false });
    expect(cols.hash).toBe(false);
    expect(cols.refs).toBe(false);
  });
});

/**
 * Track order is the contract, so these assert on the whole template.
 *
 * Splitting on spaces looks natural and is wrong: `minmax(0, 1fr)` contains
 * one, so `split(" ")[1]` is the string `"minmax(0,"`. Comparing the full
 * string is both correct and a stronger assertion.
 */
describe("graphGridTemplate", () => {
  it("puts labels left of the lane track, subject after it", () => {
    // refs | lanes | subject | author | date | hash | kebab
    expect(graphGridTemplate({ hash: true, refs: true, author: true, date: true }, 60)).toBe(
      "150px 60px minmax(0, 1fr) 140px 92px 72px 24px",
    );
  });

  it("drops tracks for hidden columns; lanes, subject and kebab always remain", () => {
    expect(graphGridTemplate({ hash: false, refs: false, author: false, date: false }, 42)).toBe(
      "42px minmax(0, 1fr) 24px",
    );
  });
});

describe("fitColumns", () => {
  const all = { hash: true, refs: true, author: true, date: true };

  it("keeps everything when the subject still has room", () => {
    expect(fitColumns(all, 1400, 80)).toEqual(all);
  });

  it("drops author, then hash, then date before touching labels", () => {
    // 150 + 80 + 24 + 8 = 262 fixed; each step frees one track.
    expect(fitColumns(all, 262 + 220 + 92 + 72, 80)).toEqual({ ...all, author: false });
    expect(fitColumns(all, 262 + 220 + 92, 80)).toEqual({ ...all, author: false, hash: false });
    expect(fitColumns(all, 262 + 220, 80)).toEqual({ refs: true, author: false, hash: false, date: false });
  });

  it("drops labels only as a last resort", () => {
    expect(fitColumns(all, 300, 80).refs).toBe(false);
  });

  // The regression: a 660px pane used to render every subject 0px wide.
  it("always leaves the subject a readable width in a typical history pane", () => {
    const fitted = fitColumns(all, 660, 104);
    const used =
      104 + 24 + 8 +
      (fitted.refs ? 150 : 0) + (fitted.author ? 140 : 0) + (fitted.date ? 92 : 0) + (fitted.hash ? 72 : 0);
    expect(660 - used).toBeGreaterThanOrEqual(220);
  });
});

describe("pickSwitchTarget", () => {
  const locals = new Set(["main", "feat/a"]);

  it("switches to the first local branch you are not on", () => {
    const labels = groupRefLabels(["main", "feat/a", "origin/feat/a"], "main");
    expect(pickSwitchTarget(labels, locals)).toEqual({ kind: "local", branch: "feat/a" });
  });

  it("does nothing on the checked-out branch or a bare commit", () => {
    expect(pickSwitchTarget(groupRefLabels(["main", "origin/main"], "main"), locals)).toBeNull();
    expect(pickSwitchTarget(groupRefLabels([], null), locals)).toBeNull();
    expect(pickSwitchTarget(groupRefLabels(["tag:v1"], null), locals)).toBeNull();
  });

  it("creates a tracking branch for a remote-only branch", () => {
    const labels = groupRefLabels(["origin/feat/b"], null);
    expect(pickSwitchTarget(labels, locals)).toEqual({
      kind: "remote",
      remoteRef: "origin/feat/b",
      localName: "feat/b",
    });
  });

  // `upstream/main` when `main` already exists locally: switching must not try
  // to create a second `main`.
  it("uses the existing local branch for a remote whose name is already local", () => {
    const labels = groupRefLabels(["upstream/main"], null, ["origin", "upstream"]);
    expect(pickSwitchTarget(labels, locals)).toEqual({ kind: "local", branch: "main" });
  });
});

describe("groupRefLabels", () => {
  it("folds a local branch and its origin copy into one label", () => {
    expect(groupRefLabels(["main", "origin/main"], "main")).toEqual([
      {
        label: "main",
        kind: "branch",
        local: true,
        remote: true,
        head: true,
        localName: "main",
        remoteRef: "origin/main",
        remoteName: "origin",
        title: "main — checked out · origin/main",
      },
    ]);
  });

  it("keeps remote-only branches marked remote, with no drop target", () => {
    const [label] = groupRefLabels(["origin/feat/x"], null);
    expect(label).toMatchObject({ label: "feat/x", local: false, remote: true, localName: null });
  });

  it("keeps a non-origin remote prefixed and remote, never folded into the local label", () => {
    const labels = groupRefLabels(["main", "origin/main", "upstream/main"], "main", ["origin", "upstream"]);
    expect(labels.map((l) => [l.label, l.local, l.remote])).toEqual([
      ["main", true, true],
      ["upstream/main", false, true],
    ]);
  });

  it("drops */HEAD aliases and orders head, local, remote, then tags", () => {
    const labels = groupRefLabels(["tag:v1", "origin/HEAD", "origin/other", "wip", "main"], "main");
    expect(labels.map((l) => l.label)).toEqual(["main", "wip", "other", "v1"]);
    expect(labels.at(-1)?.kind).toBe("tag");
  });
});
