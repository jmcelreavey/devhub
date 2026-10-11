# HTML report

One static file. Tailwind from `https://cdn.tailwindcss.com`. Mermaid from the jsDelivr ESM build, `startOnLoad: true`, theme `neutral`. No other scripts. No app code.

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Architecture review for {{repo}}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script type="module">
      import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
      mermaid.initialize({ startOnLoad: true, theme: "neutral", securityLevel: "loose" });
    </script>
  </head>
  <body class="bg-stone-50 text-slate-900">
    <main class="max-w-5xl mx-auto px-6 py-12 space-y-12">
      <header></header>
      <section id="candidates"></section>
      <section id="top-recommendation"></section>
    </main>
  </body>
</html>
```

Header: repo name, date, and a one-line legend. Solid box = module, dashed line = seam, red = leakage, thick dark box = deep module. No introduction.

Each candidate is an `<article>`:

- Title that names the deepening.
- Badge: `Strong` (emerald), `Worth exploring` (amber), or `Speculative` (slate). Plus the dependency category from [DEEPENING.md](./DEEPENING.md).
- Files, monospaced.
- Before / after, side by side. This is the centrepiece. Mermaid when the point is a call graph or a sequence. Hand-built divs or SVG when you need one thick deep module with faded internals, a stack of thin layers against one thick band, or an interface rectangle that shrinks while the implementation stays tall.
- Problem, one sentence. Solution, one sentence.
- Wins, short bullets in vocabulary words: locality, leverage, the interface shrinks. Not "cleaner" or "easier to maintain".
- An amber callout when it contradicts an ADR, and why reopening it is worth it.

Diagrams about 320px tall. If a diagram needs a paragraph, redraw it.

Top recommendation: one card, the candidate's name, one sentence on why, a link to its article.

Words you may use: module, interface, implementation, depth, deep, shallow, seam, adapter, leverage, locality.

Words you may not substitute: component, service, unit for module; API or signature for interface; boundary for seam.
