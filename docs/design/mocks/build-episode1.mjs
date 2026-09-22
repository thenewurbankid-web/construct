// Concept mocks for [Demo Guide] #472 / [Design] Episode 1 Part 1 (episode1.css).
// Usage: node docs/design/mocks/build-episode1.mjs && node docs/design/mocks/render.mjs episode1-
// Sample project is the same fixture used across the other IA mocks (storefront: auth / cart /
// checkout / catalog); the shop page and wishlist live in the existing "catalog" feature.
// Shop-page markup and class names are adapted from Start Bootstrap "Shop Homepage" / "Shop Item"
// (MIT licensed, https://github.com/StartBootstrap/startbootstrap-shop-homepage and
// .../startbootstrap-shop-item — LICENSE files fetched and verified 2026-09-22), simplified for a
// static mock. The wishlist heart, counter and panel are new, drawn to match that template's own
// look (Bootstrap-ish serif/sans mix, warm palette), not Cockpit tokens — see episode1.css header.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tabs } from './parts.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const page = (title, body) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title} - Concept</title>
<link rel="stylesheet" href="mock.css"><link rel="stylesheet" href="ia.css"><link rel="stylesheet" href="episode1.css">
<script>document.documentElement.dataset.theme = new URLSearchParams(location.search).get('theme') || 'dark';</script>
</head><body>
<div class="concept">Concept - not implemented <span>${title}</span></div>
${body}
</body></html>`;

const SCREENS = ['Features', 'Pages', 'Components', 'Git', 'Tests'];
const topbar = (screen) => `
<header class="topbar" role="banner">
  <div class="brand"><i></i>Cockpit</div>
  <button class="chip-btn" aria-haspopup="listbox">storefront <span class="sub">main</span> &#9662;</button>
  <nav class="snav" aria-label="Screens">${SCREENS.map((s) => `<a class="${s === screen ? 'on' : ''}" ${s === screen ? 'aria-current="page"' : ''}>${s}</a>`).join('')}</nav>
  <button class="chip-btn palette-trigger"><span>Search or run a command...</span><kbd>Ctrl K</kbd></button>
  <span class="pill run"><span class="spin"></span>1 running</span>
  <button class="acct" aria-haspopup="true" aria-expanded="false"><span class="avatar">SP</span>shashank-p &#9662;</button>
</header>`;

const statusbar = `<footer class="statusbar"><span class="ok">&#9679; validate: 0 new violations</span><span>Notes saved on this machine</span><span class="spacer"></span><span>qwen2.5-coder:7b</span><span><kbd>F6</kbd> next panel</span><span><kbd>Ctrl J</kbd> bottom panel</span></footer>`;

const bottom = (body, h = 110) => `
<div class="drawer" aria-label="Bottom panel: Run" style="height:${h}px">
  ${tabs([['Processes', ['1', 'acc']], ['Approvals', ['0', '']], ['Diagnostics', ['2', 'danger']], ['Logs', null]], 'Processes')}
  <div class="body">${body}</div>
</div>`;

const procRow = `<table><tr><th>Process</th><th>Project</th><th>Status</th><th></th></tr>
<tr><td><b>dev server &middot; storefront</b> <span class="tag det">Deterministic</span></td><td>storefront (inside the workspace)</td><td>running on :5173 &middot; 6 min</td><td><button class="btn sm">Restart</button> <button class="btn sm danger">Stop</button></td></tr></table>`;

const frame = ({ screen, left, mid, right, bot = bottom(procRow), lw, rw, botH = 110 }) => `
<div class="shell" style="${lw ? `--lw:${lw}px;` : ''}${rw ? `--rw:${rw}px;` : ''}grid-template-rows:44px 1fr ${botH}px 24px;position:relative">
  ${topbar(screen)}
  <div class="ia-main">
    <aside class="pane" aria-label="Left panel: Browse">${left}</aside><div class="resizer" role="separator" aria-orientation="vertical" tabindex="0"></div>
    <section class="pane mid" aria-label="Center stage">${mid}</section><div class="resizer" role="separator" aria-orientation="vertical" tabindex="0"></div>
    <aside class="pane" aria-label="Right panel: Inspect">${right}</aside>
  </div>
  ${bot}
  ${statusbar}
</div>`;

/* ---- shared: the catalog feature tree, with the frozen shop files marked ---- */
const catalogTree = (sel) => `
  <div class="pane-h"><span class="title">Components</span><span class="spacer"></span><button class="icon-btn" aria-label="New">+</button><button class="icon-btn" aria-label="Collapse">&laquo;</button></div>
  ${tabs([['Components'], ['Workflows']], 'Components')}
  <div class="search">&#8981; Filter <span class="spacer"></span><kbd>/</kbd></div>
  <div class="scroll">
  <div class="sect">catalog &middot; 6</div>
  <div class="tree">
    <div class="row l1 ${sel === 'ShopHome' ? 'sel' : ''}"><span class="layer page">page</span>ShopHome<span class="nbs"><span class="frozen-tag">&#128274; frozen</span></span></div>
    <div class="row l1 ${sel === 'WishlistHeartButton' ? 'sel' : ''}"><span class="layer component">component</span>WishlistHeartButton<span class="nbs"><span class="frozen-tag">&#128274; frozen</span><span class="nd find" title="Prop-link finding"></span></span></div>
    <div class="row l1"><span class="layer component">component</span>WishlistPanel<span class="nbs"><span class="frozen-tag">&#128274; frozen</span></span></div>
    <div class="row l1"><span class="layer component">component</span>CartDrawer</div>
    <div class="row l1"><span class="layer controller">controller</span>WishlistController</div>
    <div class="row l1"><span class="layer workflow">workflow</span>wishlistMachine<span class="nbs"><span class="nb note">no block yet</span></span></div>
  </div></div>`;

/* ================================================================ 1: shop page embedded in Cockpit */
const shopMini = (heartOn = [1]) => `
<div class="sp-root" style="height:100%;border-radius:8px">
  <div class="sp-nav"><span class="sp-brand">North &amp; Pine</span><a class="on">Home</a><a>About</a><a>Shop</a><span class="sp-spacer"></span>
    <span class="sp-wish"><span class="sp-heart-ico">&#9825;</span>Wishlist<span class="sp-count">${heartOn.length}</span></span>
    <span class="sp-cart">&#128722; Cart<span class="sp-count">0</span></span></div>
  <div class="sp-hero"><h1>Shop in style</h1><p>Autumn arrivals, one page, no backend yet</p></div>
  <div class="sp-grid">
    ${['Fancy Product', 'Special Item', 'Sale Item', 'Popular Item'].map((n, i) => `
    <div class="sp-card">${i > 0 ? '<span class="sp-sale">Sale</span>' : ''}
      <div class="sp-heart ${heartOn.includes(i) ? 'on' : ''}">&#9825;</div>
      <div class="sp-img">450&times;300</div>
      <div class="sp-body"><h5>${n}</h5><div class="sp-price">${i > 0 ? '<span class="was">$50.00</span>' : ''}$${40 + i * 4}.00</div></div>
      <div class="sp-foot"><span class="sp-btn">${i === 0 ? 'View options' : 'Add to cart'}</span></div>
    </div>`).join('')}
  </div>
</div>`;

writeFileSync(join(here, 'episode1-shop-embedded.html'), page('Episode 1: the frozen shop page, wrapped in the Cockpit', frame({
  screen: 'Components',
  left: catalogTree('ShopHome'),
  mid: `<div class="etabs" role="tablist"><button role="tab" class="on" aria-selected="true">&#9679; Preview ShopHome</button><button role="tab">ShopHome.tsx</button></div>
   <div class="canvas-tb"><span class="crumbs">Components &rsaquo; catalog &rsaquo; <b>ShopHome</b></span><span class="devpill"><span class="dot"></span>:5173 running</span><span class="spacer"></span><span class="frozen-tag">&#128274; Frozen &middot; startbootstrap-shop-homepage (MIT)</span></div>
   <div class="stage" style="flex:1;padding:16px"><div class="device" style="width:100%;height:100%"><div class="bar"><i></i><i></i><i></i>&nbsp;&nbsp;ShopHome, on its own</div><div style="height:calc(100% - 30px)">${shopMini([1])}</div></div></div>`,
  right: `<div class="pane-h"><span class="title">Inspect</span></div>
   <div class="tabs" role="tablist"><button role="tab" class="on" aria-selected="true">Inspector</button><button role="tab">Source</button><button role="tab">Diff</button></div>
   <div class="scroll">
   <div class="section"><div class="el-head"><span class="name">ShopHome</span><span class="layer page">page</span><span class="frozen-tag">&#128274; frozen</span><span class="spacer"></span><button class="icon-btn" aria-label="More">&#8943;</button></div><div class="path">features/catalog/pages/ShopHome.tsx:1</div></div>
   <div class="frozen-note"><b>Frozen file &middot; read-only to Construct.</b> Declared in <code>architecture.yml</code> under <code>frozen:</code> (matches <code>startbootstrap-shop-homepage</code>'s vendored markup). <code>create</code>, <code>refactor</code> and <code>pipeline</code> refuse to touch it; a controller wraps it instead of forking it. Licence: MIT, shipped in <code>vendor/shop-template/LICENSE</code>.</div>
   <details class="dt" open><summary>Wrapped by <span class="c">1 controller</span></summary><div class="callsite"><span class="cf">WishlistController.tsx:9</span><span class="cn">Forwards <code>items</code>, <code>onToggle</code> — no markup of its own (PAGE-007 clear)</span></div></details>
   <details class="dt"><summary>Findings <span class="c warn">1</span></summary></details>
   </div>`,
})));

/* ================================================================ 2: full-screen shop grid */
const shopFullNav = `
<div class="sp-nav"><span class="sp-brand">North &amp; Pine</span><a class="on">Home</a><a>About</a><a>Shop</a><span class="sp-spacer"></span>
  <span class="sp-wish"><span class="sp-heart-ico">&#9825;</span>Wishlist<span class="sp-count">2</span></span>
  <span class="sp-cart">&#128722; Cart<span class="sp-count">0</span></span></div>`;
const shopCards = (n = 8) => Array.from({ length: n }, (_, i) => {
  const names = ['Fancy Product', 'Special Item', 'Sale Item', 'Popular Item', 'Weekend Tote', 'Linen Throw', 'Table Runner', 'Ceramic Vase'];
  const heartOn = [1, 6].includes(i);
  return `<div class="sp-card">${i % 3 === 1 ? '<span class="sp-sale">Sale</span>' : ''}
    <div class="sp-heart ${heartOn ? 'on' : ''}">&#9825;</div>
    <div class="sp-img">450&times;300</div>
    <div class="sp-body"><h5>${names[i % names.length]}</h5><div class="sp-price">${i % 3 === 1 ? '<span class="was">$50.00</span>' : ''}$${34 + i * 3}.00</div></div>
    <div class="sp-foot"><span class="sp-btn">${i % 4 === 0 ? 'View options' : 'Add to cart'}</span></div>
  </div>`;
}).join('');
const shopFullGrid = (n = 8) => `<div class="sp-grid">${shopCards(n)}</div>`;

writeFileSync(join(here, 'episode1-shop-fullscreen.html'), page('Episode 1: the shop page full screen (static, presentational)', `
<div class="rec-frame" style="left:100px;top:44px;width:1280px;height:720px"><span class="rf-tag">RECORDING COMPOSITE &middot; 1280&times;720</span></div>
<div class="sp-root" style="width:1440px;height:900px">
  ${shopFullNav}
  <div class="sp-hero"><h1>Shop in style</h1><p>North &amp; Pine &middot; a static template page, no backend behind it yet</p></div>
  ${shopFullGrid(8)}
  <div class="sp-license">Layout adapted from Start Bootstrap "Shop Homepage" / "Shop Item" (MIT) &middot; vendor/shop-template/LICENSE</div>
</div>`));

/* ================================================================ 3: wishlist panel states + narrow */
const wishItem = (n, p) => `<div class="sp-witem"><div class="sp-wimg"></div><div><div class="sp-wn">${n}</div><div class="sp-wp">$${p}</div></div><button class="sp-rm">Remove</button></div>`;
writeFileSync(join(here, 'episode1-shop-wishlist-states.html'), page('Episode 1: wishlist panel — empty, full, narrow', `
<div class="sheet3" style="grid-template-columns:1fr 1fr 340px">
 <div><h3>Wishlist &middot; empty</h3>
  <div class="sp-root" style="width:100%;height:640px">
    ${shopFullNav}${shopFullGrid(4)}
    <div class="sp-scrim"></div>
    <div class="sp-drawer"><div class="sp-dh">Wishlist<span class="sp-x">&times;</span></div>
      <div class="sp-wempty"><span class="sp-heart-big">&#9825;</span>Your wishlist is empty.<br>Tap the heart on any product to save it here.</div>
    </div>
  </div></div>
 <div><h3>Wishlist &middot; with items</h3>
  <div class="sp-root" style="width:100%;height:640px">
    ${shopFullNav}${shopFullGrid(4)}
    <div class="sp-scrim"></div>
    <div class="sp-drawer"><div class="sp-dh">Wishlist<span class="sp-x">&times;</span></div>
      ${wishItem('Special Item', '18.00')}${wishItem('Weekend Tote', '52.00')}
      <div class="sp-dfoot"><span class="sp-btn">Move all to cart</span></div>
    </div>
  </div></div>
 <div><h3>Narrow (390px)</h3>
  <div class="sp-root" style="width:340px;height:640px;margin:0 auto">
    <div class="sp-nav" style="padding:10px 14px"><span class="sp-brand" style="font-size:15px">North &amp; Pine</span><span class="sp-spacer"></span><span class="sp-heart-ico" style="position:relative">&#9825;<span class="sp-count" style="position:absolute;top:-6px;right:-10px">2</span></span></div>
    <div class="sp-hero" style="padding:22px 16px"><h1 style="font-size:22px">Shop in style</h1></div>
    <div class="sp-grid sp-narrow">${shopCards(4)}</div>
    <div class="sp-mobbar"><div class="on">Home</div><div>Shop</div><div>Wishlist</div><div>Cart</div></div>
  </div></div>
</div>`));

/* ================================================================ 4: missing-prop evidence, Components screen */
writeFileSync(join(here, 'episode1-missing-prop-components.html'), page('Episode 1: the missing prop, seen from Components', frame({
  screen: 'Components',
  left: catalogTree('WishlistHeartButton'),
  mid: `<div class="etabs" role="tablist"><button role="tab" class="on" aria-selected="true">&#9679; Preview WishlistHeartButton</button><button role="tab">WishlistHeartButton.tsx</button></div>
   <div class="canvas-tb"><span class="crumbs">Components &rsaquo; catalog &rsaquo; <b>WishlistHeartButton</b></span><span class="spacer"></span><span class="frozen-tag">&#128274; Frozen</span></div>
   <div class="stage" style="flex:1;place-items:start center;padding:16px"><div class="device" style="height:210px;width:260px"><div class="bar"><i></i><i></i><i></i>&nbsp;&nbsp;WishlistHeartButton, on its own</div>
    <div style="height:calc(100% - 30px);display:grid;place-items:center;background:#faf7f2"><div class="sp-heart on" style="position:static">&#9825;</div></div></div></div>`,
  right: `<div class="pane-h"><span class="title">Inspect</span></div>
   <div class="tabs" role="tablist"><button role="tab" class="on" aria-selected="true">Inspector</button><button role="tab">Used by <span class="badge ">2</span></button><button role="tab">Source</button></div>
   <div class="scroll">
   <div class="section"><div class="el-head"><span class="name">WishlistHeartButton</span><span class="layer component">component</span><span class="frozen-tag">&#128274; frozen</span><span class="spacer"></span><button class="icon-btn" aria-label="More">&#8943;</button></div><div class="path">features/catalog/components/WishlistHeartButton.tsx:6</div></div>
   <details class="dt" open><summary>Props <span class="c">3</span></summary>
     <div class="prop"><span class="k">productId</span><span class="field">string</span><span class="bind lit">required</span></div>
     <div class="prop"><span class="k">active</span><span class="field">boolean</span><span class="bind lit">required</span></div>
     <div class="prop gap"><span class="k">onToggle</span><span class="field">(id: string) =&gt; void</span><span class="propchip"><span class="dt3"></span>never passed &middot; 1 of 2 uses</span></div>
     <div style="margin-top:6px"><button class="btn sm">+ Add prop</button></div>
   </details>
   <details class="dt" open><summary>Used by <span class="c">2</span></summary>
     <div class="callsite"><span class="cf">ShopHome.tsx:88</span><span class="cn warn">productId, active passed &middot; <b>onToggle not passed</b> — clicking the heart does nothing yet</span></div>
     <div class="callsite"><span class="cf">CartDrawer.tsx:41</span><span class="cn llm">passes <code>size="sm"</code> — not a declared prop, forwarded as a DOM attribute</span></div>
   </details>
   <details class="dt"><summary>Findings <span class="c warn">2</span></summary></details>
   </div>`,
  bot: bottom(`<table><tr><th>Rule</th><th>File</th><th>Severity</th><th></th></tr>
   <tr><td>PROP-LINK &middot; prop declared, never passed</td><td>ShopHome.tsx:88</td><td><span class="tag" style="background:var(--warn-soft);color:var(--warn)">Info</span></td><td><button class="btn sm">Go to source</button></td></tr>
   <tr><td>PROP-LINK &middot; prop passed, not declared</td><td>CartDrawer.tsx:41</td><td><span class="tag" style="background:var(--warn-soft);color:var(--warn)">Info</span></td><td><button class="btn sm">Go to source</button></td></tr></table>`, 132),
})));

/* ================================================================ 5: missing-prop evidence, Pages editor */
writeFileSync(join(here, 'episode1-missing-prop-pages.html'), page('Episode 1: the missing prop, seen from the Pages editor', frame({
  screen: 'Pages',
  left: `<div class="pane-h"><span class="title">Pages</span><span class="spacer"></span><button class="icon-btn" aria-label="Collapse">&laquo;</button></div>
   ${tabs([['Pages'], ['Flow']], 'Pages')}
   <div class="search">&#8981; Filter <span class="spacer"></span><kbd>/</kbd></div>
   <div class="scroll"><div class="sect">Pages &middot; 6</div><div class="tree">
    <div class="row l1 sel"><span class="layer page">page</span>/shop<span class="meta">catalog</span></div>
    <div class="row l1"><span class="layer page">page</span>/cart<span class="meta">cart</span></div>
    <div class="row l1"><span class="layer page">page</span>/checkout<span class="meta">checkout</span></div>
   </div></div>`,
  mid: `<div class="etabs" role="tablist"><button role="tab" class="on" aria-selected="true">&#9679; Preview /shop</button><button role="tab">ShopHome.tsx</button></div>
   <div class="canvas-tb"><span class="crumbs">Pages &rsaquo; /shop &rsaquo; <b>WishlistHeartButton</b></span><span class="devpill"><span class="dot"></span>:5173 running</span><span class="spacer"></span><button class="tg" aria-pressed="true">&#8853; Pick</button></div>
   <div class="stage" style="flex:1;padding:16px"><div class="device" style="width:100%;height:100%;position:relative"><div class="bar"><i></i><i></i><i></i>&nbsp;&nbsp;/shop, selecting a node</div>
    <div style="height:calc(100% - 30px);position:relative">${shopMini([1])}
      <div class="ghost" style="left:calc(25% - 8px);top:56px;width:34px;height:34px;border-radius:50%"></div>
      <div class="ghost-tag" style="left:calc(25% - 8px);top:38px">WishlistHeartButton</div>
    </div></div></div>`,
  right: `<div class="pane-h"><span class="title">Inspect</span></div>
   <div class="tabs" role="tablist"><button role="tab" class="on" aria-selected="true">Inspector</button><button role="tab">Source</button></div>
   <div class="scroll">
   <div class="section"><div class="el-head"><span class="name">&lt;WishlistHeartButton&gt;</span><span class="layer component">component</span><span class="spacer"></span></div><div class="path">features/catalog/pages/ShopHome.tsx:88</div></div>
   <div class="pf set"><div class="pfh"><span class="k">productId</span><span class="field">string</span></div><span class="val">p.id</span></div>
   <div class="pf set"><div class="pfh"><span class="k">active</span><span class="field">boolean</span></div><span class="val">p.wishlisted</span></div>
   <div class="pf unwired"><div class="pfh"><span class="k">onToggle</span><span class="field">(id: string) =&gt; void</span><span class="propchip"><span class="dt3"></span>required, not wired</span></div>
     <div class="why">Declared on WishlistHeartButton, never bound here. The heart renders but does nothing when clicked.</div>
     <span class="gen " role="group" aria-label="Generate"><span class="mode" role="radiogroup" aria-label="How"><button role="radio" aria-checked="true" class="on det">Mechanical</button><button role="radio" aria-checked="false" class="">AI</button></span><button class="go">Wire onToggle</button></span>
   </div>
   </div>`,
})));

/* ================================================================ 6: feature-tour highlight callout */
writeFileSync(join(here, 'episode1-highlight-callout.html'), page('Episode 1: feature-tour highlight — ring + label beside, never over', `
<div class="rec-frame" style="left:80px;top:44px;width:1280px;height:720px"><span class="rf-tag">RECORDING COMPOSITE &middot; 1280&times;720 &middot; ring + label stay inside this line</span></div>
${frame({
  screen: 'Components',
  left: catalogTree('WishlistHeartButton'),
  mid: `<div class="etabs" role="tablist"><button role="tab" class="on" aria-selected="true">&#9679; Preview WishlistHeartButton</button><button role="tab">WishlistHeartButton.tsx</button></div>
   <div class="canvas-tb"><span class="crumbs">Components &rsaquo; catalog &rsaquo; <b>WishlistHeartButton</b></span><span class="spacer"></span><span class="frozen-tag" id="ep1-frozen-chip">&#128274; Frozen</span></div>
   <div class="stage" style="flex:1;place-items:start start;padding:16px"><div class="device" style="height:170px;width:220px"><div class="bar"><i></i><i></i><i></i>&nbsp;&nbsp;WishlistHeartButton</div>
    <div style="height:calc(100% - 30px);display:grid;place-items:center;background:#faf7f2"><div class="sp-heart on" style="position:static">&#9825;</div></div></div></div>`,
  right: `<div class="pane-h"><span class="title">Inspect</span></div>
   <div class="tabs" role="tablist"><button role="tab" class="on" aria-selected="true">Inspector</button><button role="tab">Used by <span class="badge ">2</span></button><button role="tab">Source</button></div>
   <div class="scroll">
   <div class="section"><div class="el-head"><span class="name">WishlistHeartButton</span><span class="layer component">component</span><span class="frozen-tag">&#128274; frozen</span></div><div class="path">features/catalog/components/WishlistHeartButton.tsx:6</div></div>
   <details class="dt" open><summary>Props <span class="c">3</span></summary>
     <div class="prop"><span class="k">productId</span><span class="field">string</span><span class="bind lit">required</span></div>
     <div class="prop"><span class="k">active</span><span class="field">boolean</span><span class="bind lit">required</span></div>
     <div class="prop gap"><span class="k">onToggle</span><span class="field">(id: string) =&gt; void</span><span class="propchip"><span class="dt3"></span>never passed</span></div>
   </details>
   </div>`,
  bot: bottom(`<table><tr><th>Rule</th><th>File</th><th>Severity</th><th></th></tr>
   <tr><td>PROP-LINK &middot; prop declared, never passed</td><td>ShopHome.tsx:88</td><td><span class="tag" style="background:var(--warn-soft);color:var(--warn)">Info</span></td><td></td></tr></table>`, 110),
})}
<!-- All three labels sit in the one big empty area of the stage (below the small preview device),
     with a dotted connector reaching back to the small real target wherever it is on screen. This
     is the general pattern: the ring hugs the target exactly; the label finds the nearest open
     space and never sits on top of dense text, even if that means a longer connector line. -->

<!-- Callout 1: the frozen chip in the canvas toolbar (top-right of the mid pane) -->
<div class="tour-ring" style="left:1000px;top:104px;width:54px;height:20px"></div>
<div class="tour-connector" style="left:900px;top:280px;width:100px;transform:rotate(58deg);transform-origin:0 0"></div>
<div class="tour-label" style="left:660px;top:290px;width:220px"><b>Frozen UI</b>Your template, wrapped &mdash; Construct never rewrites it.</div>

<!-- Callout 2: the prop-link finding on the onToggle row, in the right Inspector -->
<div class="tour-ring" style="left:1071px;top:283px;width:355px;height:52px"></div>
<div class="tour-connector" style="left:970px;top:340px;width:110px;transform:rotate(18deg);transform-origin:0 0"></div>
<div class="tour-label" style="left:660px;top:352px;width:300px"><b>Prop-link check</b>Deterministic &mdash; computed by comparing declared props to every call site, before any model runs.</div>

<!-- Callout 3: the Diagnostics tab + count, top of the bottom panel -->
<div class="tour-ring" style="left:227px;top:762px;width:118px;height:26px"></div>
<div class="tour-connector" style="left:345px;top:775px;width:280px;transform:rotate(-5deg);transform-origin:0 0"></div>
<div class="tour-label" style="left:626px;top:430px;width:260px"><b>Findings, not failures</b>Calm and plain-language: what to fix, shown as a chip &mdash; never a red wall.</div>

<div class="tour-anatomy" style="left:302px;top:470px;width:300px">
  <b>Anatomy (tokens only)</b>
  Ring: 2px <code>--accent</code> border + 4px <code>--accent-soft</code> glow, offset ~4px outside the target, never overlapping it.<br>
  Connector: dotted 2px <code>--accent</code>, angled to the nearest open space.<br>
  Label: <code>--surface-2</code> card, 1px <code>--accent</code> border, max 300px wide, always beside the ring, never over dense text.<br>
  Motion: fade+scale in 150ms, hold 2&ndash;3s, fade out 150ms; reduced motion drops the scale and pulse, keeping only the fade.
</div>
`));

console.log('built episode1-*.html');
