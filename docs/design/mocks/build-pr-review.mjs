// Concept mocks for "PR review in the Cockpit" (#285). Design ticket: see docs/design/README.md.
// Usage: node docs/design/mocks/build-pr-review.mjs   (output HTML is committed; PNGs via render.mjs)
//
// Owns ONLY files named pr-review-*.html plus pr-review.css. It imports the shared shell parts
// (parts.mjs) read-only and never edits mock.css or build.mjs, so this file can be regenerated
// independently of the other mock sets.
//
// Content is deliberately concrete: real Construct rule ids (SLICE-002, READ-001, PAGE-006,
// DOMAIN-001), real impact warning codes (SHARED-COMPONENT, CROSS-FEATURE, PUBLIC-API,
// FROZEN-REGION, TRUNCATED) and the workflow narrator's real "Given / When / Then" phrasing.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { page, tabs } from './parts.mjs';

const here = dirname(fileURLToPath(import.meta.url));

/** parts.page() plus this mock set's own stylesheet (additive; mock.css is never edited here). */
const prPage = (title, body) =>
  page(title, body).replace('<link rel="stylesheet" href="mock.css">',
    '<link rel="stylesheet" href="mock.css">\n<link rel="stylesheet" href="pr-review.css">');


/** Top bar with a fourth mode. Review fills all three panes, so it is a mode, not a tab.
 *  (If parts.topbar gains "Review", this local copy goes away.) */
const topbar4 = (mode = 'Review', procs = '1 running') => `
<header class="topbar">
  <div class="brand"><i></i>Construct</div>
  <button class="chip-btn" aria-haspopup="listbox">acme/storefront <span class="sub">main</span> ▾</button>
  <div class="seg" role="radiogroup" aria-label="Mode">${['Explore', 'Research', 'Build', 'Review'].map((m) => `<button class="${m === mode ? 'on' : ''}" role="radio" aria-checked="${m === mode}">${m}</button>`).join('')}</div>
  <button class="chip-btn palette-trigger"><span>Search pull requests, files or run a command…</span><kbd>Ctrl K</kbd></button>
  <span class="pill run"><span class="spin"></span>${procs}</span>
  <span class="pill ok"><span class="dot"></span>GitHub · sam-dev</span>
  <button class="icon-btn" aria-label="Theme">◐</button>
  <button class="icon-btn" aria-label="Help">?</button>
  <span class="avatar">SP</span>
</header>`;

/** Status bar carrying the read-only promise on every review screen. */
const sbar = (mid = '', right = 'Deterministic · no model used') => `
<footer class="statusbar">
  <span class="ok">● Read-only — nothing is written to this pull request</span>
  <span>Auto review-and-fix: Off</span>${mid}
  <span class="spacer"></span><span>${right}</span>
  <span><kbd>Ctrl J</kbd> drawer</span><span><kbd>?</kbd> shortcuts</span>
</footer>`;

const prShell = ({ mode = 'Review', left, mid, right, drawer, drawerH = 132, lw = 316, rw = 404, procs, sb = sbar() }) => `
<div class="shell" style="--lw:${lw}px;--rw:${rw}px;grid-template-rows:44px 1fr ${drawerH}px 24px">
  ${topbar4(mode, procs)}
  <div class="main">
    <aside class="pane" aria-label="Browser">${left}</aside><div class="resizer" role="separator" aria-orientation="vertical" tabindex="0"></div>
    <section class="pane mid" aria-label="Pull request">${mid}</section><div class="resizer" role="separator" aria-orientation="vertical" tabindex="0"></div>
    <aside class="pane" aria-label="Tools">${right}</aside>
  </div>
  <div class="drawer" aria-label="Drawer">${drawer}</div>
  ${sb}
</div>`;

const hb = (kind, text, icon = '') => `<span class="hb ${kind}">${icon ? `<i>${icon}</i>` : ''}${text}</span>`;
const hbx = (kind, text) => `<span class="hb xs ${kind}">${text}</span>`;
const det = '<span class="tag det">Deterministic</span>';
const drawerBarPR = (on, findings = '5') =>
  tabs([['Findings', [findings, 'danger']], ['Rule check', null], ['Processes', ['1', 'acc']]], on);

// ---------------------------------------------------------------------------------------------
// 1 — the pull request list: pick the risky one first
// ---------------------------------------------------------------------------------------------
const prRow = (risk, num, title, sub, badges, sel = false) => `
<div class="pr-row ${sel ? 'sel' : ''}">
  <div style="display:flex;align-items:center;gap:10px"><span class="risk ${risk}"></span><span class="num">#${num}</span></div>
  <div><div class="ttl">${title}</div><div class="sub">${sub}</div></div>
  <div class="hb-row">${badges}</div>
</div>`;

const listLeft = `
<div class="pane-h"><span class="title">Browser</span><span class="spacer"></span><button class="icon-btn" aria-label="Refresh">↻</button><button class="icon-btn" aria-label="Collapse pane">«</button></div>
${tabs([['Pull requests', ['5', 'acc']], ['Branches'], ['Features']], 'Pull requests')}
<div class="search">⌕ Filter pull requests <span class="spacer"></span><kbd>/</kbd></div>
<div class="scroll">
  <div class="sect">Show</div>
  <div class="tree">
    <div class="row sel">Open<span class="meta">5</span></div>
    <div class="row">Drafts<span class="meta">1</span></div>
    <div class="row">Opened by me<span class="meta">2</span></div>
    <div class="row">Came from a plan<span class="meta">2</span></div>
    <div class="row">From a fork<span class="meta">1</span></div>
  </div>
  <div class="sect">Local branches</div>
  <div class="tree">
    <div class="row muted">feat/guest-checkout<span class="meta">vs main</span></div>
    <div class="row muted">fix/cart-total<span class="meta">vs main</span></div>
  </div>
  <div class="sect">Compared against</div>
  <div class="tree"><div class="row muted">main<span class="meta mono">8528669</span></div></div>
</div>`;

const legendItem = (name, line, from) =>
  `<div class="ind"><h5>${name}</h5><div class="head">${line}</div><div class="why">${from}</div></div>`;

writeFileSync(join(here, 'pr-review-list.html'), prPage('Pull requests — ranked by what Construct found', prShell({
  lw: 300, rw: 384, drawerH: 150,
  left: listLeft,
  mid: `<div class="canvas-tb"><span class="crumbs">acme/storefront › <b>Pull requests</b></span><span class="spacer"></span>
   <div class="seg" role="radiogroup" aria-label="Sort"><button class="on" role="radio" aria-checked="true">Riskiest first</button><button role="radio" aria-checked="false">Newest</button></div>
   <button class="btn sm">↻ Re-analyse all</button></div>
  <div class="stage-scroll">
   <div class="muted-note" style="margin-bottom:10px">Every badge is computed from your <span class="mono">architecture.yml</span> and the two commits — not from the diff text, and not by a model. ${det}</div>
   <div class="pr-list">
    <div class="hd"><span>Pull request</span><span class="spacer"></span><span>What Construct found</span></div>
    ${prRow('bad', '142', 'Add show-password toggle to login', 'sam-dev · 11 files · <span class="mono">feat/show-toggle</span> · <span class="mono">plan-142</span>',
    `${hb('bad', 'Scope 1 → 3')}${hb('bad', '2 rule regressions')}${hb('warn', 'Public API')}${hb('warn', 'Flow changed')}`, true)}
    ${prRow('bad', '139', 'Guest checkout without an account', 'octo-ext (fork) · 23 files · <span class="mono">guest-checkout</span>',
    `${hb('none', 'No plan')}${hb('bad', '1 rule regression')}${hb('warn', 'Shared component')}${hb('info', 'Flow: 1 path added')}`)}
    ${prRow('warn', '136', 'Move price formatting into domain', 'priya · 6 files · <span class="mono">refactor/price</span> · <span class="mono">plan-136</span>',
    `${hb('ok', 'Scope as planned')}${hb('bad', 'Frozen region')}${hb('ok', 'No rule regressions')}`)}
    ${prRow('ok', '137', 'Bump eslint 8 → 9', 'dependabot · 2 files · <span class="mono">deps/eslint-9</span>',
    `${hb('none', 'No plan')}${hb('ok', 'Nothing found')}`)}
    ${prRow('none', '131', 'Catalog: infinite scroll <span class="hb xs none">Draft</span>', 'sam-dev · 18 files · <span class="mono">feat/infinite-scroll</span>',
    '<span class="pill run" style="height:20px"><span class="spin"></span>Analysing…</span>')}
   </div>
   <div class="muted-note" style="margin-top:10px">“Scope 1 → 3” means the plan declared one feature and the pull request touches three. Pull requests with no plan are not scored on scope — every other check still runs.</div>
  </div>`,
  right: `${tabs([['What the badges mean'], ['Settings']], 'What the badges mean')}
  <div class="scroll" style="padding:10px 12px">
   ${legendItem(`${hb('bad', 'Scope 1 → 3')}<span class="spacer"></span>${det}`, 'The plan declared one feature; the pull request touches three.', 'Plan <span class="mono">touches</span> vs the features in the impact report.')}
   ${legendItem(`${hb('bad', '2 rule regressions')}<span class="spacer"></span>${det}`, 'Your rules pass on <span class="mono">main</span> and fail on this branch.', 'Runs <span class="mono">construct validate</span> on both commits and subtracts. Violations that already existed are not counted.')}
   ${legendItem(`${hb('warn', 'Public API')}<span class="spacer"></span>${det}`, 'A feature’s public <span class="mono">index.ts</span> changed, so other features are affected.', 'Impact warning <span class="mono">PUBLIC-API</span>.')}
   ${legendItem(`${hb('warn', 'Flow changed')}<span class="spacer"></span>${det}`, 'A workflow can now reach different outcomes than before.', 'Workflow scenarios compared between the two commits.')}
   ${legendItem(`${hb('none', 'No plan')}<span class="spacer"></span>${det}`, 'Nothing was declared up front, so scope is not measured.', 'Normal for hand-written and outside contributions. Not a problem, and not a warning.')}
  </div>`,
  drawer: `${drawerBarPR('Processes')}
  <div class="body"><table>
   <tr><th>Process</th><th>Status</th><th>Progress</th><th></th></tr>
   <tr><td>pr health · #131 (draft) · 18 files</td><td><span class="pill run" style="height:20px"><span class="spin"></span>Comparing workflow paths</span></td><td><div class="bar-track"><div class="bar-fill" style="width:64%"></div></div></td><td><button class="btn sm">Cancel</button></td></tr>
   <tr><td>pr health · #142 · 11 files</td><td><span style="color:var(--success)">✓ Done in 1.4 s</span></td><td><div class="bar-track"><div class="bar-fill" style="width:100%;background:var(--success)"></div></div></td><td></td></tr>
  </table></div>`,
})));

// ---------------------------------------------------------------------------------------------
// shared pieces for the "reviewing one pull request" screens
// ---------------------------------------------------------------------------------------------
/** Browser pane: changed units grouped by feature, then layer. The grouping IS the product —
 *  GitHub can only show a flat file list. */
const changedUnits = (groups, { header, tab = 'By feature' }) => `
<div class="pane-h"><span class="title">Changed units</span><span class="spacer"></span><button class="icon-btn" aria-label="Expand all">⌄</button><button class="icon-btn" aria-label="Collapse pane">«</button></div>
${tabs([['By feature'], ['By layer'], ['Files']], tab)}
<div class="search">⌕ Filter changed units <span class="spacer"></span><kbd>/</kbd></div>
<div style="padding:2px 12px 6px" class="muted-note">${header}</div>
<div class="scroll"><div class="tree">
${groups.map((g) => `
  <div class="row"><span class="twisty">${g.collapsed ? '▸' : '▾'}</span><b>${g.feature}</b>${g.badge || ''}<span class="meta">${g.files} files</span></div>
  ${g.collapsed ? '' : g.layers.map((l) => `
  <div class="row l1"><span class="twisty">▾</span><span class="layer ${l.cls || ''}">${l.layer}</span><span class="meta">${l.items.length}</span></div>
  ${l.items.map(([name, mark, delta, sel]) => `<div class="row l2 ${sel ? 'sel' : ''}">${name}${mark || ''}<span class="meta mono">${delta}</span></div>`).join('')}`).join('')}`).join('')}
</div></div>`;

const pr142Groups = [
  { feature: 'auth', files: 6, badge: `&nbsp;${hbx('ok', 'in plan')}`, layers: [
    { layer: 'component', cls: 'component', items: [['PasswordField.tsx', `&nbsp;${hbx('warn', 'shared')}`, '+38 −4', true], ['passwordToggle.tsx', `&nbsp;${hbx('bad', 'READ-001')}`, '+41'], ['LoginForm.tsx', '', '+3 −1']] },
    { layer: 'workflow', cls: 'workflow', items: [['authMachine.ts', `&nbsp;${hbx('warn', 'flow')}`, '+2 −9']] },
    { layer: 'feature api', items: [['index.ts', `&nbsp;${hbx('warn', 'public')}`, '+1 −1']] },
    { layer: 'test', items: [['login.spec.ts', '', '+22']] },
  ] },
  { feature: 'checkout', files: 3, badge: `&nbsp;${hbx('bad', 'not in plan')}`, layers: [
    { layer: 'component', cls: 'component', items: [['GuestForm.tsx', `&nbsp;${hbx('bad', 'SLICE-002')}`, '+17 −2']] },
    { layer: 'hook', items: [['useGuestCheckout.ts', '', '+9 −3']] },
    { layer: 'domain', items: [['guestRules.ts', `&nbsp;${hbx('warn', 'unexplained')}`, '+6']] },
  ] },
  { feature: 'core', files: 2, badge: `&nbsp;${hbx('bad', 'not in plan')}`, collapsed: true, layers: [
    { layer: 'lib', items: [['format.ts', `&nbsp;${hbx('warn', 'unexplained')}`, '+4 −4'], ['strings.ts', `&nbsp;${hbx('warn', 'unexplained')}`, '+2']] },
  ] },
];

const unit = (layer, cls, name, feature, text, delta, mark = '') => `
<div class="unit"><span class="layer ${cls}">${layer}</span>
 <div><div class="nm">${name} ${hbx('none', feature)} ${mark}</div><div class="txt">${text}</div></div>
 <span class="mono" style="color:var(--text-faint)">${delta}</span></div>`;

const heroBlast = `
<div class="hero">
  <div style="text-align:center"><div class="big">1 → 3</div><div class="lbl">features</div></div>
  <div class="txt"><b>The plan declared 1 feature; this pull request touches 3.</b><br>
   <span style="color:var(--text-muted)">Plan <span class="mono">plan-142</span> declared <span class="mono">auth</span>. This branch also changes <span class="mono">checkout</span> and <span class="mono">core</span>.</span></div>
  <span class="spacer"></span>${det}<button class="btn sm">Compare with the plan</button>
</div>`;

const ind = (kind, title, head, why, act = '') =>
  `<div class="ind ${kind}"><h5>${title}<span class="spacer"></span>${det}</h5><div class="head">${head}</div><div class="why">${why}</div>${act ? `<div class="act">${act}</div>` : ''}</div>`;

const bars = (declared, actual) => `
<div class="bars"><span>declared</span><div class="t"><div class="f" style="width:${(declared / 3) * 100}%"></div></div><span class="n">${declared}</span>
<span>touched</span><div class="t"><div class="f over" style="width:${(actual / 3) * 100}%"></div></div><span class="n">${actual}</span></div>`;

const health142 = `
${ind('bad', 'Blast radius', '<b>The plan declared 1 feature. This pull request touches 3.</b>' + bars(1, 3),
  '<span class="mono">auth</span> was planned. <span class="mono">checkout</span> and <span class="mono">core</span> were not — 5 files.')}
${ind('warn', 'Unexplained changes', '<b>4 of 11 files</b> have no import path to anything the plan touches.',
  'e.g. <span class="mono">core/lib/format.ts</span> — often a stray edit riding along.')}
${ind('bad', 'Rule regressions', 'Your rules pass on <b>main</b> and fail here: <b>0 → 2 errors</b>.',
  'New: <span class="mono">SLICE-002</span> in checkout, <span class="mono">READ-001</span> in auth. An older <span class="mono">PAGE-006</span> is unchanged and not counted.')}
${ind('warn', 'Public surface', '<b>1 export removed</b>, 1 added in <span class="mono">features/auth/index.ts</span>.',
  '<span class="mono">PasswordFieldProps</span> is no longer public, and 2 features import auth’s public API. (<span class="mono">PUBLIC-API</span>)')}
${ind('warn', 'What the flow now does', '<span class="mono">authMachine</span>: <b>1 of 3 paths removed</b>, none added.',
  '“A rejected sign-in can no longer be retried — the flow now ends in locked out.” No diff view can tell you this.', '<button class="btn sm">Open Flow</button>')}`;

const ruleCheckDrawer = `
<div class="body"><table>
 <tr><th>Rule</th><th>What it means, in plain words</th><th>File</th><th>main</th><th>This branch</th></tr>
 <tr><td><span class="tag" style="background:var(--danger-soft);color:var(--danger)">error</span> SLICE-002</td><td>Cross-feature import reaches into “auth” internals — go through the feature’s public index</td><td class="mono">features/checkout/components/GuestForm.tsx:4</td><td style="color:var(--text-faint)">0</td><td><span class="hb bad">1 new</span></td></tr>
 <tr><td><span class="tag" style="background:var(--danger-soft);color:var(--danger)">error</span> READ-001</td><td>Component files are PascalCase</td><td class="mono">features/auth/components/passwordToggle.tsx</td><td style="color:var(--text-faint)">0</td><td><span class="hb bad">1 new</span></td></tr>
 <tr><td><span class="tag" style="background:var(--warn-soft);color:var(--warn)">error</span> PAGE-006</td><td>Page imports a custom hook; go through a controller</td><td class="mono">features/auth/pages/LoginPage.tsx:3</td><td style="color:var(--text-faint)">1</td><td><span class="hb none">1 · already there</span></td></tr>
</table></div>`;

// ---------------------------------------------------------------------------------------------
// 2 — reviewing one pull request: what changed, in our vocabulary
// ---------------------------------------------------------------------------------------------
writeFileSync(join(here, 'pr-review-open.html'), prPage('Reviewing a pull request — grouped by feature and layer, with health indicators', prShell({
  drawerH: 166, rw: 424,
  left: changedUnits(pr142Groups, { header: '<b>11 files · 3 features · 6 layers</b>' }),
  mid: `<div class="canvas-tb"><span class="crumbs"><b>#142 Add show-password toggle to login</b></span><span class="spacer"></span>
   <div class="seg" role="radiogroup" aria-label="View"><button class="on" role="radio" aria-checked="true">Summary</button><button role="radio" aria-checked="false">Diff</button><button role="radio" aria-checked="false">Files</button></div>
   <button class="btn sm">Open on GitHub ↗</button></div>
  <div class="stage-scroll">
   ${heroBlast}
   <div class="card" style="margin-top:12px">
    <div class="hd"><span>What this pull request actually does</span><span class="spacer"></span><span style="text-transform:none;letter-spacing:0;font-weight:400">read from the code, not from the description</span>${det}</div>
    ${unit('component', 'component', 'PasswordField', 'auth', 'Takes a new <b>showToggle</b> prop. When it is set, a button switches the password input between hidden and visible text.', '+38 −4', hbx('warn', 'used by 3 features'))}
    ${unit('component', 'component', 'PasswordToggle', 'auth', 'New. The eye button itself: presentation only, no state of its own.', '+41', hbx('bad', 'READ-001'))}
    ${unit('workflow', 'workflow', 'authMachine', 'auth', 'The sign-in flow. The <b>RETRY</b> event was removed from the <b>rejected</b> state.', '+2 −9', hbx('warn', 'flow changed'))}
    ${unit('feature api', '', 'auth/index.ts', 'auth', 'Stops publishing <b>PasswordFieldProps</b>; starts publishing <b>PasswordToggle</b>.', '+1 −1', hbx('warn', 'public API'))}
    ${unit('component', 'component', 'GuestForm', 'checkout', 'New. Imports <b>PasswordField</b> from inside auth instead of from the feature’s public index.', '+17 −2', hbx('bad', 'SLICE-002'))}
    <div class="unit"><span class="layer">+6 more</span><div><div class="txt">1 hook, 1 domain file, 2 library files and 2 tests — nothing found in them.</div></div><span></span></div>
   </div>
  </div>`,
  right: `${tabs([['Health', ['5', 'danger']], ['Findings', ['5', 'danger']], ['Flow', ['1', 'acc']]], 'Health')}
   <div class="scroll" style="padding:10px 12px">${health142}</div>`,
  drawer: `${drawerBarPR('Rule check')}${ruleCheckDrawer}`,
})));

// ---------------------------------------------------------------------------------------------
// 3 — the health indicators in full: what each one computes, and from what
// ---------------------------------------------------------------------------------------------
const detail = (kind, n, title, body) => `
<div class="ind ${kind}" style="padding:0">
  <div class="hd" style="display:flex;align-items:center;gap:8px;padding:7px 12px;border-bottom:1px solid var(--border-subtle)">
    <span class="badge acc">${n}</span><b style="font-size:13px">${title}</b><span class="spacer"></span>${det}</div>
  <div style="padding:10px 12px">${body}</div></div>`;

const source = (t) => `<div class="why" style="margin-top:8px;border-top:1px dashed var(--border-strong);padding-top:7px"><b style="color:var(--text-muted)">Where the number comes from:</b> ${t}</div>`;

writeFileSync(join(here, 'pr-review-indicators.html'), prPage('The five health indicators — what each one computes', `
<div class="pr-sheet">
 <div class="muted-note">Five indicators, each computed from the two commits and the project’s own <span class="mono">architecture.yml</span> — none reads the pull request description, none calls a model. Shown for <span class="mono">#142 Add show-password toggle to login</span>.</div>
 <div class="cols2" style="grid-template-columns:628px 1fr">
  <div style="display:grid;gap:14px">
   ${detail('bad', '1', 'Blast radius — declared vs actual', `
    <div class="head"><b>The plan declared 1 feature. This pull request touches 3.</b> Decide whether checkout and core belong here — or update the plan.</div>
    <table style="margin-top:8px"><tr><th>Feature</th><th>Declared in plan-142</th><th>Changed here</th></tr>
     <tr><td class="mono">auth</td><td>${hb('ok', 'yes')}</td><td>6 files</td></tr>
     <tr><td class="mono">checkout</td><td>${hb('none', 'no')}</td><td><span style="color:var(--danger)">3 files</span></td></tr>
     <tr><td class="mono">core</td><td>${hb('none', 'no')}</td><td><span style="color:var(--danger)">2 files</span></td></tr></table>
    ${source('the plan’s <span class="mono">touches</span> field against the impact report — both sides computed.')}`)}
   ${detail('warn', '2', 'Changes the layer graph does not explain', `
    <div class="head"><b>4 of 11 files</b> have no import path to anything the plan set out to change.</div>
    <table style="margin-top:8px"><tr><th>File</th><th>Reached from a planned unit?</th></tr>
     <tr><td class="mono">core/lib/format.ts</td><td>${hb('warn', 'no path')}</td></tr>
     <tr><td class="mono">core/lib/strings.ts</td><td>${hb('warn', 'no path')}</td></tr>
     <tr><td class="mono">checkout/domain/guestRules.ts</td><td>${hb('warn', 'no path')}</td></tr>
     <tr><td class="mono">checkout/hooks/useGuestCheckout.ts</td><td>${hb('warn', 'no path')}</td></tr>
     <tr><td class="mono">checkout/components/GuestForm.tsx</td><td>${hb('ok', 'yes — explained, not flagged')}</td></tr></table>
    ${source('a transitive walk of the import graph that follows each feature’s public <span class="mono">index.ts</span> — counting direct importers would call the riskiest files “used by nobody”.')}`)}
   <div class="ind none"><h5>Why these five</h5>
    <div class="head">Each one answers a question a reviewer actually asks and a diff cannot: <i>is this bigger than we agreed? does anything here have no business changing? did we break our own rules? does this reach outside the feature? can the app still do what it could before?</i></div>
    <div class="why">All five are assembled from blocks that already exist — the layer graph, the impact report, <span class="mono">construct validate</span>, the workflow narrator.</div></div>
  </div>
  <div style="display:grid;gap:14px">
   ${detail('bad', '3', 'Rule regressions — clean on main, dirty here', `
    <div class="head"><span class="mono">construct validate</span>: 1 error on <b>main</b>, 3 here. <b>2 are new</b>; pre-existing ones never count.</div>
    <table style="margin-top:8px"><tr><th>Rule</th><th>main</th><th>This branch</th><th>Counted?</th></tr>
     <tr><td class="mono">SLICE-002</td><td>0</td><td style="color:var(--danger)">1</td><td>${hb('bad', 'new')}</td></tr>
     <tr><td class="mono">READ-001</td><td>0</td><td style="color:var(--danger)">1</td><td>${hb('bad', 'new')}</td></tr>
     <tr><td class="mono">PAGE-006</td><td>1</td><td>1</td><td>${hb('none', 'already there')}</td></tr></table>
`)}
   ${detail('warn', '4', 'Public surface — what leaves the feature', `
    <div class="head"><b>1 export removed, 1 added</b> in <span class="mono">features/auth/index.ts</span>.</div>
    <div class="code" style="margin-top:6px;border:1px solid var(--border-subtle);border-radius:var(--r-sm)">
     <div class="ln del"><i>7</i><span>export type { PasswordFieldProps } from './components/PasswordField';</span></div>
     <div class="ln add"><i>7</i><span>export { PasswordToggle } from './components/PasswordToggle';</span></div></div>
    <div class="why" style="margin-top:8px">2 features consume auth’s API (checkout, cart); anything importing <span class="mono">PasswordFieldProps</span> stops compiling.</div>
    ${source('the <span class="mono">PUBLIC-API</span> warning: which implicated files are re-exported from the feature’s index.')}`)}
   ${detail('warn', '5', 'What the flow now does — the one no diff can show', `
    <div class="head"><span class="mono">authMachine</span>: <b>3 paths before, 2 after.</b> One route through the sign-in flow no longer exists.</div>
    <div class="scen" style="margin-top:8px">
     <div class="r same"><span class="k">unchanged</span><div><div class="path-steps">idle → submitting → signed in</div><div class="gwt">Happy path. The shopper submits and the credentials are accepted.</div></div></div>
     <div class="r del"><span class="k">removed</span><div><div class="path-steps"><s>idle → submitting → rejected → submitting → signed in</s></div><div class="gwt">Given the flow starts in <b>idle</b>, when the shopper submits, then it goes to <b>submitting</b>; when the credentials are rejected, then it goes to <b>rejected</b>; when the shopper retries, then it goes back to <b>submitting</b>; and the flow ends in <b>signed in</b>.</div></div></div>
     <div class="r same"><span class="k">unchanged</span><div><div class="path-steps">idle → submitting → rejected → locked out</div></div></div>
    </div>
    <div class="callout warn" style="margin:10px 0 0"><span>⚠</span><div class="grow"><b>In plain words</b><small>A rejected sign-in used to be retryable; now the only way out is <span class="mono">locked out</span>. Perhaps intended — but unmentioned, and invisible in a diff.</small></div></div>
    ${source('the narrator’s scenarios, enumerated on both commits and diffed — the same narrator the Workflows screen uses.')}`)}
  </div>
 </div>
</div>`));

// ---------------------------------------------------------------------------------------------
// 4 — findings: auto-resolvable and "this is a conversation", in one list, never blurred
// ---------------------------------------------------------------------------------------------
const finding = (mark, rule, msg, loc, fix, sel = false, plain = false) => `
<div class="finding ${sel ? 'sel' : ''}"><span class="mk">${mark}</span>
 <div><span class="rule">${rule}</span>${plain ? `<span class="loc inline">${loc}</span>` : ''}<div class="msg">${msg}</div>${plain ? '' : `<div class="loc">${loc}</div>`}
 <div class="${plain ? 'ask' : 'fix'}">${fix}</div></div></div>`;

const findingsPane = `
${tabs([['Health', ['5', 'danger']], ['Findings', ['5', 'danger']], ['Flow', ['1', 'acc']]], 'Findings')}
<div class="scroll">
 <div class="grp-head">${hb('ok', 'Can be fixed mechanically', '✓')}<b>2</b><span class="spacer"></span></div>
 <div class="grp-note"><span class="mono">construct refactor</span> makes these with no model involved.</div>
 ${finding(`<span style="color:var(--success)">✓</span>`, 'SLICE-002 · error', 'Cross-feature import reaches into “auth” internals.', 'features/checkout/components/GuestForm.tsx:4',
  '<b>Fix:</b> import from <span class="mono">features/auth/index.ts</span> instead.', true)}
 ${finding(`<span style="color:var(--success)">✓</span>`, 'READ-001 · error', 'Component file is not PascalCase.', 'features/auth/components/passwordToggle.tsx',
  '<b>Fix:</b> rename to <span class="mono">PasswordToggle.tsx</span> (3 imports updated).')}
 <div class="grp-head" style="border-top:1px solid var(--border-strong);margin-top:6px">${hb('info', 'Needs a decision', '◆')}<b>3</b></div>
 <div class="grp-note">No mechanical fix exists. These are a conversation with the author.</div>
 ${finding(`<span style="color:var(--accent)">◆</span>`, 'PUBLIC-API · warning', 'auth stops publishing <span class="mono">PasswordFieldProps</span>.', 'auth/index.ts:7',
  '<b>Ask:</b> deliberate, or an oversight? 2 features import this API.', false, true)}
 ${finding(`<span style="color:var(--accent)">◆</span>`, 'Flow change · warning', 'A rejected sign-in can no longer be retried.', 'auth/workflows/authMachine.ts:44',
  '<b>Ask:</b> is dropping the retry path intended?', false, true)}
 ${finding(`<span style="color:var(--accent)">◆</span>`, 'SHARED-COMPONENT · warning', '<span class="mono">PasswordField</span> is used by 3 features; the plan said auth only.', 'auth/components/PasswordField.tsx',
  '<b>Ask:</b> checked in Register and Guest checkout too?', false, true)}
</div>
<div style="border-top:1px solid var(--border-strong);padding:8px 12px;background:var(--surface-2)">
 <div style="display:flex;align-items:center;gap:10px"><span class="tog"><span class="sw"></span><span class="st">Auto fix: Off</span></span><span class="spacer"></span><button class="btn sm">Turn on…</button></div>
 <div class="muted-note" style="margin-top:5px">Would open <b>1 separate pull request</b> with the 2 fixes — never this one.</div></div>`;

writeFileSync(join(here, 'pr-review-findings.html'), prPage('Findings — mechanical fixes and conversations, side by side but never blurred', prShell({
  drawerH: 96, rw: 460,
  left: changedUnits(pr142Groups, { header: '<b>11 files · 3 features.</b> 5 findings, on 4 of them.' }),
  mid: `<div class="canvas-tb"><span class="crumbs">#142 › findings › <b>SLICE-002</b></span><span class="spacer"></span>
   <div class="seg" role="radiogroup" aria-label="View"><button role="radio" aria-checked="false">Summary</button><button class="on" role="radio" aria-checked="true">Diff</button><button role="radio" aria-checked="false">Files</button></div>
   <button class="btn sm">Open on GitHub ↗</button></div>
  <div class="stage-scroll">
   <div class="card">
    <div class="hd"><span class="mono" style="text-transform:none;letter-spacing:0">features/checkout/components/GuestForm.tsx</span><span class="spacer"></span>${hb('ok', 'Can be fixed mechanically', '✓')}</div>
    <div class="code">
     <div class="ln"><i>1</i><span><span class="k1">import</span> { useState } <span class="k1">from</span> <span class="k3">'react'</span>;</span></div>
     <div class="ln"><i>2</i><span><span class="k1">import</span> { Button } <span class="k1">from</span> <span class="k3">'../../../core/ui/Button'</span>;</span></div>
     <div class="ln add"><i>4</i><span><span class="k1">import</span> { PasswordField } <span class="k1">from</span> <span class="k3">'../../auth/components/PasswordField'</span>;</span></div>
     <div class="ln"><i>5</i><span></span></div>
     <div class="ln"><i>6</i><span><span class="k1">export function</span> <span class="k2">GuestForm</span>({ onSubmit }: Props) {</span></div>
    </div>
   </div>
   <div class="card" style="margin-top:12px">
    <div class="hd"><span>What the rule says, and the fix Construct would make</span><span class="spacer"></span>${det}</div>
    <div style="padding:10px 14px">
     <div><b>SLICE-002 — Cross-feature imports use public index.ts</b></div>
     <div class="why" style="margin-top:4px">Features may only consume another feature through its public index API. Reaching into <span class="mono">auth/components/…</span> ties checkout to auth’s internal file layout, so moving a file inside auth silently breaks checkout.</div>
     <div class="code" style="margin-top:10px;border:1px solid var(--border-subtle);border-radius:var(--r-sm)">
      <div class="ln del"><i>4</i><span>- import { PasswordField } from '../../auth/components/PasswordField';</span></div>
      <div class="ln add"><i>4</i><span>+ import { PasswordField } from '../../auth';</span></div></div>
     <div class="muted-note" style="margin-top:8px">This change is <b>not applied</b>. Reviewing is read-only: Construct shows you the diff it would make, here and in a separate pull request if you turn Auto fix on. The same change <span class="mono">construct refactor</span> makes from the command line.</div>
    </div>
   </div>
  </div>`,
  right: findingsPane,
  drawer: `${drawerBarPR('Findings')}
  <div class="body" style="padding:8px 12px"><div class="callout info" style="margin:0"><span>ℹ</span><div class="grow"><b>2 of 5 findings can be fixed mechanically</b><small><span class="mono">SLICE-002</span> and <span class="mono">READ-001</span> — an import rewrite and a rename. The other 3 change what the code means, so Construct will not guess: they stay a conversation with the author.</small></div></div></div>`,
})));

// ---------------------------------------------------------------------------------------------
// 5 — the no-plan state: most pull requests. Calm, not empty, not alarming.
// ---------------------------------------------------------------------------------------------
const pr139Groups = [
  { feature: 'checkout', files: 12, layers: [
    { layer: 'component', cls: 'component', items: [['GuestPanel.tsx', '', '+96'], ['AddressForm.tsx', '', '+31 −8']] },
    { layer: 'workflow', cls: 'workflow', items: [['checkoutMachine.ts', `&nbsp;${hbx('info', 'flow')}`, '+34 −2', true]] },
    { layer: 'service', items: [['guestOrderApi.ts', '', '+48']] },
    { layer: 'domain', items: [['guestRules.ts', `&nbsp;${hbx('bad', 'DOMAIN-001')}`, '+27']] },
  ] },
  { feature: 'cart', files: 6, layers: [
    { layer: 'component', cls: 'component', items: [['CartSummary.tsx', `&nbsp;${hbx('warn', 'shared')}`, '+12 −5']] },
    { layer: 'hook', items: [['useCart.ts', '', '+8 −2']] },
  ] },
  { feature: 'core', files: 5, layers: [{ layer: 'lib', items: [['money.ts', `&nbsp;${hbx('warn', 'unexplained')}`, '+6 −1']] }] },
];

writeFileSync(join(here, 'pr-review-no-plan.html'), prPage('No plan linked — the common case, degrading cleanly', prShell({
  drawerH: 132, rw: 424,
  left: changedUnits(pr139Groups, { header: '<b>23 files · 3 features.</b> Opened from a fork by <span class="mono">octo-ext</span>.' }),
  mid: `<div class="canvas-tb"><span class="crumbs"><b>#139 Guest checkout without an account</b></span><span class="spacer"></span>
   <div class="seg" role="radiogroup" aria-label="View"><button class="on" role="radio" aria-checked="true">Summary</button><button role="radio" aria-checked="false">Diff</button><button role="radio" aria-checked="false">Files</button></div>
   <button class="btn sm">Open on GitHub ↗</button></div>
  <div class="stage-scroll">
   <div class="hero none">
    <div style="text-align:center"><div class="big" style="color:var(--text-faint)">—</div><div class="lbl">no plan</div></div>
    <div class="txt"><b>Scope is not measured for this pull request.</b><br>
     <span style="color:var(--text-muted)">#139 was not created from a Construct plan, so there is nothing that says what it was meant to touch. That is normal for hand-written work and outside contributions. Every other check on this page still runs — they only need the two commits.</span></div>
    <span class="spacer"></span><button class="btn sm">Link a plan…</button>
   </div>
   <div class="card" style="margin-top:12px">
    <div class="hd"><span>What this pull request actually does</span><span class="spacer"></span>${det}</div>
    ${unit('workflow', 'workflow', 'checkoutMachine', 'checkout', 'The checkout flow gains a <b>CONTINUE_AS_GUEST</b> event from <b>identifying</b>, so checkout can finish without an account.', '+34 −2', hbx('info', '1 path added'))}
    ${unit('service', '', 'guestOrderApi', 'checkout', 'New. Posts an order with an email address instead of a customer id.', '+48')}
    ${unit('domain', '', 'guestRules', 'checkout', 'Decides whether an email may check out as a guest — and calls <b>fetch</b> to do it.', '+27', hbx('bad', 'DOMAIN-001'))}
    ${unit('component', 'component', 'CartSummary', 'cart', 'Shows a guest badge. This file is used by 2 other features.', '+12 −5', hbx('warn', 'used by 3 features'))}
    <div class="unit"><span class="layer">+19 more</span><div><div class="txt">Components, hooks and tests with nothing found in them.</div></div><span></span></div>
   </div>
   <div class="muted-note" style="margin-top:10px">2 findings, both needing a decision — see the Findings tab. Nothing here can be fixed mechanically, so Auto review-and-fix would open nothing even if it were on.</div>
  </div>`,
  right: `${tabs([['Health', ['4', 'danger']], ['Findings', ['2', 'danger']], ['Flow', ['1', 'acc']]], 'Health')}
   <div class="scroll" style="padding:10px 12px">
    <div class="ind none"><h5>Blast radius · declared vs actual<span class="spacer"></span><span class="tag" style="background:var(--surface-3);color:var(--text-muted)">Not measured</span></h5>
     <div class="head">No plan is linked, so there is nothing to compare against.</div>
     <div class="why">This indicator is the only one that needs a plan. It appears automatically for pull requests created from Research mode.</div>
     <div class="act"><button class="btn sm">Link a plan…</button></div></div>
    ${ind('bad', 'Rule regressions', 'Your rules pass on <b>main</b> and fail here: <b>0 → 1 error</b>.',
    'New: <span class="mono">DOMAIN-001</span> — <span class="mono">guestRules.ts</span> calls <span class="mono">fetch</span>. Domain code must stay pure; that call belongs in a service.')}
    ${ind('warn', 'Unexplained changes', '<b>1 of 23 files</b> has no import path to the rest of the change.',
    '<span class="mono">core/lib/money.ts</span> — likely an unrelated fix riding along.')}
    ${ind('ok', 'Public surface', '<b>No public exports changed.</b>',
    'Every changed file is internal to its feature, so no other feature is forced to change.')}
    ${ind('warn', 'What the flow now does', '<span class="mono">checkoutMachine</span>: <b>1 path added</b>, none removed.',
    '“A shopper can now reach <b>order placed</b> without ever creating an account.” Exactly what the title claims — worth confirming it is the only new route.', '<button class="btn sm">Open Flow</button>')}
   </div>`,
  drawer: `${drawerBarPR('Findings', '2')}
  <div class="body" style="padding:10px 12px">
   <div class="callout info" style="margin:0"><span>ℹ</span><div class="grow"><b>Nothing here can be fixed mechanically</b><small>Both findings need a decision: moving a <span class="mono">fetch</span> out of domain code changes what the code does, so Construct will not do it for you. With Auto review-and-fix on, this pull request would produce <b>no</b> second pull request at all — it only opens one when there is something mechanical to apply.</small></div></div>
  </div>`,
  sb: sbar('<span>No plan linked · scope not measured</span>'),
})));

// ---------------------------------------------------------------------------------------------
// 6 — auto review-and-fix: the toggle, its consequences, and what it produces
// ---------------------------------------------------------------------------------------------
const will = (icon, cls, head, body) => `<div class="will"><span class="i ${cls}">${icon}</span><div><span class="h">${head}</span><span>${body}</span></div></div>`;

writeFileSync(join(here, 'pr-review-autofix.html'), prPage('Auto review-and-fix — off by default, and obvious before it is on', `
<div class="pr-sheet">
 <div class="cols2">
  <div>
   <h3>1 · Turning it on — every consequence stated before the switch</h3>
   <div class="dlg" role="dialog" aria-labelledby="afx">
    <div class="t" id="afx">Turn on Auto review-and-fix?</div>
    <div class="b">
     <div class="muted-note" style="padding-bottom:2px">This changes Construct from “looks at your pull requests” to “opens pull requests on this repository”. Exactly what that means:</div>
     ${will('✓', 'yes', 'It opens a separate pull request', 'Construct creates a branch — <span class="mono">construct/fix-slice-002-142</span> — applies the fixes and opens one pull request per review run. Merge it, cherry-pick from it, or close it.')}
     ${will('✗', 'no', 'It never touches the pull request under review', 'No pushes to the author’s branch, no comments on their pull request. A wrong comment is noise they must refute; a wrong pull request is one they close.')}
     ${will('✗', 'no', 'It never changes what code does', 'Only what <span class="mono">construct refactor</span> does: move a file to its layer, rewrite an import, rename to a convention. Content and exported names are never edited. No model is involved.')}
     ${will('◆', 'key', 'It needs permission you have not given yet', 'Reviewing needs read access only; opening pull requests needs push access to <span class="mono">acme/storefront</span>. Signed in as sam-dev · scope <span class="mono">repo:read</span>.')}
     ${will('—', '', 'Nothing to fix means nothing happens', 'If every finding needs a decision, no branch and no pull request are created. It never opens an empty one.')}
    </div>
    <div class="f"><span class="chkrow"><span class="chk on">✓</span>Ask me before opening each pull request</span><span class="spacer"></span>
     <button class="btn">Cancel</button><button class="btn primary">Grant push access and turn on</button></div>
   </div>
  </div>
  <div>
   <h3>2 · What it produces — a pull request that explains itself</h3>
   <div class="ghpr">
    <div class="top"><span class="hb info">Pull request</span><b>Mechanical fixes for #142 (2 findings)</b><span class="spacer"></span><span class="mono" style="color:var(--text-muted)">construct/fix-slice-002-142 → main</span></div>
    <div class="body">
     <p>Opened by Construct. <b>This pull request does not modify #142.</b> Merge it, take one commit from it, or close it — #142 is untouched either way.</p>
     <p>Every change below was applied by <span class="mono">construct refactor</span>, deterministically. <b>No language model was involved</b>, and no file content or exported name was edited.</p>
     <h6>1 · SLICE-002 — Cross-feature imports use public index.ts</h6>
     <p class="mono" style="color:var(--text-faint)">features/checkout/components/GuestForm.tsx:4</p>
     <pre><span class="d">- import { PasswordField } from '../../auth/components/PasswordField';</span><span class="a">+ import { PasswordField } from '../../auth';</span></pre>
     <p style="margin-top:6px">Features may only consume another feature through its public index API.</p>
     <h6>2 · READ-001 — Components are PascalCase</h6>
     <p class="mono" style="color:var(--text-faint)">features/auth/components/passwordToggle.tsx → PasswordToggle.tsx</p>
     <pre>renamed 1 file · updated 3 imports · no other edits</pre>
     <h6>Not fixed here — these need a decision</h6>
     <p>auth’s public API changed (<span class="mono">PasswordFieldProps</span> removed) · <span class="mono">authMachine</span> drops the retry path · <span class="mono">PasswordField</span> is shared by 3 features. See the review on #142.</p>
     <h6>Checked</h6>
     <p><span class="mono">construct validate</span> after the fixes: <span style="color:var(--success)">0 new violations</span> · 1 pre-existing (<span class="mono">PAGE-006</span>) unchanged.</p>
    </div>
   </div>
  </div>
 </div>
 <div class="cols3">
  <div><h3>Where the toggle lives — off (default)</h3>
   <div class="st-card"><div style="display:flex;align-items:center;gap:10px"><span class="tog"><span class="sw"></span><span class="st">Auto fix: Off</span></span></div>
    <p>Reviewing is read-only. Construct analyses and displays; you act.</p>
    <p class="mono" style="color:var(--text-faint)">Needs: read access only</p>
    <div class="acts"><button class="btn sm">Turn on…</button></div></div></div>
  <div><h3>On — with the standing reminder</h3>
   <div class="st-card" style="border-color:var(--accent)"><div style="display:flex;align-items:center;gap:10px"><span class="tog on"><span class="sw"></span><span class="st">Auto fix: On</span></span>${hb('info', 'asks first')}</div>
    <p>Mechanical fixes are collected and offered as one separate pull request per review run.</p>
    <p class="mono" style="color:var(--text-faint)">Needs: push access · granted 14:22</p>
    <div class="acts"><button class="btn sm">Turn off</button><button class="btn sm">Review what it would open</button></div></div></div>
  <div><h3>On, but nothing mechanical to fix</h3>
   <div class="st-card"><div style="display:flex;align-items:center;gap:10px"><span class="tog on"><span class="sw"></span><span class="st">Auto fix: On</span></span>${hb('none', 'no-op')}</div>
    <p>#139 has 2 findings and both need a decision, so nothing was opened. Construct never creates an empty pull request.</p>
    <p class="mono" style="color:var(--text-faint)">Last run 14:31 · 0 branches created</p></div></div>
 </div>
</div>`));

// ---------------------------------------------------------------------------------------------
// 7 — empty, loading, error and narrow states
// ---------------------------------------------------------------------------------------------
const st = (title, body, acts = '', note = '', border = '') => `
<div class="st-card" ${border ? `style="border-color:var(--${border})"` : ''}><h5>${title}</h5><p>${body}</p>${note}<div class="acts">${acts}</div></div>`;

writeFileSync(join(here, 'pr-review-states.html'), prPage('Pull request review — empty, loading, error and narrow states', `
<div class="pr-sheet">
 <div class="split">
  <div>
   <h3>Empty, loading and error states — each with the next action</h3>
   <div class="cols2s">
    ${st('Connect GitHub to review pull requests', 'Construct reads pull requests as you. Read-only by default: it never posts comments and never pushes to a branch.',
    '<button class="btn primary sm">Sign in with GitHub</button><button class="btn sm">Review a local branch instead</button>')}
    ${st('No open pull requests', 'When one is opened, Construct analyses it in the background and lists it here — riskiest first, not newest first.',
    '<button class="btn sm">Review a local branch…</button>', '<p class="mono" style="color:var(--text-faint)">acme/storefront · checked 12 s ago</p>')}
    ${st('Analysing #131 · 18 files', 'Comparing <span class="mono">feat/infinite-scroll</span> with <span class="mono">main</span>. The list stays usable meanwhile.',
    '<button class="btn sm">Cancel</button>', `<div class="steplist">
      <div class="s"><span class="ck">✓</span>changed files — 18</div>
      <div class="s"><span class="ck">✓</span>features and layers — 2 features</div>
      <div class="s"><span class="pill run" style="height:18px;padding:0 8px"><span class="spin"></span></span>rules on main</div>
      <div class="s"><span class="ck" style="color:var(--text-faint)">○</span>rules on this branch</div>
      <div class="s"><span class="ck" style="color:var(--text-faint)">○</span>workflow paths, before and after</div></div>
     <div class="bar-track" style="width:100%;margin-top:8px"><div class="bar-fill" style="width:48%"></div></div>
     <p class="muted-note">Deterministic — no model involved.</p>`)}
    ${st('#118 is too large for file-by-file findings', '612 files changed. A report is capped at 200 files, so per-file findings would be incomplete and misleading.',
    '<button class="btn primary sm">Show feature-level summary</button><button class="btn sm">Raise the cap…</button>',
    '<p class="muted-note">Feature counts, rule regressions and workflow paths still work — they do not depend on the cap. (<span class="mono">TRUNCATED</span>)</p>', 'warn')}
    ${st('main moved while this was being analysed', 'The comparison is 3 commits behind, so findings may name lines that have since changed.',
    '<button class="btn primary sm">Re-analyse (about 2 s)</button><button class="btn sm">Show anyway</button>',
    '<p class="mono" style="color:var(--text-faint)">analysed against 8528669 · main is now f037ba8</p>', 'warn')}
    ${st('This project has no architecture.yml', 'Construct can show the diff and the changed files, but there is no layer graph or rule set to check them against, so there are no indicators.',
    '<button class="btn sm">Open the diff</button><button class="btn sm">Set up Construct here…</button>',
    '<p class="muted-note">Common on forks and on repositories that have not adopted Construct yet.</p>')}
   </div>
  </div>
  <div>
   <h3>Narrow (390 px) — one pane at a time</h3>
   <div class="phone">
    <div class="topbar" style="height:44px;flex:none"><div class="brand"><i></i>Construct</div><span class="spacer"></span><span class="pill ok" style="height:22px"><span class="dot"></span>Read-only</span><button class="icon-btn" aria-label="Menu">≡</button></div>
    <div class="canvas-tb" style="height:auto;padding:8px 10px;display:block">
     <div class="crumbs"><b>#142</b> Add show-password toggle</div>
     <div class="hb-row wrap" style="margin-top:6px">${hb('bad', 'Scope 1 → 3')}${hb('bad', '2 rule regressions')}${hb('warn', 'Public API')}${hb('warn', 'Flow changed')}</div>
    </div>
    <div class="scroll" style="padding:10px;overflow:hidden">
     ${ind('bad', 'Blast radius', 'Plan declared <b>1 feature</b>; this touches <b>3</b>.', 'auth planned; checkout and core were not.')}
     ${ind('bad', 'Rule regressions', 'main <b>0</b> → here <b>2</b>.', 'SLICE-002 · READ-001. Both can be fixed mechanically.')}
     ${ind('warn', 'What the flow now does', '<span class="mono">authMachine</span>: <b>1 path removed</b>.', 'A rejected sign-in can no longer be retried.')}
     ${ind('warn', 'Public surface', '<b>1 export removed</b> from auth.', '2 features import auth’s public API.')}
     ${ind('warn', 'Unexplained changes', '<b>4 of 11 files</b> have no path to the plan.', 'Mostly <span class="mono">core/lib</span> — a stray edit riding along.')}
     <div class="muted-note" style="margin-top:10px">5 findings · 2 can be fixed mechanically. Tap Findings for the evidence.</div>
    </div>
    <div class="tabbar" role="tablist"><div>Units</div><div>Summary</div><div class="on">Health</div><div>Findings</div></div>
   </div>
  </div>
 </div>
</div>`));

console.log('pr-review mocks written');
