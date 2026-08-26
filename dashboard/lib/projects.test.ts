import { describe, expect, it } from "vitest";
import { normaliseProjects } from "./projects";

describe("normaliseProjects", () => {
  it("keeps entries with repos and slugifies the label into an id", () => {
    expect(normaliseProjects([{ label: "Job Agent!", repos: ["acme-api", "demo-app"] }])).toEqual([
      { id: "job-agent", label: "Job Agent!", repos: ["acme-api", "demo-app"] },
    ]);
  });

  it("falls back to the first repo when there is no label", () => {
    expect(normaliseProjects([{ repos: ["acme-api"] }])).toEqual([
      { id: "acme-api", label: "acme-api", repos: ["acme-api"] },
    ]);
  });

  it("drops entries without any usable repo", () => {
    expect(
      normaliseProjects([{ label: "empty" }, { label: "blank repos", repos: ["  ", 3] }, null, "nope"]),
    ).toEqual([]);
  });

  it("trims and dedupes repo names", () => {
    expect(normaliseProjects([{ label: "x", repos: [" acme-api ", "acme-api"] }])).toEqual([
      { id: "x", label: "x", repos: ["acme-api"] },
    ]);
  });

  it("rejects non-array input and keeps ids unique", () => {
    expect(normaliseProjects({ label: "not an array" })).toEqual([]);
    const twice = normaliseProjects([
      { label: "same", repos: ["a"] },
      { label: "same", repos: ["b"] },
    ]);
    expect(twice.map((p) => p.id)).toEqual(["same", "same-2"]);
  });

  it("keeps a provided id so writes do not reshuffle tabs", () => {
    expect(normaliseProjects([{ id: "acme-api", label: "Acme", repos: ["acme-api"] }])).toEqual([
      { id: "acme-api", label: "Acme", repos: ["acme-api"] },
    ]);
  });
});
