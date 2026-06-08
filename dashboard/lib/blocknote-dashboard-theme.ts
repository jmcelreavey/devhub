import { darkDefaultTheme } from "@blocknote/mantine";

/** BlockNote theme aligned with DevHub CSS variables. */
export const blocknoteDashboardTheme = {
  ...darkDefaultTheme,
  colors: {
    ...darkDefaultTheme.colors,
    editor: { text: "var(--text)", background: "transparent" },
    menu: { text: "var(--text)", background: "var(--bg-elevated)" },
    tooltip: { text: "var(--text)", background: "var(--bg-elevated)" },
    hovered: { text: "var(--text)", background: "var(--bg-overlay)" },
    selected: { text: "#ffffff", background: "var(--accent)" },
    disabled: { text: "var(--text-subtle)", background: "var(--bg-surface)" },
    shadow: "var(--border)",
    border: "var(--border)",
    sideMenu: "var(--text-subtle)",
    highlights: darkDefaultTheme.colors?.highlights,
  },
  borderRadius: 6,
  fontFamily: "Inter, system-ui, sans-serif",
};
