// Shared building blocks for the concept mocks (the Cockpit shell chrome).
// Every mock imports these so screens drawn at different times stay consistent:
// one top bar, one 3-pane grid, one tab strip, one status bar.
// Used by build.mjs and build-qa-tests.mjs; output HTML is committed.

export const page = (title, body) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title} — Concept</title>
<link rel="stylesheet" href="mock.css">
<script>document.documentElement.dataset.theme = new URLSearchParams(location.search).get('theme') || 'dark';</script>
<script>document.addEventListener('DOMContentLoaded',()=>{document.body.dataset.x=1});</script>
</head><body>
<div class="concept">Concept — not implemented <span>${title}</span></div>
${body}
<script>(()=>{const t=document.documentElement.dataset.theme;document.body.parentElement.setAttribute('data-theme',t)})()</script>
</body></html>`;

export const tabs = (items, on) =>
  `<div class="tabs" role="tablist">${items
    .map(([n, b]) => `<button role="tab" class="${n === on ? 'on' : ''}" aria-selected="${n === on}">${n}${b ? ` <span class="badge ${b[1] || ''}">${b[0]}</span>` : ''}</button>`)
    .join('')}</div>`;

export const topbar = (mode, procs = '2 running', extra = '') => `
<header class="topbar">
  <div class="brand"><i></i>Construct</div>
  <button class="chip-btn" aria-haspopup="listbox">storefront <span class="sub">main</span> ▾</button>
  <div class="seg" role="radiogroup" aria-label="Mode">${['Explore', 'Research', 'Build'].map((m) => `<button class="${m === mode ? 'on' : ''}" role="radio" aria-checked="${m === mode}">${m}</button>`).join('')}</div>
  <button class="chip-btn palette-trigger"><span>Search files, features, or run a command…</span><kbd>Ctrl K</kbd></button>
  ${extra}
  <span class="pill run"><span class="spin"></span>${procs}</span>
  <span class="pill ok"><span class="dot"></span>Local model ready</span>
  <button class="icon-btn" aria-label="Theme">◐</button>
  <button class="icon-btn" aria-label="Help">?</button>
  <span class="avatar">SP</span>
</header>`;

export const statusbar = (right = '') => `
<footer class="statusbar">
  <span class="ok">● validate: 0 new violations</span><span>5 baseline</span><span>Saved · in sync with disk</span>
  <span class="spacer"></span>${right}<span>qwen2.5-coder:7b</span><span><kbd>Ctrl J</kbd> drawer</span><span><kbd>?</kbd> shortcuts</span>
</footer>`;

export const drawerBar = (on, counts = ['3', '', '2']) =>
  tabs([['Diagnostics', [counts[0], 'danger']], ['Logs', null], ['Processes', [counts[2], 'acc']]], on);

export const tree = (mode) => {
  const features = `
  <div class="sect">Features · 4</div>
  <div class="tree">
    <div class="row"><span class="twisty">▾</span>auth<span class="meta">7 files</span></div>
    <div class="row l1"><span class="twisty">▾</span>pages</div>
    <div class="row l2 sel"><span class="layer page">page</span>login</div>
    <div class="row l2"><span class="layer page">page</span>register</div>
    <div class="row l1"><span class="twisty">▾</span>components</div>
    <div class="row l2"><span class="layer component">component</span>LoginForm</div>
    <div class="row l2"><span class="layer component">component</span>PasswordField</div>
    <div class="row l1"><span class="twisty">▸</span>workflows<span class="meta">1</span></div>
    <div class="row l1"><span class="twisty">▸</span>services · hooks · domain</div>
    <div class="row"><span class="twisty">▸</span>cart<span class="meta">11 files</span></div>
    <div class="row"><span class="twisty">▸</span>checkout<span class="meta">9 files</span></div>
    <div class="row"><span class="twisty">▸</span>catalog<span class="meta">14 files</span></div>
  </div>`;
  const pages = `
  <div class="sect">Pages · 6</div>
  <div class="tree">
    ${['/', '/login', '/register', '/cart', '/checkout', '/products/[id]'].map((p, i) => `<div class="row ${i === 1 ? 'sel' : ''}"><span class="layer page">page</span>${p}<span class="meta">${['catalog', 'auth', 'auth', 'cart', 'checkout', 'catalog'][i]}</span></div>`).join('')}
  </div>`;
  const wf = `
  <div class="sect">Workflows · 3</div>
  <div class="tree">
    <div class="row"><span class="layer workflow">machine</span>authMachine<span class="meta">auth</span></div>
    <div class="row sel"><span class="layer workflow">machine</span>cartMachine<span class="meta">cart</span></div>
    <div class="row"><span class="layer workflow">machine</span>checkoutMachine<span class="meta">checkout</span></div>
  </div>`;
  const body = mode === 'workflows' ? wf : mode === 'pages' ? pages : features;
  const which = mode === 'workflows' ? 'Workflows' : mode === 'pages' ? 'Pages' : 'Features';
  return `
  <div class="pane-h"><span class="title">Browser</span><span class="spacer"></span><button class="icon-btn" aria-label="New">+</button><button class="icon-btn" aria-label="Collapse pane">«</button></div>
  ${tabs([['Features'], ['Pages'], ['Workflows']], which)}
  <div class="search">⌕ Filter <span class="spacer"></span><kbd>/</kbd></div>
  <div class="scroll">${body}</div>`;
};

/** The 3-pane frame. Panes are slots: pass any markup for left / mid / right / drawer. */
export const shell = ({ mode = 'Explore', left, mid, right, drawer, dim = false, overlay = '', drawerH = 132, procs, lw, rw }) => `
<div class="shell ${dim ? 'dim' : ''}" style="${lw ? `--lw:${lw}px;` : ''}${rw ? `--rw:${rw}px;` : ''}grid-template-rows:44px 1fr ${drawerH}px 24px">
  ${topbar(mode, procs)}
  <div class="main">
    <aside class="pane" aria-label="Browser">${left}</aside><div class="resizer" role="separator" aria-orientation="vertical" tabindex="0"></div>
    <section class="pane mid" aria-label="Preview">${mid}</section><div class="resizer" role="separator" aria-orientation="vertical" tabindex="0"></div>
    <aside class="pane" aria-label="Tools">${right}</aside>
  </div>
  <div class="drawer" aria-label="Drawer">${drawer}</div>
  ${statusbar()}
</div>${overlay}`;

export const stateCard = (icon, h, p, extra = '') =>
  `<div class="state-card"><div class="ico">${icon}</div><h5>${h}</h5><p>${p}</p>${extra}</div>`;
