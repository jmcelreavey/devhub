#!/usr/bin/env node
/**
 * UX walkthrough for Skills + ai-tools integration.
 * Screenshots → dashboard/.ux-review/skills-ux/
 *
 *   BASE_URL=http://127.0.0.1:1337 node scripts/e2e-skills-ux-walkthrough.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const baseUrl = (process.env.BASE_URL ?? "http://127.0.0.1:1337").replace(/\/$/, "");
const outDir = path.join(__dirname, "..", ".ux-review", "skills-ux");
const findings = [];

function note(severity, message) {
  findings.push({ severity, message });
  console.log(`[${severity}] ${message}`);
}

function isBenignConsoleError(text) {
  return /webpack-hmr|ERR_INVALID_HTTP_RESPONSE/i.test(text);
}

async function shot(page, name) {
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on("pageerror", (err) => note("error", `Page error: ${err.message}`));
page.on("console", (msg) => {
  if (msg.type() === "error" && !isBenignConsoleError(msg.text())) {
    note("error", `Console: ${msg.text()}`);
  }
});

const skillRows = () => page.locator('[data-testid="skills-catalog-list"] [data-testid="skill-row"]');

try {
  await page.goto(`${baseUrl}/skills`, { waitUntil: "networkidle", timeout: 90_000 });

  const filterGroup = page.getByRole("group", { name: "Filter skills by source" });
  await filterGroup.waitFor({ timeout: 30_000 });

  const allBtn = page.getByRole("button", { name: /^All \(/ });
  const deadline = Date.now() + 60_000;
  let allCount = 0;
  while (Date.now() < deadline) {
    const t = await allBtn.textContent();
    const m = t?.match(/\((\d+)\)/);
    if (m) {
      allCount = Number(m[1]);
      if (allCount > 0) break;
    }
    await page.waitForTimeout(250);
  }
  if (allCount === 0) throw new Error("Skills never loaded (All count stayed 0)");
  await shot(page, "01-loaded");
  const devhubBtn = page.getByRole("button", { name: /^DevHub \(/ });
  const aiToolsBtn = page.getByRole("button", { name: /^ai-tools \(/ });

  const allLabel = await allBtn.textContent();
  const devhubLabel = await devhubBtn.textContent();
  const aiToolsLabel = await aiToolsBtn.textContent();

  const parseCount = (label) => {
    const m = label?.match(/\((\d+)\)/);
    return m ? Number(m[1]) : 0;
  };
  const totalAll = parseCount(allLabel);
  const devhubCount = parseCount(devhubLabel);
  const aiToolsCount = parseCount(aiToolsLabel);

  if (totalAll !== devhubCount + aiToolsCount) {
    note("warn", `Filter counts mismatch: All=${totalAll}, DevHub=${devhubCount}, ai-tools=${aiToolsCount}`);
  } else {
    note("ok", `Filter counts consistent (${totalAll} total)`);
  }

  // ai-tools filter
  await aiToolsBtn.click();
  await page.waitForTimeout(300);
  await shot(page, "02-filter-ai-tools");

  const aiToolsRows = skillRows().filter({ has: page.getByText("ai-tools", { exact: true }) });
  const aiToolsVisible = await aiToolsRows.count();
  if (aiToolsVisible === 0 && aiToolsCount > 0) {
    note("error", "ai-tools filter active but no ai-tools badges visible in list");
  } else if (aiToolsVisible > 0) {
    note("ok", `ai-tools filter shows ${aiToolsVisible} row(s) with badge`);
  }

  // Expand first ai-tools skill if any
  if (aiToolsCount > 0) {
    const firstRow = aiToolsRows.first();
    await firstRow.getByRole("button", { name: "Expand" }).click();
    await page.getByText("Read-only (edit in ai-tools repo)").waitFor({ state: "visible", timeout: 10_000 });
    await shot(page, "03-ai-tools-expanded");

    const readOnly = page.getByText("Read-only (edit in ai-tools repo)");
    if (!(await readOnly.isVisible())) {
      note("error", "Expanded ai-tools skill missing read-only hint");
    } else {
      note("ok", "ai-tools skill shows read-only hint");
    }

    const editBtn = firstRow.getByRole("button", { name: "Edit" });
    if (await editBtn.count()) {
      note("error", "Edit button visible on read-only ai-tools skill");
    } else {
      note("ok", "No Edit on ai-tools skill row");
    }

    const deleteBtn = firstRow.getByRole("button", { name: /Delete/ });
    if (await deleteBtn.count()) {
      note("error", "Delete visible on read-only ai-tools skill");
    } else {
      note("ok", "No Delete on read-only ai-tools skill");
    }
  }

  // DevHub filter + expand
  await devhubBtn.click();
  await page.waitForTimeout(300);
  await shot(page, "04-filter-devhub");

  const devhubRows = skillRows().filter({ has: page.getByText("DevHub", { exact: true }) });
  if (devhubCount > 0) {
    const devhubRow = devhubRows.first();
    await devhubRow.getByRole("button", { name: "Expand" }).click();
    await page.waitForTimeout(500);
    await shot(page, "05-devhub-expanded");
    const editVisible = await devhubRow.getByRole("button", { name: "Edit" }).isVisible();
    if (!editVisible) note("warn", "DevHub skill expand: Edit not immediately visible (may need scroll)");
    else note("ok", "DevHub skill shows Edit when expanded");
  }

  // Text search
  await allBtn.click();
  const search = page.getByPlaceholder("Filter skills...");
  await search.fill("mongo");
  await page.waitForTimeout(300);
  await shot(page, "06-search-mongo");
  const rowsAfterSearch = await skillRows().count();
  if (rowsAfterSearch === 0) note("info", "Search 'mongo' returned no rows (may be fine if skill absent)");
  else note("ok", `Search narrowed list (${rowsAfterSearch} skill rows visible)`);
  await search.fill("");

  // Exclude toggle on first visible skill
  await allBtn.click();
  const firstSkillRow = skillRows().first();
  const excludeToggle = firstSkillRow.getByRole("button", { name: /Include .* in sync|Exclude .* from sync/ });
  if (await excludeToggle.count()) {
    await excludeToggle.click();
    await page.waitForTimeout(200);
    await shot(page, "07-excluded-skill");
    const pressed = await excludeToggle.getAttribute("aria-pressed");
    if (pressed !== "true") note("error", "Eye exclude toggle did not set aria-pressed=true");
    else note("ok", "Exclude toggle updates aria-pressed");
    await excludeToggle.click(); // restore
  } else {
    note("warn", "Could not find exclude eye button on first skill card");
  }

  // Upstream banner
  const upstreamLine = page.locator("text=Upstream:").first();
  if (await upstreamLine.isVisible()) {
    note("ok", "Upstream path banner visible");
  } else {
    const disabledMsg = page.getByText(/ai-tools not found|upstream disabled/i);
    if (await disabledMsg.first().isVisible().catch(() => false)) {
      note("info", "Upstream banner shows missing/disabled state");
    } else {
      note("warn", "No upstream status line visible");
    }
  }

  // Sync preview card
  const previewRefresh = page.getByRole("button", { name: /^Refresh$/ });
  if (await previewRefresh.count()) {
    note("ok", "Sync preview card present");
    await shot(page, "08-sync-preview");
  } else {
    note("info", "Sync preview refresh button not found by name");
  }

  // Layout: filter bar vs search row (same flex row; warn if filters wrapped below search)
  const filterBox = await filterGroup.boundingBox();
  const searchBox = await search.boundingBox();
  if (filterBox && searchBox && filterBox.y > searchBox.y + 8) {
    note("warn", "Source filter bar appears below search row — consider moving filters next to search for scanability");
  } else {
    note("ok", "Filter bar placement relative to search is reasonable");
  }

  // Refresh button (do not click — avoids git side effects in audit)
  const refreshBtn = page.getByRole("button", { name: "Refresh" });
  if (await refreshBtn.isVisible()) {
    const title = await refreshBtn.getAttribute("title");
    if (!title?.toLowerCase().includes("ai-tools")) note("warn", "Refresh missing ai-tools tooltip");
    else note("ok", "Refresh has descriptive tooltip");
  }

  await shot(page, "09-final");

  const errors = findings.filter((f) => f.severity === "error");
  const warns = findings.filter((f) => f.severity === "warn");

  console.log("\n--- Summary ---");
  console.log(`Screenshots: ${outDir}`);
  console.log(`Errors: ${errors.length}, Warnings: ${warns.length}`);

  if (errors.length) process.exit(1);
} finally {
  await browser.close();
}
