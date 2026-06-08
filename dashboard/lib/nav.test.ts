import { describe, expect, it } from "vitest";
import { NAV_ITEMS, filterNavBySetup } from "./nav";

const hrefs = (items: ReturnType<typeof filterNavBySetup>) => items.map((i) => i.href);

describe("filterNavBySetup", () => {
  it("hides all gated items when setup status is unknown", () => {
    const visible = hrefs(filterNavBySetup(NAV_ITEMS, null));
    expect(visible).not.toContain("/ops");
    expect(visible).not.toContain("/datadog");
    expect(visible).toContain("/"); // ungated items still show
    expect(visible).toContain("/notes");
  });

  it("hides Ops when BI is not configured", () => {
    const visible = hrefs(filterNavBySetup(NAV_ITEMS, { bi: false }));
    expect(visible).not.toContain("/ops");
  });

  it("shows Ops only when BI is configured", () => {
    expect(hrefs(filterNavBySetup(NAV_ITEMS, { bi: true }))).toContain("/ops");
    expect(hrefs(filterNavBySetup(NAV_ITEMS, {}))).not.toContain("/ops");
  });

  it("gates other integrations independently of Ops", () => {
    const visible = hrefs(filterNavBySetup(NAV_ITEMS, { datadog: true, bi: false }));
    expect(visible).toContain("/datadog");
    expect(visible).not.toContain("/ops");
  });

  it("hides Datadog when API credentials are not configured", () => {
    expect(hrefs(filterNavBySetup(NAV_ITEMS, { datadog: false }))).not.toContain("/datadog");
    expect(hrefs(filterNavBySetup(NAV_ITEMS, {}))).not.toContain("/datadog");
  });

  it("hides Chamber and OpenCode when peer services are unavailable", () => {
    const hidden = hrefs(filterNavBySetup(NAV_ITEMS, { chamber: false, opencode: false }));
    expect(hidden).not.toContain("/chamber");
    expect(hidden).not.toContain("/opencode");
  });

  it("shows Chamber and OpenCode only when gated on", () => {
    expect(hrefs(filterNavBySetup(NAV_ITEMS, { chamber: true }))).toContain("/chamber");
    expect(hrefs(filterNavBySetup(NAV_ITEMS, { opencode: true }))).toContain("/opencode");
  });
});
