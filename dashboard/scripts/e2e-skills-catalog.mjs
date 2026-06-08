#!/usr/bin/env node
/**
 * Smoke test: Skills page + catalog API (requires dashboard on BASE_URL).
 *
 *   BASE_URL=http://127.0.0.1:1337 node scripts/e2e-skills-catalog.mjs
 */
import { chromium } from "playwright";

const baseUrl = (process.env.BASE_URL ?? "http://127.0.0.1:1337").replace(/\/$/, "");

async function assertApi() {
  const r = await fetch(`${baseUrl}/api/skills`);
  if (!r.ok) throw new Error(`/api/skills returned ${r.status}`);
  const data = await r.json();
  if (!Array.isArray(data.skills)) throw new Error("Expected skills array in response");
  if (!data.aiTools || typeof data.aiTools.available !== "boolean") {
    throw new Error("Expected aiTools meta in response");
  }
  console.log(`API ok: ${data.skills.length} skills, ai-tools available=${data.aiTools.available}`);
}

async function assertUi() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(`${baseUrl}/skills`, { waitUntil: "networkidle", timeout: 60_000 });
    await page.getByRole("group", { name: "Filter skills by source" }).waitFor({ timeout: 15_000 });
    await page.getByRole("button", { name: /^All \(\d+\)$/ }).waitFor();
    await page.getByRole("button", { name: "Refresh" }).waitFor();
    const title = await page.locator(".page-title").textContent();
    if (!title?.includes("Agents")) throw new Error(`Unexpected page title: ${title}`);
    console.log("UI ok: Skills tab filters and Refresh visible");
  } finally {
    await browser.close();
  }
}

try {
  await assertApi();
  await assertUi();
  console.log("e2e-skills-catalog: PASS");
} catch (e) {
  console.error("e2e-skills-catalog: FAIL", e);
  process.exit(1);
}
