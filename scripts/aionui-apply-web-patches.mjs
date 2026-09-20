#!/usr/bin/env node
/** Inject DevHub CSRF bridge + Graphite Neon defaults into managed AionUi WebUI. */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const MARKER = "<!--devhub-csrf-bridge-->";
const STYLE_MARKER = "<!--devhub-graphite-neon-->";

export const csrfBridgeScript = `
      (function () {
        function csrfToken() {
          try {
            var match = document.cookie.match(/(?:^|; )aionui-csrf-token=([^;]*)/);
            return match ? decodeURIComponent(match[1]) : "";
          } catch (e) { return ""; }
        }
        function withCsrf(init) {
          var next = init ? Object.assign({}, init) : {};
          var method = String(next.method || "GET").toUpperCase();
          if (method === "GET" || method === "HEAD" || method === "OPTIONS") return next;
          var token = csrfToken();
          if (!token) return next;
          var headers = new Headers(next.headers || {});
          if (!headers.has("x-csrf-token")) headers.set("x-csrf-token", token);
          next.headers = headers;
          return next;
        }
        var originalFetch = window.fetch.bind(window);
        window.fetch = function (input, init) {
          return originalFetch(input, withCsrf(init));
        };
        if (typeof XMLHttpRequest !== "undefined") {
          var originalOpen = XMLHttpRequest.prototype.open;
          var originalSend = XMLHttpRequest.prototype.send;
          var originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
          XMLHttpRequest.prototype.open = function (method) {
            this.__devhubMethod = String(method || "GET").toUpperCase();
            this.__devhubHasCsrf = false;
            return originalOpen.apply(this, arguments);
          };
          XMLHttpRequest.prototype.setRequestHeader = function (name) {
            if (String(name).toLowerCase() === "x-csrf-token") this.__devhubHasCsrf = true;
            return originalSetRequestHeader.apply(this, arguments);
          };
          XMLHttpRequest.prototype.send = function () {
            var method = this.__devhubMethod || "GET";
            if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS" && !this.__devhubHasCsrf) {
              var token = csrfToken();
              if (token) this.setRequestHeader("x-csrf-token", token);
            }
            return originalSend.apply(this, arguments);
          };
        }
        try {
          document.documentElement.setAttribute("data-theme", "dark");
          localStorage.setItem("__aionui_theme", "dark");
        } catch (e) {}
      })();`;

const BRIDGE = `${MARKER}
    <script>${csrfBridgeScript}
    </script>
`;

const STYLE = `${STYLE_MARKER}
    <style id="devhub-graphite-neon">

html, body, #root { background: #111416 !important; color: #ebeff3 !important; }
html { color-scheme: dark; }
::selection { background: rgba(158,216,74,.35); color: #ebeff3; }
a { color: #9ed84a; }

/* Arco uses rgb(var(--primary-6)) — must be channel triples, not hex */
[data-theme='dark'], :root, html, body, body[arco-theme='dark'], body[arco-theme=dark] {
  --arcoblue-1: 37, 48, 25;
  --arcoblue-2: 58, 79, 31;
  --arcoblue-3: 37, 48, 25;
  --arcoblue-4: 58, 79, 31;
  --arcoblue-5: 184, 236, 98;
  --arcoblue-6: 158, 216, 74;
  --arcoblue-7: 134, 189, 56;
  --primary-1: 37, 48, 25;
  --primary-2: 58, 79, 31;
  --primary-3: 37, 48, 25;
  --primary-4: 58, 79, 31;
  --primary-5: 184, 236, 98;
  --primary-6: 158, 216, 74;
  --primary-7: 134, 189, 56;
  --blue-1: 37, 48, 25;
  --blue-2: 58, 79, 31;
  --blue-6: 158, 216, 74;
  --color-primary-6: #9ed84a;
  --color-primary-5: #b8ec62;
  --color-primary-7: #86bd38;
  --color-primary-3: #253019;
  --color-primary-4: #3a4f1f;
  --color-link-6: #9ed84a;
  --color-text-1: #ebeff3;
  --color-text-2: #a5b0ba;
  --color-text-3: #7d8892;
  --color-border: #37414b;
  --color-border-2: #252d35;
  --color-border-3: #37414b;
  --color-neutral-3: #37414b;
  --color-fill-1: #0d1012;
  --color-fill-2: #1b2024;
  --color-fill-3: #232a30;
  --color-fill-4: #2c343c;
  --color-bg-1: #111416;
  --color-bg-2: #0d1012;
  --color-bg-3: #1b2024;
  --color-bg-4: #232a30;
  --color-bg-5: #2c343c;
  --color-guid-agent-bar: #0d1012;
  --bg-base: #111416;
  --bg-1: #0d1012;
  --bg-2: #1b2024;
  --bg-3: #232a30;
  --text-primary: #ebeff3;
  --text-secondary: #a5b0ba;
}

button.arco-btn-primary, .arco-btn-primary {
  background: #9ed84a !important; border-color: #9ed84a !important; color: #121710 !important;
}
.arco-btn-primary:hover, button.arco-btn-primary:hover {
  background: #b8ec62 !important; border-color: #b8ec62 !important;
}
.arco-btn-secondary, .arco-btn-outline {
  background: #1b2024 !important; border-color: #37414b !important; color: #ebeff3 !important;
}

.arco-input, .arco-textarea, .arco-select-view, .arco-input-inner-wrapper,
.arco-input-group-wrapper, .arco-input-group, .arco-input-group-addbefore, .arco-input-group-addafter,
input, textarea {
  background: #1b2024 !important;
  background-color: #1b2024 !important;
  border-color: #37414b !important;
  color: #ebeff3 !important;
  caret-color: #9ed84a !important;
}
.arco-input-group-addbefore, .arco-input-group-addafter {
  background: #1b2024 !important;
  background-color: #1b2024 !important;
  color: #a5b0ba !important;
  border-color: #37414b !important;
}
.arco-input-inner-wrapper .arco-input,
.arco-input-group-wrapper .arco-input {
  background: transparent !important;
  background-color: transparent !important;
}
.arco-input:focus, .arco-textarea:focus, .arco-select-view:focus-within, input:focus, textarea:focus {
  border-color: #9ed84a !important;
  box-shadow: 0 0 0 1px rgba(158,216,74,.35) !important;
}

.layout-sider, .arco-layout-sider, [class*="Sider"], [class*="sidebar"], [class*="Sidebar"] {
  background: #0d1012 !important;
  border-right: 1px solid #252d35 !important;
  box-shadow: inset 3px 0 0 #9ed84a !important;
}
[class*="agent-bar"], [class*="AgentBar"] { background: #0d1012 !important; }

/* Enabled count — arcoblue badge used rgb(var(--primary-6)) */
.arco-badge-number,
.arco-badge-text,
.arco-badge-dot,
.arco-badge-no-children .arco-badge-number,
.arco-badge-no-children .arco-badge-text,
.arco-badge-color-arcoblue,
.arco-badge-color-blue,
.arco-badge-status-processing,
.arco-tabs-header-title .arco-badge-number,
.arco-tabs-header-extra .arco-badge-number {
  background: #9ed84a !important;
  background-color: #9ed84a !important;
  color: #121710 !important;
  box-shadow: 0 0 0 2px #0d1012 !important;
}
.arco-badge-number-text { color: #121710 !important; }

.arco-tag-blue, .arco-tag-arcoblue, .arco-tag-checked.arco-tag-blue {
  background: rgba(158,216,74,.18) !important;
  color: #9ed84a !important;
  border-color: transparent !important;
}

.arco-icon, .arco-btn-text, .arco-link, a.arco-link { color: #9ed84a !important; }
svg[fill='#165DFF'], svg[fill='#3491FA'] { fill: #9ed84a !important; }
svg[stroke='#165DFF'], svg[stroke='#3491FA'] { stroke: #9ed84a !important; }

.arco-menu-item.arco-menu-selected, .arco-tabs-header-title-active,
.arco-radio-checked .arco-radio-mask {
  background: rgba(158,216,74,.15) !important;
  color: #9ed84a !important;
  border-color: #9ed84a !important;
}
.arco-checkbox-checked .arco-checkbox-mask, .arco-switch-checked {
  background: #9ed84a !important; border-color: #9ed84a !important;
}
.arco-dropdown, .arco-popover-content, .arco-modal-content, .arco-drawer-content,
.arco-table, .arco-list, .arco-card {
  background: #1b2024 !important; border-color: #252d35 !important; color: #ebeff3 !important;
}

/* Composer — kill warm #262626 */
[data-theme='dark'] [class*="_guidInputInner"],
[class*="_guidInputInner"],
.sendbox-panel {
  background: #1b2024 !important;
  border-color: #37414b !important;
}
[class*="_guidInputCardWrap"] { background: #111416 !important; }
[data-theme='dark'] [class*="_assistantCard"] { background: #1b2024 !important; }
.sendbox-panel .arco-textarea-wrapper,
.sendbox-panel .arco-textarea,
.sendbox-panel textarea {
  background: transparent !important;
  border-color: transparent !important;
}


/* Force Arco dark-theme tokens — body[arco-theme=dark] was reintroducing warm/blue greys */
body[arco-theme='dark'],
body[arco-theme=dark],
html[data-theme='dark'],
[data-theme='dark'] {
  --color-bg-1: #111416 !important;
  --color-bg-2: #1b2024 !important;
  --color-bg-3: #232a30 !important;
  --color-bg-4: #2c343c !important;
  --color-bg-5: #2c343c !important;
  --color-fill-1: #0d1012 !important;
  --color-fill-2: #1b2024 !important;
  --color-fill-3: #232a30 !important;
  --color-fill-4: #2c343c !important;
  --color-border: #37414b !important;
  --color-neutral-2: #252d35 !important;
  --color-neutral-3: #37414b !important;
  --color-neutral-4: #2c343c !important;
}

/* Skills / assistants search — whole pill one graphite surface */
.arco-input-inner-wrapper,
.arco-input-inner-wrapper:not(.arco-input-inner-wrapper-disabled),
.arco-input-inner-wrapper:hover,
.arco-input-group,
.arco-input-group-wrapper,
.arco-input-group-addbefore,
.arco-input-group-addafter,
.arco-input-search,
.arco-input-search .arco-input-group,
.arco-input-search .arco-input-inner-wrapper,
[data-testid="guid-skill-search"],
[data-testid="guid-skill-search"] *,
[class*="skill-search"],
[class*="SkillSearch"] {
  background: #1b2024 !important;
  background-color: #1b2024 !important;
  border-color: #37414b !important;
  box-shadow: none !important;
}
.arco-input-inner-wrapper .arco-input,
.arco-input-group .arco-input,
.arco-input-search input {
  background: transparent !important;
  background-color: transparent !important;
}

/* Settings cards / System rows — match page graphite, not Arco #232324 */
.arco-card,
.arco-list-item,
.arco-collapse-item,
.arco-collapse-item-header,
.arco-collapse-item-content,
.arco-collapse-item-content-box,
[class*="Settings"] [class*="card"],
[class*="settings"] [class*="Card"],
[class*="SettingItem"],
[class*="setting-item"],
[class*="SettingRow"],
[class*="setting-row"] {
  background: #1b2024 !important;
  background-color: #1b2024 !important;
  border-color: #37414b !important;
  color: #ebeff3 !important;
}

    </style>
`;

export function applyAionWebPatches(rendererDir) {
  const indexPath = path.join(rendererDir, "index.html");
  if (!fs.existsSync(indexPath)) throw new Error("AionUi renderer index.html is missing.");
  let text = fs.readFileSync(indexPath, "utf8");
  if (text.includes(MARKER)) {
    text = text.replace(/<!--devhub-csrf-bridge-->[\s\S]*?<\/script>\n/, BRIDGE);
  } else {
    text = text.replace("<head>", `<head>\n${BRIDGE}`);
  }
  if (text.includes(STYLE_MARKER)) {
    text = text.replace(/<!--devhub-graphite-neon-->[\s\S]*?<\/style>\n/, STYLE);
  } else {
    text = text.replace("</head>", `${STYLE}\n  </head>`);
  }
  text = text.replace(/data-theme="light"/g, 'data-theme="dark"');
  text = text.replace(/content="#4E5969"/g, 'content="#111416"');
  text = text.replace(
    "var theme = localStorage.getItem('__aionui_theme');\n          if (theme)",
    "var theme = localStorage.getItem('__aionui_theme') || 'dark';\n          if (theme)",
  );
  fs.writeFileSync(indexPath, text);
  return indexPath;
}

function pinnedUiVersion() {
  const file = path.join(import.meta.dirname, "aionui-release.json");
  return JSON.parse(fs.readFileSync(file, "utf8")).ui;
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  const managed = path.join(os.homedir(), ".config", "devhub", "aionui-managed.json");
  const releaseArg = process.argv[2];
  if (releaseArg) {
    console.log("Patched", applyAionWebPatches(path.join(releaseArg, "out", "renderer")));
  } else if (fs.existsSync(managed)) {
    const m = JSON.parse(fs.readFileSync(managed, "utf8"));
    const version = m.ui || pinnedUiVersion();
    const candidate = path.join(m.root || path.join(os.homedir(), ".local", "share", "devhub", "aionui"), version, "out", "renderer");
    console.log("Patched", applyAionWebPatches(candidate));
  } else {
    console.error("Pass the AionUi release directory.");
    process.exitCode = 1;
  }
}
