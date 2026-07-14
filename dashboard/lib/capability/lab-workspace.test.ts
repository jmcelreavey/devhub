import { describe, expect, it } from "vitest";
import { servicesForSignal, stepsFromMarkdown } from "./lab-workspace";

describe("servicesForSignal", () => {
  it("maps data signals to the right local services", () => {
    expect(servicesForSignal("mongodb-atlas", "MongoDB Atlas").map((s) => s.name)).toEqual(["mongo"]);
    expect(servicesForSignal("postgres", "Postgres").map((s) => s.name)).toEqual(["postgres"]);
    expect(servicesForSignal("kafka", "Kafka").map((s) => s.name)).toEqual(["kafka"]);
  });

  it("returns no services for signals that don't need one", () => {
    expect(servicesForSignal("terraform", "Terraform")).toEqual([]);
    expect(servicesForSignal("github-actions", "GitHub Actions")).toEqual([]);
  });
});

describe("stepsFromMarkdown", () => {
  it("extracts a checklist from the lab's section headings", () => {
    const md = ["# Title", "## 1. Orient", "text", "## 2. Read the change", "## 3. Sandbox"].join("\n");
    expect(stepsFromMarkdown(md)).toEqual(["1. Orient", "2. Read the change", "3. Sandbox"]);
  });
});
