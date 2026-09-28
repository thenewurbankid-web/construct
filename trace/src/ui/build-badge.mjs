// The build badge: `v1.0.0 · 3f9c2a1 · R0 · deployed 12 min ago`, a link to the About page. Reusable: any page that is
// served by the Trace server can do
//
//   import { mountBuildBadge } from "/ui/build-badge.mjs";
//   mountBuildBadge(document.getElementById("build"));
//
// It fetches /api/build, refreshes the "x ago" text every 30 s without asking the server, refetches every 60 s, and if
// the server now runs a different build than the one this page was loaded with it offers a "New build available:
// reload" button (never reloads by itself, so nothing typed on the page is lost).
//
// A host whose bar hides the badge on narrow windows can pass `dot: <element>`: a small always-visible indicator (a link
// to /about that turns into the same reload button, dot-sized, when the server runs another build). See dotState().

// Pure formatting, unit-tested. `from` and `now` are epoch milliseconds.
export function relativeTime(from, now) {
  const s = Math.max(0, (now - from) / 1000);
  if (s < 45) return "just now";
  const min = Math.floor(s / 60);
  if (s < 3600) return `${Math.max(1, min)} min ago`;
  const h = Math.floor(s / 3600);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

const localTime = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" });

// info: the /api/build payload. Returns the visible text, a short form for tight bars, and the tooltip.
export function badgeText(info, now = Date.now()) {
  const v = `v${String(info.version).split("+")[0]}`, h7 = String(info.hash).slice(0, 7);
  const parts = [v, h7];
  if (info.release) parts.push(info.release);
  if (info.dev || !info.builtAt) {
    parts.push("dev build");
    return { text: parts.join(" · "), short: `${h7} · dev build`, title: `Development checkout, not a deployed build.\nhash ${info.hash}` };
  }
  const ago = relativeTime(Date.parse(info.builtAt), now);
  parts.push(`deployed ${ago}`);
  return { text: parts.join(" · "), short: `${h7} · ${ago}`, title: `Deployed ${localTime(info.builtAt)}\nhash ${info.hash}` };
}

export const shouldOfferReload = (loadedHash, currentHash) => !!loadedHash && !!currentHash && loadedHash !== currentHash;

// What the dot shows, from the latest /api/build payload (null before the first answer) and the hash this page loaded with.
// kind: pending | ok | dev | new. `label` is the accessible name, `title` the tooltip. Pure, unit-tested.
export function dotState(info, loadedHash) {
  if (!info) return { kind: "pending", label: "Trace build: checking", title: "Checking which build is running" };
  if (shouldOfferReload(loadedHash, info.hash)) {
    return { kind: "new", label: "New build available: reload", title: `New build available${info.release ? ` (${info.release})` : ""}: reload this page to use it` };
  }
  const name = info.release || `v${String(info.version).split("+")[0]}`;
  if (info.dev || !info.builtAt) return { kind: "dev", label: `Trace ${name}, development checkout: open About`, title: `Trace ${name}, development checkout, not a deployed build. Open About.` };
  return { kind: "ok", label: `Trace ${name}, up to date: open About`, title: `Trace ${name} is the newest build. Open About.` };
}

const CSS = `
.lm-build{display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap;font:11px/1.3 system-ui,-apple-system,sans-serif;color:var(--mut,#5e584f)}
.lm-build a{color:inherit;text-decoration:none;border:1px solid var(--bd,#d8d3c8);border-radius:99px;padding:2px 8px;white-space:nowrap}
.lm-build .lm-short{display:none}
.lm-build a:hover{border-color:var(--acc,#1d56c9);color:var(--fg,#24211d)}
.lm-build button{font:inherit;color:var(--fg,#24211d);background:transparent;border:1px solid var(--acc,#1d56c9);border-radius:99px;padding:2px 10px;cursor:pointer;white-space:nowrap}
.lm-build button:hover{background:var(--stat,#e6e2d9)}
.lm-dot{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;border:0;border-radius:99px;background:transparent;color:inherit;cursor:pointer;text-decoration:none;flex:none}
.lm-dot[hidden]{display:none}
.lm-dot:hover{background:var(--stat,#e6e2d9)}
.lm-dot:focus-visible{outline:2px solid var(--acc,#1d56c9);outline-offset:1px}
.lm-dot i{display:block;width:9px;height:9px;border-radius:99px;background:var(--grn,#1f7a4d)}
.lm-dot[data-kind=pending] i,.lm-dot[data-kind=dev] i{background:transparent;box-shadow:inset 0 0 0 2px var(--mut,#5e584f)}
.lm-dot[data-kind=new] i{width:11px;height:11px;background:var(--amb,#b45f06);box-shadow:0 0 0 3px color-mix(in srgb,var(--amb,#b45f06) 30%,transparent);animation:lm-dot-pulse 1.6s ease-in-out infinite}
@keyframes lm-dot-pulse{50%{box-shadow:0 0 0 5px color-mix(in srgb,var(--amb,#b45f06) 0%,transparent)}}
@media(prefers-reduced-motion:reduce){.lm-dot[data-kind=new] i{animation:none}}
`;

// opts (all optional, for tests and for hosts that differ): href, url, fetchImpl, now, setInterval, clearInterval, reload, dot
export function mountBuildBadge(el, opts = {}) {
  const { href = "/about", url = "/api/build", now = Date.now } = opts;
  const doFetch = opts.fetchImpl ?? ((u) => fetch(u, { cache: "no-store" }));
  const every = opts.setInterval ?? setInterval, stopEvery = opts.clearInterval ?? clearInterval;
  const doc = el.ownerDocument;
  if (!doc.getElementById("lm-build-css")) {
    const st = doc.createElement("style");
    st.id = "lm-build-css";
    st.textContent = CSS;
    doc.head.appendChild(st);
  }
  el.classList.add("lm-build");
  const link = doc.createElement("a");
  link.href = href;
  // two spans, one shown: hosts with a tight bar swap them with a media query (see the studio's top bar)
  const full = doc.createElement("span"), short = doc.createElement("span");
  full.className = "lm-full"; short.className = "lm-short";
  full.textContent = "build…";
  link.append(full, short);
  const btn = doc.createElement("button");
  btn.type = "button";
  btn.hidden = true;
  btn.textContent = "New build available: reload";
  btn.addEventListener("click", opts.reload ?? (() => location.reload()));
  el.append(link, btn);

  // the optional dot: one link (normal) and one button (new build); exactly one is visible
  let dotLink = null, dotBtn = null;
  if (opts.dot) {
    const mk = (tag) => { const e = doc.createElement(tag); e.className = "lm-dot"; e.append(doc.createElement("i")); return e; };
    dotLink = mk("a"); dotLink.href = href;
    dotBtn = mk("button"); dotBtn.type = "button"; dotBtn.hidden = true;
    dotBtn.addEventListener("click", opts.reload ?? (() => location.reload()));
    opts.dot.append(dotLink, dotBtn);
  }
  const paintDot = () => {
    if (!dotLink) return;
    const d = dotState(info, loadedHash), isNew = d.kind === "new", active = doc.activeElement;
    for (const e of [dotLink, dotBtn]) { e.title = d.title; e.setAttribute("aria-label", d.label); e.setAttribute("data-kind", d.kind); }
    dotLink.hidden = isNew;
    dotBtn.hidden = !isNew;
    // a keyboard user who is on the dot stays on it when it swaps between the link and the button
    if (active === dotLink && isNew) dotBtn.focus?.();
    else if (active === dotBtn && !isNew) dotLink.focus?.();
  };

  let info = null, loadedHash = null;
  paintDot();
  const paint = () => {
    if (!info) return;
    const { text, short: s, title } = badgeText(info, now());
    full.textContent = text;
    short.textContent = s;
    link.title = title;
  };
  const refresh = async () => {
    try {
      const r = await doFetch(url);
      if (!r.ok) return;
      info = await r.json();
      loadedHash ??= info.hash; // the build this page was served by
      btn.hidden = !shouldOfferReload(loadedHash, info.hash);
      paint();
      paintDot();
    } catch { /* server restarting: keep what is shown, try again next minute */ }
  };
  refresh();
  const timers = [every(paint, 30_000), every(refresh, 60_000)];
  return { refresh, stop: () => timers.forEach(stopEvery), get info() { return info; }, link, full, short, button: btn, dotLink, dotButton: dotBtn };
}
