import { describe, it, expect } from "vitest";
import {
  DEPENDENCIES,
  firstVersionLine,
  probeDependency,
  summariseDependencies,
  type DependencyStatus,
  type DependencySpec,
} from "@/lib/setup/dependencies";

const status = (over: Partial<DependencyStatus>): DependencyStatus => ({
  id: "git",
  label: "Git",
  required: false,
  unlocks: "",
  present: true,
  version: null,
  ...over,
});

describe("firstVersionLine", () => {
  it("returns the first non-empty line", () => {
    expect(firstVersionLine("git version 2.39.0\n")).toBe("git version 2.39.0");
  });

  it("skips leading blank lines", () => {
    expect(firstVersionLine("\n\n  docker version 24  \n")).toBe("docker version 24");
  });

  it("returns null for empty output", () => {
    expect(firstVersionLine("")).toBeNull();
    expect(firstVersionLine("\n  \n")).toBeNull();
  });

  it("truncates a very long line so it can't blow up the UI", () => {
    expect(firstVersionLine("x".repeat(500))!.length).toBe(120);
  });
});

describe("probeDependency", () => {
  it("detects a tool that exists", () => {
    // node is running this test, so it is definitionally present.
    const spec = DEPENDENCIES.find((d) => d.id === "node")!;
    const result = probeDependency(spec);
    expect(result.present).toBe(true);
    expect(result.version).toMatch(/^v?\d+\./);
  });

  it("reports a missing tool as absent rather than throwing", () => {
    const spec: DependencySpec = {
      id: "git",
      label: "Nope",
      required: false,
      unlocks: "",
      bin: "devhub-definitely-not-a-real-binary",
      versionArgs: ["--version"],
    };
    const result = probeDependency(spec);
    expect(result.present).toBe(false);
    expect(result.version).toBeNull();
  });

  it("carries the install hints through to the result", () => {
    const spec = DEPENDENCIES.find((d) => d.id === "gh")!;
    expect(probeDependency(spec).installCommand).toBe("brew install gh");
  });

  it("treats a non-zero exit as absent", () => {
    // `node --definitely-not-a-flag` exits non-zero; the tool exists but can't
    // be used the way we need, which for onboarding purposes is the same thing.
    const spec: DependencySpec = {
      id: "node",
      label: "Node",
      required: true,
      unlocks: "",
      bin: "node",
      versionArgs: ["--definitely-not-a-flag"],
    };
    expect(probeDependency(spec).present).toBe(false);
  });
});

describe("summariseDependencies", () => {
  it("is ready when every required tool is present", () => {
    const r = summariseDependencies([
      status({ required: true, present: true }),
      status({ required: false, present: false }),
    ]);
    expect(r.ready).toBe(true);
    expect(r.missingRequired).toEqual([]);
  });

  it("is not ready when a required tool is missing", () => {
    const r = summariseDependencies([status({ required: true, present: false, label: "Git" })]);
    expect(r.ready).toBe(false);
    expect(r.missingRequired).toEqual(["Git"]);
  });

  it("does not let a missing optional tool block readiness", () => {
    // The whole point of the required/optional split: a machine without Docker
    // is a perfectly usable DevHub install.
    const r = summariseDependencies([
      status({ required: true, present: true }),
      status({ required: false, present: false, label: "Docker" }),
      status({ required: false, present: false, label: "AWS CLI" }),
    ]);
    expect(r.ready).toBe(true);
    expect(r.availableCount).toBe(1);
    expect(r.totalCount).toBe(3);
  });

  it("counts availability for the '3 of 8 available' line", () => {
    const r = summariseDependencies([
      status({ present: true }),
      status({ present: true }),
      status({ present: false }),
    ]);
    expect(r.availableCount).toBe(2);
    expect(r.totalCount).toBe(3);
  });
});

describe("the dependency catalogue", () => {
  it("has unique ids", () => {
    const ids = DEPENDENCIES.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps the required set small", () => {
    // Every tool marked required is a hard gate on using the app at all. If
    // this list grows, onboarding gets worse - so the test makes growth
    // deliberate rather than incidental.
    expect(DEPENDENCIES.filter((d) => d.required).map((d) => d.id).sort()).toEqual(["git", "node"]);
  });

  it("gives every tool a plain-language reason to exist", () => {
    for (const d of DEPENDENCIES) {
      expect(d.unlocks.length, `${d.id} has no 'unlocks' text`).toBeGreaterThan(10);
    }
  });

  it("gives every optional tool a way to install it", () => {
    for (const d of DEPENDENCIES.filter((x) => !x.required)) {
      expect(
        Boolean(d.installCommand || d.installUrl),
        `${d.id} has no install hint`,
      ).toBe(true);
    }
  });
});
