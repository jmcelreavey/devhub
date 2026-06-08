import { describe, it, expect } from "vitest";
import {
  entryDisplayChecked,
  entryIsBrokenLink,
  entryLabelDrift,
  findMasterItemByName,
  masterSummary,
} from "./resolution";
import type { MasterList, SharedChecklistEntry } from "./types";

const master: MasterList = {
  schemaVersion: 2,
  id: "m1",
  name: "Garden",
  scopePath: "garden",
  items: [
    {
      id: "i1",
      name: "Spade",
      checked: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("checklist resolution", () => {
  it("finds master items by name case-insensitively", () => {
    expect(findMasterItemByName(master, "  spade ")).toMatchObject({ id: "i1" });
  });

  it("uses master checked state for linked entries", () => {
    const entry: SharedChecklistEntry = { id: "e1", label: "Spade", masterItemId: "i1" };
    expect(entryDisplayChecked(entry, master)).toBe(true);
    const unchecked: MasterList = {
      ...master,
      items: [{ ...master.items[0], checked: false }],
    };
    expect(entryDisplayChecked(entry, unchecked)).toBe(false);
  });

  it("uses standaloneChecked for unlinked entries", () => {
    const entry: SharedChecklistEntry = {
      id: "e2",
      label: "Fix fence",
      standaloneChecked: true,
    };
    expect(entryDisplayChecked(entry, master)).toBe(true);
  });

  it("detects broken master links", () => {
    const entry: SharedChecklistEntry = { id: "e3", label: "Gone", masterItemId: "missing" };
    expect(entryIsBrokenLink(entry, master)).toBe(true);
  });

  it("detects label drift for linked entries", () => {
    const entry: SharedChecklistEntry = {
      id: "e4",
      label: "Replacement pickets (24)",
      masterItemId: "i1",
    };
    expect(entryLabelDrift(entry, master)).toBe(true);
    expect(entryLabelDrift({ ...entry, label: "Spade" }, master)).toBe(false);
  });

  it("summarizes master progress", () => {
    expect(masterSummary(master)).toBe("1 of 1 checked");
  });
});
