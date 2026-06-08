import { describe, expect, it } from "vitest";
import {
  buildEventStreamTodayUrl,
  buildManageMonitorsUrl,
  datadogApiHost,
  datadogErrorMessage,
  datadogAppOrigin,
  DATADOG_MONITOR_QUERY_ONCALL,
  resolveDatadogDeepLinks,
} from "./datadog-links";

describe("datadogApiHost", () => {
  it("maps API hosts for common sites", () => {
    expect(datadogApiHost("datadoghq.com")).toBe("api.datadoghq.com");
    expect(datadogApiHost("datadoghq.eu")).toBe("api.datadoghq.eu");
    expect(datadogApiHost("us3.datadoghq.com")).toBe("api.us3.datadoghq.com");
  });
});

describe("datadogAppOrigin", () => {
  it("maps default US1 site", () => {
    expect(datadogAppOrigin("datadoghq.com")).toBe("https://app.datadoghq.com");
    expect(datadogAppOrigin("")).toBe("https://app.datadoghq.com");
  });

  it("maps EU and regional hosts", () => {
    expect(datadogAppOrigin("datadoghq.eu")).toBe("https://app.datadoghq.eu");
    expect(datadogAppOrigin("us3.datadoghq.com")).toBe("https://us3.datadoghq.com");
    expect(datadogAppOrigin("ddog-gov.com")).toBe("https://app.ddog-gov.com");
  });
});

describe("buildManageMonitorsUrl", () => {
  it("encodes query param", () => {
    const u = buildManageMonitorsUrl("https://app.datadoghq.com", DATADOG_MONITOR_QUERY_ONCALL);
    expect(u).toContain("/monitors/manage?");
    expect(u).toContain("q=");
    expect(decodeURIComponent(new URL(u).searchParams.get("q") ?? "")).toBe(DATADOG_MONITOR_QUERY_ONCALL);
  });
});

describe("buildEventStreamTodayUrl", () => {
  it("includes from_ts and to_ts", () => {
    const u = buildEventStreamTodayUrl("https://app.datadoghq.com", 1_700_000_000_000, 1_700_008_640_000);
    const parsed = new URL(u);
    expect(parsed.pathname).toBe("/event/stream");
    expect(parsed.searchParams.get("from_ts")).toBe("1700000000000");
    expect(parsed.searchParams.get("to_ts")).toBe("1700008640000");
    expect(parsed.searchParams.get("live")).toBe("false");
  });
});

describe("resolveDatadogDeepLinks", () => {
  it("honors full URL overrides", () => {
    const r = resolveDatadogDeepLinks({
      ddSite: "datadoghq.com",
      linkOncall: "https://example.com/oncall",
      linkTeamAlerts: "https://example.com/team",
      linkEventsToday: "https://example.com/events",
    });
    expect(r.oncallUrl).toBe("https://example.com/oncall");
    expect(r.teamAlertsUrl).toBe("https://example.com/team");
    expect(r.eventsTodayUrl).toBe("https://example.com/events");
  });

  it("uses app origin override without trailing slash", () => {
    const r = resolveDatadogDeepLinks({
      ddSite: "datadoghq.com",
      appOriginOverride: "https://us3.datadoghq.com/",
    });
    expect(r.appOrigin).toBe("https://us3.datadoghq.com");
    expect(r.oncallUrl.startsWith("https://us3.datadoghq.com/monitors/manage")).toBe(true);
  });
});

describe("datadogErrorMessage", () => {
  it("formats v2 object errors (title: detail)", () => {
    const body = { errors: [{ title: "Generic Error", detail: "invalid include: users" }] };
    expect(datadogErrorMessage(body, "fallback")).toBe("Generic Error: invalid include: users");
  });
  it("handles string errors and joins multiple", () => {
    expect(datadogErrorMessage({ errors: ["a", "b"] }, "fb")).toBe("a; b");
  });
  it("falls back when no usable errors", () => {
    expect(datadogErrorMessage({}, "403 Forbidden")).toBe("403 Forbidden");
    expect(datadogErrorMessage(null, "500")).toBe("500");
    expect(datadogErrorMessage({ errors: [] }, "fb")).toBe("fb");
  });
});
