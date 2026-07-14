// The default bespoke canvas — a complete, self-contained HTML document that
// reads window.__BRIEFING__ and renders a clean animated dashboard. It's what
// you see before the AI has authored anything, and the fallback whenever AI is
// unconfigured or a generation fails. Deliberately dependency-free vanilla JS,
// built with DOM APIs (no innerHTML) so arbitrary feed text can't inject markup.
//
// NOTE: this is stored as a template literal, so the embedded script must avoid
// backticks and ${...} — it uses single quotes and string concatenation.

export const DEFAULT_CANVAS_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Briefing</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: var(--app-text, #e7ecf3); background: var(--app-bg, #0a0e17); min-height: 100vh; -webkit-font-smoothing: antialiased;
  }
  a { color: inherit; }
  .bg { position: fixed; inset: 0; z-index: -1; overflow: hidden; }
  .blob { position: absolute; width: 55vw; height: 55vw; border-radius: 50%; filter: blur(90px); opacity: 0.22; animation: drift 24s ease-in-out infinite; }
  .blob.a { background: #1d4ed8; top: -14vw; left: -8vw; }
  .blob.b { background: #7c3aed; bottom: -16vw; right: -8vw; animation-delay: -8s; }
  .blob.c { background: #0891b2; top: 28vh; right: 18vw; animation-delay: -15s; opacity: 0.3; }
  @keyframes drift { 0%,100% { transform: translate(0,0) scale(1); } 33% { transform: translate(4vw,3vh) scale(1.1); } 66% { transform: translate(-3vw,-2vh) scale(0.95); } }
  @media (prefers-reduced-motion: reduce) { .blob { animation: none; } .card { animation: none; } }
  .wrap { max-width: 1120px; margin: 0 auto; padding: 30px 22px 72px; }
  .top { margin-bottom: 20px; }
  .hello { font-size: 30px; font-weight: 700; letter-spacing: -0.02em; margin: 0; }
  .sub { color: var(--app-subtle, #93a1b3); font-size: 13px; margin: 5px 0 0; }
  .hero { display: flex; gap: 20px; align-items: center; flex-wrap: wrap; background: var(--app-surface, rgba(255,255,255,0.045)); border: 1px solid var(--app-border, rgba(255,255,255,0.08)); border-radius: 18px; padding: 18px 22px; margin-bottom: 22px; backdrop-filter: blur(8px); }
  .temp { font-size: 48px; font-weight: 700; line-height: 1; }
  .hero-meta { color: var(--app-muted, #b7c2d0); font-size: 14px; max-width: 320px; }
  .hero-loc { font-weight: 600; color: var(--app-text, #e7ecf3); }
  .forecast { display: flex; gap: 10px; margin-left: auto; flex-wrap: wrap; }
  .fday { text-align: center; background: var(--app-elevated, rgba(255,255,255,0.05)); border-radius: 12px; padding: 8px 12px; min-width: 66px; }
  .fday b { display: block; font-size: 11px; color: var(--app-subtle, #93a1b3); font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
  .fday span { font-size: 14px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; align-items: start; }
  .card { background: var(--app-surface, rgba(255,255,255,0.035)); border: 1px solid var(--app-border, rgba(255,255,255,0.07)); border-radius: 16px; padding: 15px 16px 9px; animation: rise 0.5s ease both; }
  @keyframes rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
  .card-title { font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--app-accent, #8ea0ff); margin-bottom: 4px; }
  .row { display: block; padding: 9px 0; border-top: 1px solid var(--app-border, rgba(255,255,255,0.06)); text-decoration: none; font-size: 14px; line-height: 1.4; }
  .row:first-of-type { border-top: 0; }
  a.row:hover .row-title { color: var(--app-text, #fff); text-decoration: underline; }
  .row-title { color: var(--app-text, #dfe6ef); display: block; }
  .row-strong { color: var(--app-text, #fff); font-weight: 600; }
  .meta { display: block; color: var(--app-subtle, #7f8da3); font-size: 12px; margin-top: 2px; }
  .empty { color: var(--app-subtle, #7f8da3); font-size: 14px; padding: 40px 0; text-align: center; }
  .foot { margin-top: 26px; color: var(--app-subtle, #66748a); font-size: 12px; text-align: center; }
</style>
</head>
<body>
  <div class="bg"><div class="blob a"></div><div class="blob b"></div><div class="blob c"></div></div>
  <div class="wrap">
    <div class="top" id="top"></div>
    <div id="hero"></div>
    <div class="grid" id="grid"></div>
    <div class="foot" id="foot"></div>
  </div>
  <script>
  (function(){
    var B = window.__BRIEFING__ || {};
    function h(tag, cls){ var e = document.createElement(tag); if (cls) e.className = cls; return e; }
    function t(el, s){ el.textContent = (s == null ? '' : String(s)); return el; }
    function greeting(){ var hr = new Date().getHours(); if (hr < 12) return 'Good morning'; if (hr < 18) return 'Good afternoon'; return 'Good evening'; }

    function link(item){
      var a = h('a', 'row'); a.href = item.url || '#'; a.target = '_blank'; a.rel = 'noopener';
      var title = h('span', 'row-title'); t(title, item.title || item.name || 'Untitled'); a.appendChild(title);
      var bits = [];
      if (item.source) bits.push(item.source);
      if (item.language) bits.push(item.language);
      if (typeof item.stars === 'number') bits.push(item.stars.toLocaleString() + ' stars');
      if (typeof item.score === 'number') bits.push(item.score + ' pts');
      if (typeof item.comments === 'number') bits.push(item.comments + ' comments');
      if (item.meta) bits.push(String(item.meta).slice(0, 40));
      if (bits.length) { var m = h('span', 'meta'); t(m, bits.join(' \\u00b7 ')); a.appendChild(m); }
      return a;
    }
    function onThisDay(item){
      var a = h(item.url ? 'a' : 'div', 'row'); if (item.url){ a.href = item.url; a.target = '_blank'; a.rel = 'noopener'; }
      var title = h('span', 'row-title');
      var y = h('span', 'row-strong'); t(y, (item.year != null ? item.year + '  ' : ''));
      title.appendChild(y); title.appendChild(document.createTextNode(item.text || ''));
      a.appendChild(title); return a;
    }
    function interest(item){
      var d = h('div', 'row'); var s = h('span', 'row-title');
      var name = h('span', 'row-strong'); t(name, (item.interest || '') + '  '); s.appendChild(name);
      s.appendChild(document.createTextNode(item.text || '')); d.appendChild(s); return d;
    }
    function research(item){
      var d = h('div', 'row'); var s = h('span', 'row-title row-strong'); t(s, item.title || item.interest || 'Research'); d.appendChild(s);
      if (item.summary) { var m = h('span', 'meta'); t(m, item.summary); d.appendChild(m); }
      return d;
    }
    function card(title, items, render){
      if (!items || !items.length) return;
      var c = h('section', 'card');
      var head = h('div', 'card-title'); t(head, title); c.appendChild(head);
      var n = Math.min(items.length, 6);
      for (var i = 0; i < n; i++){ c.appendChild((render || link)(items[i])); }
      document.getElementById('grid').appendChild(c);
    }

    // Header
    var top = document.getElementById('top');
    var hi = h('h1', 'hello'); t(hi, greeting() + (B.location && B.location.name ? ', ' + B.location.name.split(',')[0] : '')); top.appendChild(hi);
    var sub = h('p', 'sub'); t(sub, B.summary || 'Your bespoke start-of-day briefing.'); top.appendChild(sub);

    // Weather hero
    if (B.weather) {
      var w = B.weather; var today = (w.days && w.days[0]) || {};
      var hero = h('div', 'hero');
      var temp = h('div', 'temp'); t(temp, Math.round(w.currentTempC) + '\\u00b0'); hero.appendChild(temp);
      var meta = h('div', 'hero-meta');
      var loc = h('div', 'hero-loc'); t(loc, w.location || ''); meta.appendChild(loc);
      var desc = h('div'); t(desc, (today.description || '') + (today.highC != null ? '  H:' + Math.round(today.highC) + '\\u00b0 L:' + Math.round(today.lowC) + '\\u00b0' : '')); meta.appendChild(desc);
      hero.appendChild(meta);
      var fc = h('div', 'forecast');
      (w.days || []).slice(0, 4).forEach(function(d){
        var box = h('div', 'fday'); var b = h('b'); t(b, d.label || ''); box.appendChild(b);
        var s = h('span'); t(s, Math.round(d.highC) + '\\u00b0'); box.appendChild(s); fc.appendChild(box);
      });
      hero.appendChild(fc);
      document.getElementById('hero').appendChild(hero);
    }

    // Sections
    card('Background research', B.research, research);
    card('Events near you', B.events);
    card('News', B.news);
    card('Gaming', B.gaming);
    card('Trending repos', B.github);
    card('Hacker News', B.hackerNews);
    card('For your interests', B.interests, interest);
    (B.feeds || []).forEach(function(f){ card(f.label || 'Feed', f.items); });
    card('On this day', B.onThisDay, onThisDay);

    if (!document.getElementById('grid').children.length && !B.weather) {
      var e = h('div', 'empty'); t(e, 'Nothing to show yet. Open the design chat and tell me what you want on your briefing.');
      document.getElementById('grid').appendChild(e);
    }

    var foot = document.getElementById('foot');
    var when = B.generatedAt ? new Date(B.generatedAt) : new Date();
    t(foot, 'Updated ' + when.toLocaleString());
  })();
  </script>
</body>
</html>`;
