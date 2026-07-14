import { describe, expect, it } from "vitest";
import { collectPluginNav } from "./nav-materialize";
import type { RegisteredPlugin } from "./types";

function mkPlugin(nav: RegisteredPlugin["manifest"]["dashboard"]): RegisteredPlugin {
  return {
    name: "bi",
    path: "/tmp/bi",
    enabled: true,
    manifest: {
      name: "bi",
      version: "0.1.0",
      devhubApi: "1",
      navGate: "bi",
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
            group: "system",
            section: "system",
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
        group: "system",
        section: "system",
        gate: "bi",
      },
    ]);
  });

  it("rejects duplicate hrefs across plugins", () => {
    const a = mkPlugin({
      root: "dashboard",
      paths: ["app/ops"],
      nav: [{ href: "/ops", label: "Ops", icon: "ops", group: "system" }],
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
          nav: [{ href: "/ops", label: "Other", icon: "ops", group: "system" }],
        },
      },
    };
    const { items, errors } = collectPluginNav([a, b]);
    expect(items).toHaveLength(1);
    expect(errors.some((e) => e.includes("already claimed"))).toBe(true);
  });
});
