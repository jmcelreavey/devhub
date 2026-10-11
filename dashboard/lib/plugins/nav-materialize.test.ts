import { describe, expect, it } from "vitest";
import { collectPluginNav } from "./nav-materialize";
import type { RegisteredPlugin } from "./types";

function mkPlugin(nav: RegisteredPlugin["manifest"]["dashboard"]): RegisteredPlugin {
  return {
    name: "infra",
    path: "/tmp/team-tools",
    enabled: true,
    manifest: {
      name: "infra",
      version: "0.1.0",
      devhubApi: "1",
      navGate: "infra",
      contributes: {},
      dashboard: nav,
    },
  };
}

describe("collectPluginNav", () => {
  it("inherits plugin navGate when item gate omitted", () => {
    const { items, errors } = collectPluginNav([
      mkPlugin({
        root: "dashboard",
        paths: ["app/ops"],
        nav: [
          {
            href: "/ops",
            label: "Ops",
            icon: "ops",
            group: "infra",
          },
        ],
      }),
    ]);
    expect(errors).toEqual([]);
    expect(items).toEqual([
      {
        href: "/ops",
        label: "Ops",
        icon: "ops",
        group: "infra",
        gate: "infra",
      },
    ]);
  });

  it("rejects duplicate hrefs across plugins", () => {
    const a = mkPlugin({
      root: "dashboard",
      paths: ["app/ops"],
      nav: [{ href: "/ops", label: "Ops", icon: "ops", group: "infra" }],
    });
    const b: RegisteredPlugin = {
      ...a,
      name: "other",
      manifest: {
        ...a.manifest,
        name: "other",
        dashboard: {
          root: "dashboard",
          paths: ["app/other"],
          nav: [{ href: "/ops", label: "Other", icon: "ops", group: "infra" }],
        },
      },
    };
    const { items, errors } = collectPluginNav([a, b]);
    expect(items).toHaveLength(1);
    expect(errors.some((e) => e.includes("already claimed"))).toBe(true);
  });
});
