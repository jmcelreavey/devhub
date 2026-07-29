/**
 * Map the DevHub palette onto Mermaid's theme variables.
 *
 * Mermaid's stock themes are a different blue-grey to everything else in the
 * app, so diagrams read as pasted-in screenshots. Driving them from the design
 * tokens means diagrams follow accent presets and plugin whitelabelling too.
 *
 * Pure and DOM-free so the diagram checker can validate against the exact
 * config the app uses — the first version of this passed `transparent` for
 * `clusterBkg`, which Mermaid feeds through colour maths and which silently
 * killed every diagram containing a `subgraph`.
 */

export interface MermaidPalette {
  surface: string;
  elevated: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
}

export const DARK_FALLBACK_PALETTE: MermaidPalette = {
  surface: "#161616",
  elevated: "#1f1f1f",
  border: "#2e2e2e",
  text: "#e6e6e6",
  muted: "#a1a1a1",
  accent: "#7c5cff",
};

export const LIGHT_FALLBACK_PALETTE: MermaidPalette = {
  surface: "#ffffff",
  elevated: "#f4f4f5",
  border: "#e4e4e7",
  text: "#1a1a1a",
  muted: "#52525b",
  accent: "#6d4aff",
};

export function buildMermaidTheme(
  palette: MermaidPalette,
  isDark: boolean,
): Record<string, string> {
  const { surface, elevated, border, text, muted, accent } = palette;
  return {
    darkMode: String(isDark),
    // Every value here must be a real colour. Mermaid derives contrast and
    // border shades from these, and keywords like `transparent` throw.
    background: surface,
    primaryColor: elevated,
    primaryTextColor: text,
    primaryBorderColor: border,
    secondaryColor: surface,
    secondaryTextColor: text,
    secondaryBorderColor: border,
    tertiaryColor: surface,
    tertiaryTextColor: muted,
    tertiaryBorderColor: border,
    lineColor: accent,
    textColor: text,
    mainBkg: elevated,
    nodeBorder: border,
    clusterBkg: surface,
    clusterBorder: border,
    edgeLabelBackground: surface,
    fontSize: "13px",
    // Sequence diagrams read from their own set of variables.
    actorBkg: elevated,
    actorBorder: border,
    actorTextColor: text,
    actorLineColor: border,
    signalColor: text,
    signalTextColor: muted,
    labelBoxBkgColor: elevated,
    labelBoxBorderColor: border,
    labelTextColor: text,
    loopTextColor: muted,
    noteBkgColor: surface,
    noteBorderColor: accent,
    noteTextColor: text,
  };
}
