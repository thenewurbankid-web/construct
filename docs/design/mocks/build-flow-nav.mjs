// Concept mocks for the flow tree (#328) and click-to-navigate (#321) — one interaction family:
// a row in the flow tree IS an import that resolves, i.e. a reference that can be a link.
// Usage: node docs/design/mocks/build-flow-nav.mjs && node docs/design/mocks/render.mjs flow-nav
// Feature names (refunds, orders, ui-kit, catalog) are illustrative storefront content, not repo output.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tabs, drawerBar, shell, stateCard } from './parts.mjs';

const page = (title, body) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title} — Concept</title>
<link rel="stylesheet" href="mock.css"><link rel="stylesheet" href="flow-nav.css">
<script>document.documentElement.dataset.theme = new URLSearchParams(location.search).get('theme') || 'dark';</script>
</head><body>
<div class="concept">Concept — not implemented <span>${title}</span></div>
${body}
</body></html>`;
const here = dirname(fileURLToPath(import.meta.url));

/* ---------------------------------------------------------------- tree */
const L = (k) => `<span class="layer ${k}">${k}</span>`;
const row = (lvl, layer, name, o = {}) => {
  const cls = ['row', 'frow', `l${lvl}`, o.shared ? 'shared' : '', o.sel ? 'sel' : '', o.rel ? `rel-${o.rel}` : '', o.hov ? 'hov' : ''].join(' ');
  const tw = o.tw ? `<span class="twisty">${o.tw}</span>` : '';
  const tag = o.rel === 'uses' ? '<span class="rtag uses">selection uses this</span>' : o.rel === 'usedby' ? '<span class="rtag usedby">uses selection</span>' : '';
  return `<div class="${cls}" ${o.sel ? 'aria-selected="true"' : ''}>${tw}${L(layer)}<span class="nm">${name}</span>${o.shared ? '<span class="above">↑ shown above</span>' : ''}${tag}</div>`;
};
const branch = (lvl, label) => `<div class="row l${lvl} branch"><span class="twisty">▾</span>${label}</div>`;

const controllerTree = (which, o = {}) => {
  if (which === 'refunds') return `
    <div class="row l1 frow ${o.ctl || ''}"><span class="twisty">▾</span>${L('controller')}<span class="nm">refundController</span><span class="feat">refunds</span>${o.ctlTag || ''}</div>
    ${branch(2, 'Behaviour path')}
    ${row(3, 'hook', 'useRefundForm', { tw: '▾', rel: o.hookRel })}
    ${row(4, 'workflow', 'refundMachine', { tw: '▾', sel: o.machineSel })}
    ${row(5, 'service', 'refundService', { tw: '▾', rel: o.svcRel })}
    ${row(6, 'domain', 'refundRules', { rel: o.rulesRel })}
    ${row(4, 'domain', 'refundRules', { shared: true })}
    ${branch(2, 'Render path')}
    ${row(3, 'page', 'RefundPage', { tw: '▾' })}
    ${row(4, 'component', 'RefundForm', { tw: '▾' })}
    ${row(5, 'component', 'AmountField', { hov: o.hovAmount })}
    ${row(4, 'component', 'ReasonPicker')}`;
  return `
    <div class="row l1 frow"><span class="twisty">${o.collapsed ? '▸' : '▾'}</span>${L('controller')}<span class="nm">orderSummaryController</span><span class="feat">orders</span></div>${o.collapsed ? '' : `
    ${branch(2, 'Behaviour path')}
    ${row(3, 'hook', 'useOrder', { tw: '▾' })}
    ${row(4, 'service', 'orderService')}
    ${branch(2, 'Render path')}
    ${row(3, 'component', 'OrderSummary')}`}`;
};

const noRoute = `
  <div class="sect" style="padding-top:12px">Not entered from any route · 1</div>
  <div class="tree">
    <div class="row frow"><span class="twisty">▸</span><span class="nm">ui-kit</span><span class="meta">6 files</span></div>
    <div class="note"><span class="i">i</span><span><b>No route reaches this feature.</b> That is fine for a shared library: it is used by other features, not entered from a URL.</span></div>
  </div>`;

const flowPane = (o = {}) => `
  <div class="pane-h"><span class="title">Browser</span><span class="spacer"></span><button class="icon-btn" aria-label="Collapse pane">«</button></div>
  <div class="seg wide" role="radiogroup" aria-label="Browser view"><button role="radio" aria-checked="false">Files</button><button class="on" role="radio" aria-checked="true">Flow</button></div>
  <div class="prov"><span class="tag det">Deterministic</span>Computed from imports. Nothing is moved.</div>
  <div class="search">⌕ Filter routes, features, files <span class="spacer"></span><kbd>/</kbd></div>
  <div class="scroll" style="position:relative">
    <div class="tree">
      <div class="row frow"><span class="twisty">▾</span><span class="layer route">route</span><span class="nm" style="font-weight:600">/refunds/new</span><span class="meta">2 features</span></div>
      <div class="fan">
        ${controllerTree('refunds', o)}
        ${controllerTree('orders', { collapsed: true })}
      </div>
      <div class="row frow" style="margin-top:4px"><span class="twisty">▸</span><span class="layer route">route</span><span class="nm">/orders/[id]</span><span class="meta">1 feature</span></div>
      <div class="row frow"><span class="twisty">▸</span><span class="layer route">route</span><span class="nm">/</span><span class="meta">1 feature</span></div>
    </div>
    ${noRoute}
    ${o.tip || ''}
  </div>`;

const refundPreview = `
<div class="device" style="height:470px">
  <div class="bar"><i></i><i></i><i></i>&nbsp;&nbsp;localhost:5173/refunds/new</div>
  <div class="app-nav"><b>Storefront</b><span>Orders</span><span>Refunds</span></div>
  <div class="login" style="margin-top:26px">
    <h2>Request a refund</h2><p>Order #4821 · 2 items</p>
    <label>Amount</label><div class="in">£64.00</div>
    <label>Reason</label><div class="in">Item arrived damaged</div>
    <div class="cta">Submit request</div>
  </div>
</div>`;
const canvasTb = (crumb) => `<div class="canvas-tb"><span class="crumbs">Route <b>/refunds/new</b>${crumb ? ` › ${crumb}` : ''}</span><span class="spacer"></span><div class="seg"><button class="on">Desktop</button><button>Tablet</button><button>Phone</button></div></div>`;

const diag = `${drawerBar('Diagnostics', ['0', '', '0'])}<div class="body"><div class="logline" style="padding-top:8px"><time>14:20:02</time><span class="lv-ok">ok</span>flow: 3 routes, 4 features, 22 files traced from imports (types.ts and index.ts left out)</div></div>`;

/* 1 — Browser pane, Flow view */
writeFileSync(join(here, 'flow-nav-browser.html'), page('Browser pane — Flow view: a route fans out to its features', shell({
  mode: 'Explore', lw: 460,
  left: flowPane(),
  mid: `${canvasTb('')}<div class="stage">${refundPreview}</div><div class="canvas-foot">Preview of the selected route<span class="spacer"></span>Routes are the roots. Folders are untouched.</div>`,
  right: `${tabs([['Inspector'], ['Scope'], ['Source'], ['Flow']], 'Flow')}<div class="scroll">
   <div class="section"><div class="el-head"><span class="layer route">route</span><span class="name mono" style="font-size:15px;font-weight:700">/refunds/new</span></div>
   <div class="path" style="margin-top:4px">app/refunds/new/page.tsx</div></div>
   <div class="section"><h4>Renders</h4>
     <div class="kv" style="margin-bottom:6px"><span class="feat">refunds</span>refundController</div>
     <div class="kv"><span class="feat">orders</span>orderSummaryController</div>
     <div style="color:var(--text-muted);margin-top:8px">One route may render controllers from several features. Both are shown beneath it.</div></div>
   <div class="section"><h4>Entered from</h4><div style="color:var(--text-muted)">Link on <span class="mono">/orders/[id]</span> · Menu "Refunds"</div></div>
  </div>`,
  drawer: diag, drawerH: 96,
})));

/* 2 — selection + hover */
const tip = `<div class="tip" style="left:120px;top:322px" role="tooltip"><div class="rel">component<span class="arr">→</span>component</div>
  <b style="color:var(--text)">RefundForm</b> shows one <b style="color:var(--text)">AmountField</b> for the refund amount. It is not tied to the selected workflow.
  <div class="k">features/refunds/components/AmountField.tsx · Ctrl+click to open</div></div>`;
const mCode = [['1', `<span class="k1">import</span> { <span class="k2">refundService</span> } <span class="k1">from</span> <span class="k3">'../services/refundService'</span>;`], ['2', `<span class="k1">import</span> { <span class="k2">canRefund</span> } <span class="k1">from</span> <span class="k3">'../domain/refundRules'</span>;`], ['3', ''], ['4', `<span class="k1">export const</span> <span class="k2">refundMachine</span> = createMachine({`], ['5', `  id: <span class="k3">'refund'</span>, initial: <span class="k3">'editing'</span>,`], ['6', `  states: { editing: {…}, submitting: {…}, done: {…} },`], ['7', '});']];
writeFileSync(join(here, 'flow-nav-selection.html'), page('Flow view — selecting a row tags what it uses and what uses it', shell({
  mode: 'Explore', lw: 460,
  left: flowPane({ hovAmount: true, machineSel: true, svcRel: 'uses', rulesRel: 'uses', hookRel: 'usedby', ctl: 'rel-usedby', ctlTag: '<span class="rtag usedby">uses selection</span>', tip }),
  mid: `${canvasTb('refundMachine')}<div class="ed" style="margin-top:12px"><div class="fname">features/refunds/workflows/refundMachine.ts</div><div class="code">${mCode.map(([n, t]) => `<div class="ln"><i>${n}</i><span>${t}</span></div>`).join('')}</div></div>`,
  right: `${tabs([['Inspector'], ['Scope'], ['Source'], ['Flow']], 'Flow')}<div class="scroll">
   <div class="section"><div class="el-head"><span class="layer workflow">workflow</span><span class="name">refundMachine</span></div><div class="path" style="margin-top:4px">features/refunds/workflows/refundMachine.ts</div></div>
   <div class="section"><h4>Selection uses this · 2</h4>
     <div class="kv" style="margin-bottom:4px"><span class="tag det">workflow → service</span>refundService</div>
     <div class="kv"><span class="tag det">service → domain</span>refundRules</div></div>
   <div class="section"><h4>Uses selection · 2</h4>
     <div class="kv" style="margin-bottom:4px"><span class="tag human">hook → workflow</span>useRefundForm</div>
     <div class="kv"><span class="tag human">controller → hook</span>refundController</div></div>
   <div class="section"><h4>Entered from</h4><div style="color:var(--text-muted)"><span class="mono">/refunds/new</span></div></div></div>`,
  drawer: diag, drawerH: 96,
})));

/* 3 — Pages editor: links vs plain text */
const homeLines = [
  ['1', `<span class="k1">import</span> { <span class="ref">PriceCard</span> } <span class="k1">from</span> <span class="k3">'../components/PriceCard'</span>;`],
  ['2', `<span class="k1">import</span> { <span class="ref">SectionHeading</span> } <span class="k1">from</span> <span class="k3">'../components/SectionHeading'</span>;`],
  ['3', `<span class="k1">import</span> { <span class="plain">Tooltip</span> } <span class="k1">from</span> <span class="k3">'@acme/legacy-ui'</span>;`],
  ['4', ''],
  ['5', `<span class="k1">export function</span> <span class="k2">HomePage</span>({ products, kind }: Props) {`],
  ['6', `  <span class="k1">const</span> Banner = banners[kind];`],
  ['7', `  <span class="k1">return</span> (`],
  ['8', `    &lt;<span class="k2">main</span>&gt;`],
  ['9', `      &lt;<span class="ref">SectionHeading</span> title=<span class="k3">"New this week"</span> /&gt;`],
  ['10', `      {products.map((p) =&gt; &lt;<span class="ref hot">PriceCard</span> key={p.id} product={p} /&gt;)}`, 'hl'],
  ['11', `      &lt;<span class="plain">Tooltip</span> text=<span class="k3">"Prices include VAT"</span> /&gt;`],
  ['12', `      &lt;<span class="plain">Banner</span> /&gt;`],
  ['13', `    &lt;/<span class="k2">main</span>&gt;`],
];
const codeBlock = (lines) => `<div class="code">${lines.map(([n, t, c]) => `<div class="ln ${c || ''}"><i>${n}</i><span>${t}</span></div>`).join('')}</div>`;
const linksTip = `<div class="tip" style="left:330px;top:230px" role="tooltip"><div class="rel">page<span class="arr">→</span>component</div>
  <b style="color:var(--text)">PriceCard</b> is a component in the <b style="color:var(--text)">catalog</b> feature. This page shows one for every product.
  <div class="k">Ctrl+click to open here · Alt+Left comes back</div></div>`;
const info = 'background:var(--accent-soft);color:var(--accent)';
writeFileSync(join(here, 'flow-nav-links.html'), page('Pages editor — resolvable references are links, unresolved ones are plain text', shell({
  mode: 'Explore',
  left: `<div class="pane-h"><span class="title">Browser</span></div>${tabs([['Features'], ['Pages'], ['Workflows']], 'Pages')}<div class="scroll"><div class="sect">Pages · 6</div><div class="tree">${['/', '/login', '/cart'].map((p, i) => `<div class="row ${i === 0 ? 'sel' : ''}"><span class="layer page">page</span>${p}</div>`).join('')}</div></div>`,
  mid: `<div class="canvas-tb"><span class="crumbs">catalog › pages › <b>HomePage</b></span><span class="spacer"></span><span class="kv"><kbd>Ctrl</kbd>+click to open a reference</span></div>
   <div class="ed" style="position:relative"><div class="fname">features/catalog/pages/HomePage.tsx</div>${codeBlock(homeLines)}${linksTip}</div>`,
  right: `${tabs([['Inspector'], ['Scope'], ['Source'], ['Flow']], 'Source')}<div class="scroll">
   <div class="cmp" style="grid-template-columns:1fr">
    <div class="card"><h6>Link — Construct resolved it</h6><div class="sample"><span class="ref">PriceCard</span></div>
      <p>Dotted underline at rest, solid on hover or while Ctrl is held, pointer cursor, relationship label on hover. The file was found when this view drew.</p></div>
    <div class="card"><h6>Plain text — could not be resolved</h6><div class="sample"><span class="plain">Tooltip</span></div>
      <p>Looks like ordinary code: no underline, no pointer, no hover label. Nothing to click, so nothing can fail.</p></div>
   </div>
   <div class="section"><h4>Not linked on this page · 2</h4>
     <div class="kv" style="margin-bottom:4px"><span class="mono plain">Tooltip</span> package outside the project</div>
     <div class="kv"><span class="mono plain">Banner</span> chosen at run time</div></div>
  </div>`,
  drawer: `${drawerBar('Diagnostics', ['0', '', '0'])}<div class="body"><table><tr><th>Level</th><th>Reference not linked</th><th>Why</th></tr>
   <tr><td><span class="tag" style="${info}">info</span></td><td class="mono">HomePage.tsx:3  Tooltip</td><td>Package @acme/legacy-ui is outside this project.</td></tr>
   <tr><td><span class="tag" style="${info}">info</span></td><td class="mono">HomePage.tsx:12  Banner</td><td>Component is picked at run time (banners[kind]).</td></tr></table></div>`,
  drawerH: 140,
})));

/* 4 — trail */
const trail = (crumbs, { back = true, fwd = false, hint = true } = {}) => `<div class="trail" role="navigation" aria-label="Navigation trail">
  <button class="nav" aria-label="Back (Alt+Left)" ${back ? '' : 'disabled'}>‹</button><button class="nav" aria-label="Forward (Alt+Right)" ${fwd ? '' : 'disabled'}>›</button>
  ${crumbs.map(([n, kind, hop], i) => `${i ? `<span class="hop">${hop || '›'}</span>` : ''}<button class="crumb ${kind}" ${kind === 'cur' ? 'aria-current="page"' : ''}>${n}</button>`).join('')}
  <span class="spacer"></span>${hint ? '<span class="kv"><kbd>Alt ←</kbd><kbd>Alt →</kbd></span>' : ''}</div>`;
const priceLines = [
  ['1', `<span class="k1">import</span> { <span class="ref">Badge</span> } <span class="k1">from</span> <span class="k3">'./Badge'</span>;`],
  ['2', `<span class="k1">export function</span> <span class="k2">PriceCard</span>({ product }: Props) {`],
  ['3', `  <span class="k1">return</span> &lt;<span class="k2">article</span>&gt;&lt;<span class="ref">Badge</span> tone=<span class="k3">"sale"</span> /&gt;{product.price}&lt;/<span class="k2">article</span>&gt;;`],
];
const badgeLines = [
  ['1', `<span class="k1">export function</span> <span class="k2">Badge</span>({ tone, children }: Props) {`],
  ['2', `  <span class="k1">return</span> &lt;<span class="k2">span</span> className={tone}&gt;{children}&lt;/<span class="k2">span</span>&gt;;`],
  ['3', `}`],
];
const fn = (p) => `<div class="fname">${p}</div>`;
writeFileSync(join(here, 'flow-nav-trail.html'), page('Pages editor — the trail after three hops, and after going back', shell({
  mode: 'Explore',
  left: `<div class="pane-h"><span class="title">Browser</span></div>${tabs([['Features'], ['Pages'], ['Workflows']], 'Pages')}<div class="scroll"><div class="sect">Pages · 6</div><div class="tree"><div class="row sel"><span class="layer page">page</span>/</div><div class="row"><span class="layer page">page</span>/login</div></div></div>`,
  mid: `<div class="stack">
    <div class="tcard" style="margin-top:12px"><div class="cap">A · After three hops (you are on Badge)</div>${trail([['HomePage', '', ''], ['PriceCard', '', 'page → component'], ['Badge', 'cur', 'component → component']])}${fn('features/catalog/components/Badge.tsx')}${codeBlock(badgeLines)}</div>
    <div class="tcard"><div class="cap">B · After Alt+Left (Badge stays as a forward step)</div>${trail([['HomePage', '', ''], ['PriceCard', 'cur', 'page → component'], ['Badge', 'fwd', 'component → component']], { back: true, fwd: true })}${fn('features/catalog/components/PriceCard.tsx')}${codeBlock(priceLines)}</div>
   </div>`,
  right: `${tabs([['Inspector'], ['Scope'], ['Source'], ['Flow']], 'Source')}<div class="scroll">
   <div class="section"><h4>How the trail works</h4>
    <div style="color:var(--text-muted);line-height:1.5">It records the path you took, not where files sit in folders. Each earlier step is a button. Going back keeps the later steps so Alt+Right returns; opening a new reference from here drops them.</div></div>
   <div class="section"><h4>Label on each hop</h4>
    <div class="kv" style="margin-bottom:4px"><span class="tag det">page → component</span>HomePage uses PriceCard</div>
    <div class="kv"><span class="tag det">component → component</span>PriceCard uses Badge</div></div>
   <div class="section"><h4>Long trails</h4><div style="color:var(--text-muted)">Past six steps the middle folds into "…" (a menu). First and last two stay visible.</div></div></div>`,
  drawer: `${drawerBar('Logs', ['0', '', '0'])}<div class="body" style="padding-top:6px"><div class="logline"><time>14:31:40</time><span>nav: HomePage → PriceCard → Badge (3 steps)</span></div></div>`,
  drawerH: 88,
})));

/* 5 — states + narrow */
const skels = [70, 55, 62, 48].map((w, i) => `<div class="skelrow" style="padding-left:${14 + (i % 3) * 16}px"><div class="skel" style="width:${w}%"></div></div>`).join('');
writeFileSync(join(here, 'flow-nav-states.html'), page('Flow view and links — empty, loading, error and narrow', `
<div class="sheet" style="grid-template-columns:1fr 1fr 1fr 400px">
  <div class="two"><h3>Empty — no routes for this framework</h3>${stateCard('⇢', 'No routes to show yet', 'Construct cannot read routes for this kind of project yet, so it lists each feature and its controllers instead. Nothing is guessed.', '<span class="tag human" style="margin-top:6px">Features shown flat</span>')}
   <h3>Loading</h3><div class="state-card" style="align-items:stretch;justify-content:flex-start;padding:12px 0" aria-busy="true">${skels}</div></div>
  <div class="two"><h3>Error — flow could not be built</h3>${stateCard('!', 'Could not trace imports', 'A file has a syntax error, so its imports cannot be read. The Files view still works.', '<div style="display:flex;gap:8px;margin-top:6px"><button class="btn sm primary">Try again</button><button class="btn sm">Show in Diagnostics</button></div>')}
   <h3>No route reaches this feature (a note)</h3><div class="state-card" style="align-items:stretch;text-align:left;justify-content:center"><div class="row frow"><span class="twisty">▸</span><span class="nm">ui-kit</span><span class="meta">6 files</span></div><div class="note" style="margin-left:14px"><span class="i">i</span><span><b>No route reaches this feature.</b> Fine for a shared library.</span></div></div></div>
  <div class="two"><h3>Links — states of a reference</h3>
   <div class="state-card" style="height:auto;align-items:flex-start;text-align:left;gap:10px;padding:14px">
     <div class="kv"><span class="mono ref">PriceCard</span><span>resolved, at rest</span></div>
     <div class="kv"><span class="mono ref hot">PriceCard</span><span>hover, or Ctrl held</span></div>
     <div class="kv"><span class="mono plain">Tooltip</span><span>unresolved: plain text</span></div>
     <div class="kv"><span class="mono ref" style="outline:2px solid var(--focus);outline-offset:2px">PriceCard</span><span>keyboard focus (Enter opens)</span></div>
    <p style="margin:0;color:var(--text-muted);max-width:none">Checked when the file is drawn, never on click, and re-checked when the file changes on disk.</p></div>
   <h3>Trail, long</h3><div class="state-card" style="height:auto;padding:0;overflow:hidden">${trail([['HomePage', '', ''], ['…', '', ''], ['Badge', 'cur', '']], { hint: false })}<p style="padding:8px 12px;max-width:none">No motion on open. Focus moves to the editor and the trail announces "Badge, step 3 of 3".</p></div></div>
  <div><h3>Narrow</h3><div class="narrow"><div class="pane-h"><span class="title">Cockpit</span><span class="spacer"></span><div class="seg"><button>Files</button><button class="on">Flow</button></div></div>
   <div class="scroll" style="flex:1"><div class="tree" style="padding-top:8px">
    <div class="row frow"><span class="twisty">▾</span><span class="layer route">route</span><span class="nm" style="font-weight:600">/refunds/new</span></div>
    <div class="fan">
     <div class="row l1 frow"><span class="twisty">▾</span>${L('controller')}<span class="nm">refundController</span></div>
     <div class="row l2 frow"><span class="twisty">▸</span><span class="branch" style="height:auto">Behaviour · 4</span></div>
     <div class="row l2 frow"><span class="twisty">▸</span><span class="branch" style="height:auto">Render · 4</span></div>
     <div class="row l1 frow"><span class="twisty">▸</span>${L('controller')}<span class="nm">orderSummaryController</span></div></div>
    <div class="note" style="margin-left:14px"><span class="i">i</span><span>ui-kit: no route reaches this feature.</span></div></div></div>
   <div class="trail" style="border-top:1px solid var(--border-subtle);border-bottom:0"><button class="nav" aria-label="Back">‹</button><button class="nav" disabled aria-label="Forward">›</button><button class="crumb">…</button><button class="crumb cur" aria-current="page">Badge</button></div>
   <div class="tabbar"><div>Browse</div><div class="on">Flow</div><div>Source</div><div>Drawer</div></div></div></div>
</div>`));
console.log('flow-nav mocks written');
