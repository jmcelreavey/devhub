import { test, expect, type Page } from "@playwright/test";

/**
 * Engine-risk journeys — the surfaces that can differ between Chromium and
 * WebKit badly enough to kill the Tauri migration.
 *
 * `smoke.spec.ts` proves routes render. That is not the question here. The
 * question is whether the *hard* parts of this dashboard survive an engine
 * that isn't Blink, because Tauri renders in the OS webview: WKWebView on
 * macOS, WebKitGTK on Linux. A dashboard that only works in Chromium is a
 * desktop app that only works in development.
 *
 * These run on both projects deliberately. A WebKit-only failure is
 * interesting; a failure on both is a plain bug and should read as one.
 *
 * What is deliberately NOT asserted: pixel output. Font rendering and
 * antialiasing legitimately differ per engine and screenshotting them
 * produces a test that fails for reasons nobody should have to care about.
 * Every assertion below is behavioural — did the thing accept input, did the
 * element get real geometry, did the API respond.
 */

/** Contenteditable/canvas widgets need hydration; `domcontentloaded` is too early. */
async function hydrated(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: /search everything/i })).toBeEnabled({
    timeout: 30_000,
  });
  await page.waitForFunction(() => document.readyState === "complete");
}

/**
 * Open the first real note from the tree API, or report that there is none.
 *
 * The index pages themselves mount no editor and no canvas, so a test that
 * only visits `/notes` skips every time and quietly reports success. These are
 * the two Phase 0 *stop conditions* — a permanently skipped stop-condition test
 * is worse than no test, because it looks like evidence.
 *
 * Area links now share the `/notes/*` prefix, so choosing the first anchor can
 * land on another index. The tree API identifies a real file directly.
 */
interface TreeNode {
  type: "dir" | "file";
  name: string;
  path: string;
  children?: TreeNode[];
}

async function preventVaultWrites(page: Page): Promise<void> {
  await page.route("**/api/notes/**", async (route) => {
    if (["POST", "PUT", "DELETE"].includes(route.request().method())) {
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      return;
    }
    await route.continue();
  });
}

async function openFirstNote(page: Page): Promise<boolean> {
  const response = await page.request.get("/api/tree").catch(() => null);
  if (!response?.ok()) return false;

  const roots = (await response.json()) as TreeNode[];
  const firstFile = (nodes: TreeNode[]): string | null => {
    for (const node of nodes) {
      if (node.type === "dir" && node.name === "diagrams") continue;
      if (node.type === "file" && node.name.endsWith(".json")) return node.path;
      const nested = node.children ? firstFile(node.children) : null;
      if (nested) return nested;
    }
    return null;
  };

  const found = firstFile(Array.isArray(roots) ? roots : []);
  if (!found) return false;
  const path = found
    .replace(/\.json$/, "")
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  await page.goto(`/notes/${path}`);
  await hydrated(page);
  return true;
}

/**
 * Open a diagram, found through the tree API rather than by clicking.
 *
 * The diagrams index navigates with `router.push`, so the only anchors are
 * folders — following the first one lands on another listing, not a canvas.
 * Clicking whatever looks clickable is not an option either: the same screen
 * has "New folder" and "New diagram" buttons, and a test that creates files
 * in the user's vault to check a canvas renders is a bad trade.
 *
 * So the path comes from the API and the navigation is direct.
 *
 * `/api/tree` takes no parameters and always returns the *notes* vault; the
 * diagrams index fetches exactly that and filters to the `diagrams/` subtree.
 * This used to request `/api/tree?vault=diagrams`, which looked scoped and was
 * not — the ignored query string left it picking the first `.json` anywhere in
 * notes, which is typically an archived attachment, not a diagram. The editor
 * then looked for `diagrams/<that path>`, got a 404, rendered its not-found
 * state, and the test failed on "tldraw should mount a canvas" while tldraw was
 * in fact fine. Descending into the real subtree is the fix.
 */
async function openFirstDiagram(page: Page): Promise<boolean> {
  const response = await page.request.get("/api/tree").catch(() => null);
  if (!response?.ok()) return false;

  const tree = (await response.json()) as TreeNode[];
  const roots = Array.isArray(tree) ? tree : [];
  const diagrams = roots.find((node) => node.type === "dir" && node.name === "diagrams");
  if (!diagrams?.children) return false;

  const firstFile = (nodes: TreeNode[]): string | null => {
    for (const node of nodes) {
      if (node.type === "file" && node.name.endsWith(".json")) return node.path;
      const nested = node.children ? firstFile(node.children) : null;
      if (nested) return nested;
    }
    return null;
  };

  const found = firstFile(diagrams.children);
  if (!found) return false;

  // `diagrams/Folder/Name.json` → `/diagrams/Folder/Name`, each segment encoded
  // (real diagram names contain spaces and `&`).
  const segments = found
    .replace(/^diagrams\//, "")
    .replace(/\.json$/, "")
    .split("/")
    .map(encodeURIComponent);
  await page.goto(`/diagrams/${segments.join("/")}`);
  await hydrated(page);
  return true;
}

test.describe("editor (BlockNote / ProseMirror)", () => {
  test("accepts typed input in a contenteditable", async ({ page }) => {
    /**
     * ProseMirror leans on `beforeinput`, composition events, and Selection
     * APIs whose WebKit behaviour has historically diverged from Blink. If
     * typing does not land, notes are unusable in the shipped app — that is a
     * Phase 0 stop condition, so it gets a real keystroke rather than a
     * `.fill()` (which bypasses the input pipeline entirely and would pass on
     * a completely broken editor).
     */
    await preventVaultWrites(page);
    const opened = await openFirstNote(page);
    test.skip(!opened, "no notes exist in this environment");

    const editable = page.locator("[contenteditable='true']").first();
    await expect(editable, "BlockNote should mount an editable surface").toBeVisible({
      timeout: 25_000,
    });

    await editable.click();
    const marker = `wk-${Date.now()}`;
    await page.keyboard.type(marker, { delay: 15 });

    await expect(editable).toContainText(marker, { timeout: 10_000 });

    // Selection APIs are the other half of the risk — a collapsed selection
    // that never extends means shortcuts, formatting, and slash menus die.
    const selectionLength = await page.evaluate(() => {
      const sel = window.getSelection();
      if (!sel) return -1;
      sel.modify?.("extend", "backward", "word");
      return sel.toString().length;
    });
    expect(selectionLength, "Selection.modify should extend a selection").toBeGreaterThan(0);
  });
});

test.describe("canvas (tldraw)", () => {
  test("mounts a sized canvas and accepts pointer events", async ({ page }) => {
    /**
     * tldraw is pointer-events + canvas + ResizeObserver. WebKit's coalesced
     * pointer events and DPR handling are the usual suspects. A canvas with
     * zero width is the specific failure that looks fine in a screenshot of a
     * dark theme and is completely broken.
     */
    await preventVaultWrites(page);
    const opened = await openFirstDiagram(page);
    test.skip(!opened, "no diagrams exist in this environment");

    const canvas = page.locator("canvas, .tl-canvas").first();
    await expect(canvas, "tldraw should mount a canvas").toBeAttached({ timeout: 30_000 });

    const box = await canvas.boundingBox();
    expect(box?.width ?? 0, "canvas should have real width").toBeGreaterThan(100);
    expect(box?.height ?? 0, "canvas should have real height").toBeGreaterThan(100);

    // A drag across the surface must not throw. Not asserting a shape was
    // drawn — that depends on the active tool — only that the pointer
    // pipeline is intact.
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(String(err)));
    const cx = (box?.x ?? 0) + (box?.width ?? 0) / 2;
    const cy = (box?.y ?? 0) + (box?.height ?? 0) / 2;
    await page.mouse.move(cx - 40, cy - 40);
    await page.mouse.down();
    await page.mouse.move(cx + 40, cy + 40, { steps: 8 });
    await page.mouse.up();
    expect(errors.join("\n"), "pointer interaction should not throw").toBe("");
  });
});

test.describe("terminal (xterm.js)", () => {
  test("renders, sizes, and accepts keyboard input", async ({ page }) => {
    /**
     * xterm measures character cells by rendering to a canvas and reading
     * back metrics. WebKit's text metrics differ, and a bad measurement gives
     * a terminal that is one column wide or overlaps itself.
     *
     * The PTY peer (port 1339) is deliberately not required: CI does not run
     * it, and asserting on shell output would make this a test of
     * `node-pty` rather than of the engine. The engine question is whether
     * xterm mounts, measures, and takes keystrokes.
     */
    await page.goto("/");
    await hydrated(page);

    const dock = page.getByRole("complementary", { name: "Terminal" });

    /**
     * Re-fire until it lands, rather than dispatch once and wait.
     *
     * `devhub:terminal-open` is a plain window event: TerminalDock subscribes
     * in an effect, and an event dispatched before that effect runs is not
     * queued, it is simply gone — so a single dispatch is a race against
     * hydration that no amount of waiting afterwards can win. `hydrated()`
     * checks a *different* component, which is why this passed on Chromium and
     * failed intermittently on WebKit: same race, different hydration order.
     *
     * Each attempt opens the dock and adds a tab, so extra attempts are
     * harmless — the assertions below all read the first one.
     */
    await expect(async () => {
      await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent("devhub:terminal-open", { detail: {} }));
      });
      await expect(dock).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });

    /**
     * The dock boots into blocks view (Warp-style DOM cards), which keeps the
     * xterm grid mounted but hidden until a command runs or the user flips
     * views. The assertions below are about the grid itself — mount, canvas
     * measurement, keystrokes — so switch to raw first.
     */
    const rawToggle = page.getByRole("button", { name: "Raw terminal view" });
    await expect(rawToggle).toBeVisible({ timeout: 10_000 });
    await rawToggle.click();

    const screen = dock.locator(".xterm-screen, .xterm").first();
    await expect(screen).toBeVisible({ timeout: 20_000 });

    const box = await screen.boundingBox();
    expect(box?.width ?? 0, "xterm should measure a usable width").toBeGreaterThan(200);

    // Cell measurement is the actual risk. A single-column terminal is the
    // classic WebKit metrics failure and is invisible to a presence check.
    const cols = await page.evaluate(() => {
      const rows = document.querySelectorAll(".xterm-rows > div");
      return rows.length;
    });
    expect(cols, "xterm should render its row grid").toBeGreaterThan(4);

    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(String(err)));
    await screen.click();
    await page.keyboard.type("echo devhub-webkit-probe");
    expect(errors.join("\n"), "typing into xterm should not throw").toBe("");
  });
});

test.describe("mermaid", () => {
  test("SVG text measurement works on a detached node", async ({ page }) => {
    /**
     * Mermaid's entire layout depends on measuring text with `getBBox()` and
     * `getComputedTextLength()` on an SVG that is not yet in the visible
     * document. WebKit has historically returned zeroes there, and a zero
     * measurement produces a diagram whose nodes all collapse onto each other
     * — which renders, throws nothing, and is unreadable.
     *
     * So this probes the primitive rather than the library. An earlier version
     * called `import("mermaid")` from page context, which cannot work: the
     * page has no import map for bare specifiers, so it failed with a module
     * resolution error and told us nothing about WebKit at all. Measuring the
     * primitive directly is both honest about what is being tested and
     * unaffected by how the app happens to bundle its dependencies.
     */
    await page.goto("/");
    await hydrated(page);

    const measurements = await page.evaluate(() => {
      const NS = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(NS, "svg");
      svg.setAttribute("width", "300");
      svg.setAttribute("height", "100");
      // Off-screen but attached — exactly how mermaid measures before it
      // decides on node sizes.
      svg.style.position = "absolute";
      svg.style.left = "-9999px";

      const text = document.createElementNS(NS, "text");
      text.setAttribute("x", "10");
      text.setAttribute("y", "40");
      text.setAttribute("font-size", "16");
      text.textContent = "Deployment pipeline";
      svg.appendChild(text);

      const rect = document.createElementNS(NS, "rect");
      rect.setAttribute("x", "5");
      rect.setAttribute("y", "20");
      rect.setAttribute("width", "200");
      rect.setAttribute("height", "40");
      svg.appendChild(rect);

      document.body.appendChild(svg);
      const box = text.getBBox();
      const rectBox = rect.getBBox();
      const textLength = text.getComputedTextLength();
      svg.remove();

      return {
        textWidth: box.width,
        textHeight: box.height,
        computedTextLength: textLength,
        rectWidth: rectBox.width,
      };
    });

    expect(
      measurements.textWidth,
      "getBBox().width on SVG text must be non-zero or mermaid layout collapses",
    ).toBeGreaterThan(10);
    expect(measurements.textHeight, "getBBox().height on SVG text must be non-zero").toBeGreaterThan(4);
    expect(
      measurements.computedTextLength,
      "getComputedTextLength() must measure the string",
    ).toBeGreaterThan(10);
    expect(measurements.rectWidth, "getBBox() on a shape should report its width").toBe(200);
  });
});

test.describe("command palette", () => {
  test("opens on the shortcut and filters as you type", async ({ page }) => {
    // smoke.spec.ts asserts it opens. This adds the part that depends on the
    // engine's keyboard event model: typed input reaching a portalled input.
    await page.goto("/");
    await hydrated(page);

    await page.keyboard.press("ControlOrMeta+k");
    const palette = page
      .getByRole("dialog")
      .or(page.locator("[data-command-palette]"))
      .first();
    await expect(palette).toBeVisible({ timeout: 10_000 });

    const input = palette.locator("input").first();
    await expect(input).toBeVisible();
    await page.keyboard.type("repo", { delay: 20 });
    await expect(input).toHaveValue(/repo/i);

    await page.keyboard.press("Escape");
    await expect(palette).toBeHidden({ timeout: 10_000 });
  });
});

test.describe("downloads", () => {
  test("a generated file download resolves", async ({ page, context }) => {
    /**
     * The desktop shell has to let downloads escape the webview. WebKit
     * handles blob/`download`-attribute anchors differently enough that this
     * is worth proving before the shell exists — if it fails here it will
     * fail in WKWebView too, and diagram/note export is a real feature.
     */
    await page.goto("/");
    await hydrated(page);

    const downloadPromise = page.waitForEvent("download", { timeout: 15_000 });
    await page.evaluate(() => {
      const blob = new Blob(["devhub-download-probe\n"], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "devhub-probe.txt";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("devhub-probe.txt");
    await download.delete();
    expect(context.pages().length).toBeGreaterThan(0);
  });
});

test.describe("external links", () => {
  test("target=_blank links declare an external URL the shell can intercept", async ({ page }) => {
    /**
     * The Tauri shell opens non-DevHub URLs in the system browser and rejects
     * unexpected in-window navigation. That interception keys off real
     * absolute hrefs, so this asserts the app emits them rather than
     * router-pushing to an off-origin path — which the shell could not tell
     * apart from a normal navigation.
     */
    await page.goto("/");
    await hydrated(page);

    const externals = await page.evaluate(() => {
      const out: { href: string; target: string; rel: string }[] = [];
      for (const a of Array.from(document.querySelectorAll("a[href]"))) {
        const href = a.getAttribute("href") ?? "";
        if (!/^https?:\/\//i.test(href)) continue;
        if (href.startsWith(window.location.origin)) continue;
        out.push({
          href,
          target: a.getAttribute("target") ?? "",
          rel: a.getAttribute("rel") ?? "",
        });
      }
      return out;
    });

    test.skip(externals.length === 0, "no external links on this page in this environment");
    for (const link of externals) {
      expect(link.target, `${link.href} should open out of the app window`).toBe("_blank");
      expect(link.rel, `${link.href} should not leak window.opener`).toContain("noopener");
    }
  });
});
