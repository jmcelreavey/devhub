import { describe, it, expect } from "vitest";
import { managedCatalogListLoading } from "./managed-catalog-loading";

const idle = {
  loadingSkills: false,
  loadingAgents: false,
  loadingLocal: false,
  refreshingSkills: false,
};

describe("managedCatalogListLoading", () => {
  it("skills: busy when skills, local scan, or refresh", () => {
    expect(managedCatalogListLoading("skill", { ...idle, loadingSkills: true })).toBe(true);
    expect(managedCatalogListLoading("skill", { ...idle, loadingLocal: true })).toBe(true);
    expect(managedCatalogListLoading("skill", { ...idle, refreshingSkills: true })).toBe(true);
    expect(managedCatalogListLoading("skill", idle)).toBe(false);
  });

  it("agents: busy when agents or local scan (not skills loading)", () => {
    expect(managedCatalogListLoading("agent", { ...idle, loadingAgents: true })).toBe(true);
    expect(managedCatalogListLoading("agent", { ...idle, loadingLocal: true })).toBe(true);
    expect(managedCatalogListLoading("agent", { ...idle, loadingSkills: true })).toBe(false);
    expect(managedCatalogListLoading("agent", idle)).toBe(false);
  });
});
