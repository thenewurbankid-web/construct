// Concept mocks for the five-screen information architecture (Features / Pages / Components / PRs / Tests).
// Usage: node docs/design/mocks/build-ia.mjs && node docs/design/mocks/render.mjs ia-
// Content is illustrative storefront data (same as the other mocks), not repo output.
// Vocabulary (owner decision): the title + free text describing a change is a "Note"; steps stay "Plan".
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tabs, stateCard } from './parts.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const page = (title, body) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title} - Concept</title>
<link rel="stylesheet" href="mock.css"><link rel="stylesheet" href="ia.css">
<script>document.documentElement.dataset.theme = new URLSearchParams(location.search).get('theme') || 'dark';</script>
</head><body>
<div class="concept">Concept - not implemented <span>${title}</span></div>
${body}
</body></html>`;

const SCREENS = ['Features', 'Pages', 'Components', 'PRs', 'Tests'];
const topbar = ({ screen, menuOpen = false, off = false, procs = '2 running', project = true }) => `
<header class="topbar" role="banner">
  <div class="brand"><i></i>Cockpit</div>
  ${project ? '<button class="chip-btn" aria-haspopup="listbox">storefront <span class="sub">main</span> &#9662;</button>' : '<button class="chip-btn" aria-haspopup="listbox">No project &#9662;</button>'}
  <nav class="snav ${off ? 'off' : ''}" aria-label="Screens">${SCREENS.map((s) => `<a class="${s === screen ? 'on' : ''}" ${s === screen ? 'aria-current="page"' : ''}>${s}${s === 'PRs' && !off ? ' <span class="badge">3</span>' : ''}</a>`).join('')}</nav>
  <button class="chip-btn palette-trigger"><span>Search or run a command...</span><kbd>Ctrl K</kbd></button>
  <span class="pill run"><span class="spin"></span>${procs}</span>
  <button class="acct ${menuOpen ? 'open' : ''}" aria-haspopup="true" aria-expanded="${menuOpen}"><span class="avatar">SP</span>shashank-p &#9662;</button>
</header>`;

const menuInner = `
  <div class="who"><span class="avatar">SP</span><div><b>shashank-p</b><small>Signed in with GitHub</small></div></div>
  <div class="mgrp">Preferences</div>
  <div class="mi on"><span class="g">&#9881;</span>Settings<span class="r">Git, commits, model choice</span></div>
  <div class="mi"><span class="g">&#9673;</span>Local model<span class="r"><span class="pill ok" style="height:20px;padding:0 8px"><span class="dot"></span>Ready</span></span></div>
  <div class="mi"><span class="g">&#9680;</span>Theme<span class="r"><span class="seg"><button class="on">Dark</button><button>Light</button><button>System</button></span></span></div>
  <div class="msep"></div>
  <div class="mi"><span class="g">?</span>Help and shortcuts<span class="r"><kbd>?</kbd></span></div>
  <div class="msep"></div>
  <div class="mi"><span class="g">&#8677;</span>Sign out<span class="r">Ends this session only</span></div>`;
const menu = `<div class="menu" role="group" aria-label="Account">${menuInner}</div>`;

const bottom = (on = 'Processes', body, h = 150, counts = { p: '2', a: '1' }) => `
<div class="drawer" aria-label="Bottom panel: Run" style="height:${h}px">
  ${tabs([['Processes', [counts.p, 'acc']], ['Approvals', [counts.a, '']], ['Diagnostics', ['3', 'danger']], ['Logs', null]], on)}
  <div class="body">${body}</div>
</div>`;

const procTable = `
<table><tr><th>Process</th><th>Project</th><th>Step</th><th>Progress</th><th>Who</th><th></th></tr>
<tr><td><b>plan &middot; refund a delivered order</b></td><td>storefront</td><td>3 of 5 &middot; propose refundMachine</td><td><div class="bar-track"><div class="bar-fill" style="width:60%"></div></div></td><td><span class="tag llm">Local model</span></td><td><button class="btn sm">Pause</button> <button class="btn sm danger">Cancel</button></td></tr>
<tr><td>research &middot; issue #142</td><td>storefront</td><td>Done &middot; 2 min ago</td><td>Finished</td><td><span class="tag det">Deterministic</span></td><td><button class="btn sm primary">Review 4 files</button></td></tr>
</table>`;

const statusbar = `<footer class="statusbar"><span class="ok">&#9679; validate: 0 new violations</span><span>Notes saved on this machine</span><span class="spacer"></span><span>qwen2.5-coder:7b</span><span><kbd>F6</kbd> next panel</span><span><kbd>Ctrl J</kbd> bottom panel</span></footer>`;

const frame = ({ screen, left, mid, right, bot, menuOpen, extra = '', off, procs, project, lw, rw, botH = 150 }) => `
<div class="shell" style="${lw ? `--lw:${lw}px;` : ''}${rw ? `--rw:${rw}px;` : ''}grid-template-rows:44px 1fr ${botH}px 24px;position:relative">
  ${topbar({ screen, menuOpen, off, procs, project })}
  <div class="ia-main">
    <aside class="pane" aria-label="Left panel: Browse">${left}</aside><div class="resizer" role="separator" aria-orientation="vertical" tabindex="0"></div>
    <section class="pane mid" aria-label="Center stage">${mid}</section><div class="resizer" role="separator" aria-orientation="vertical" tabindex="0"></div>
    <aside class="pane" aria-label="Right panel: Inspect">${right}</aside>
  </div>
  ${bot}
  ${statusbar}
  ${menuOpen ? menu : ''}${extra}
</div>`;

const L = (k) => `<span class="layer ${k}">${k}</span>`;

/* ------------------------------------------------ 1 Features screen (hero) */
const featLeft = `
  <div class="pane-h"><span class="title">Features</span><span class="spacer"></span><button class="icon-btn" aria-label="New note">+</button><button class="icon-btn" aria-label="Collapse">&laquo;</button></div>
  ${tabs([['Notes', ['3', 'acc']], ['Features']], 'Notes')}
  <div class="search">&#8981; Filter notes <span class="spacer"></span><kbd>/</kbd></div>
  <div class="scroll"><div class="sect">Notes &middot; 3</div><div class="tree" style="padding:0 6px">
    <div class="dr sel"><span class="n">Refund a delivered order</span><span class="st draft">Draft</span><span class="s">Saved 12:41 &middot; edited 2 min ago</span></div>
    <div class="dr"><span class="n">Guest checkout</span><span class="st ready">Plan ready</span><span class="s">5 steps &middot; yesterday</span></div>
    <div class="dr"><span class="n">Split cart totals</span><span class="st run">Ran</span><span class="s">Process #12 &middot; 3 days ago</span></div>
  </div>
  <div class="sect" style="margin-top:8px">Features &middot; 4</div><div class="tree">
    <div class="row"><span class="twisty">&#9656;</span>auth<span class="meta">7 files</span></div>
    <div class="row"><span class="twisty">&#9656;</span>cart<span class="meta">11 files</span></div>
    <div class="row"><span class="twisty">&#9656;</span>checkout<span class="meta">9 files</span></div>
    <div class="row"><span class="twisty">&#9656;</span>orders<span class="meta">6 files</span></div>
  </div></div>`;
const impactRows = [['orders', 'feature', 'starts here'], ['checkout', 'feature', 'imports orderService'], ['ui-kit', 'component', 'AmountField used by 5 features']];
const featMid = `
  <div class="canvas-tb"><span class="crumbs">Features &rsaquo; Notes &rsaquo; <b>Refund a delivered order</b></span><span class="spacer"></span><span class="saveind ok">&#10003; Saved on this machine &middot; 12:41</span></div>
  <div style="overflow:hidden;flex:1">
  <div class="notebox"><div class="t">Refund a delivered order<span class="spacer"></span><span class="st draft">Draft</span></div>
    <div class="b">Customers should be able to request a refund from the order page within 30 days of delivery. Partial refunds allowed. Needs a confirmation step and an audit entry.</div>
    <div class="f"><span class="saveind">Autosaves as you type &middot; stays on this machine, never sent to a model</span><span class="spacer"></span><button class="btn sm">Research this note</button></div></div>
  <div class="sect" style="padding:16px 18px 6px">Impact <span class="tag det" style="margin-left:8px">Deterministic</span></div>
  <div style="margin:0 18px;background:var(--surface-1);border:1px solid var(--border-subtle);border-radius:var(--r-lg)"><table><tr><th>Where</th><th>Layer</th><th>Why</th><th>How known</th></tr>
  ${impactRows.map((r) => `<tr><td><b>${r[0]}</b></td><td>${L(r[1])}</td><td>${r[2]}</td><td><span class="tag det">Deterministic</span></td></tr>`).join('')}</table></div></div>`;
const featRight = `
  <div class="pane-h"><span class="title">Plan</span><span class="spacer"></span><span class="tag llm">1 model step</span></div>
  ${tabs([['Note'], ['Impact'], ['Plan', ['5', 'acc']]], 'Plan')}
  <div class="scroll">
    ${[['Summarize the orders feature', 'construct research summarize', 'det'], ['Trace refund paths in checkout', 'construct research workflow', 'det'], ['Propose refundMachine states', 'local model (qwen2.5-coder:7b)', 'llm'], ['Add refundService and hook', 'construct create service, hook', 'det'], ['You approve the diff', 'nothing applied without you', 'human']]
      .map((s, i) => `<div class="step"><span class="no">${i + 1}</span><div><b>${s[0]}</b><small>${s[1]}</small></div><span class="tag ${s[2]}">${{ det: 'Deterministic', llm: 'Local model', human: 'You' }[s[2]]}</span></div>`).join('')}
    <div style="padding:12px;display:flex;gap:8px"><button class="btn primary">Run plan</button><button class="btn">Edit steps</button></div>
  </div>`;
const features = frame({ screen: 'Features', left: featLeft, mid: featMid, right: featRight, bot: bottom('Processes', procTable) });

/* ------------------------------------------------ 2 Account menu on Pages */
const pagesLeft = `
  <div class="pane-h"><span class="title">Pages</span><span class="spacer"></span><button class="icon-btn">&laquo;</button></div>
  <div class="search">&#8981; Filter routes <span class="spacer"></span><kbd>/</kbd></div>
  <div class="scroll"><div class="sect">Pages &middot; 6</div><div class="tree">${['/', '/login', '/register', '/cart', '/checkout', '/products/[id]'].map((p, i) => `<div class="row ${i === 1 ? 'sel' : ''}">${L('page')}${p}<span class="meta">${['catalog', 'auth', 'auth', 'cart', 'checkout', 'catalog'][i]}</span></div>`).join('')}</div></div>`;
const pagesMid = `
  <div class="canvas-tb"><span class="crumbs">Pages &rsaquo; <b>/login</b></span><span class="spacer"></span><button class="btn sm">&#8853; Pick</button></div>
  <div class="stage"><div class="device" style="height:400px"><div class="bar"><i></i><i></i><i></i>&nbsp;&nbsp;localhost:5173/login</div><div class="app-nav"><b>Storefront</b><span>Catalog</span><span>Cart (2)</span></div><div class="login"><h2>Welcome back</h2><p>Sign in to continue.</p><label>Email</label><div class="in">sam@example.com</div><div class="cta">Sign in</div></div></div></div>`;
const pagesRight = `<div class="pane-h"><span class="title">Inspect</span></div>${tabs([['Inspector'], ['Scope'], ['Source'], ['Diff']], 'Inspector')}<div class="section"><div class="el-head"><span class="name">LoginForm</span>${L('component')}</div><div class="path">features/auth/components/LoginForm.tsx:14</div></div>`;
const menuMock = frame({ screen: 'Pages', left: pagesLeft, mid: pagesMid, right: pagesRight, bot: bottom('Processes', procTable, 134), menuOpen: true, botH: 134 });

/* ------------------------------------------------ 3 Slot matrix */
const cell = (arr) => arr.map((x) => `<span>${x}</span>`).join('');
const matrix = `
<div class="hh">Every screen fills the same four slots<small>Left = browse, Center = the thing itself, Right = inspect and act (verbs are tabs), Bottom = run and approve. A slot is a registered tab list, not a hard-wired panel.</small></div>
<table class="mx"><tr><th></th><th>Left panel (browse)</th><th>Center stage</th><th>Right panel (verb tabs)</th><th>Bottom panel (run)</th></tr>
<tr><td>Features</td><td>${cell(['<b>Tabs</b>Notes | Features', 'Saved notes, feature tree with summaries'])}</td><td>${cell(['Your note and its impact table', 'Feature summary and its flow', 'Create / Refactor / Import forms'])}</td><td>${cell(['<b>Verbs</b>Note | Impact | Plan', 'Plan steps tagged Deterministic / Local model / You'])}</td><td>Processes, Approvals, Diagnostics, Logs</td></tr>
<tr><td>Pages</td><td>${cell(['<b>Tabs</b>Pages | Flow', 'Route tree, flow tree'])}</td><td>Live preview, click to select</td><td>${cell(['<b>Verbs</b>Inspector | Scope | Source | Diff'])}</td><td>same bottom panel</td></tr>
<tr><td>Components</td><td>${cell(['<b>Tabs</b>Components | Workflows', 'Component tree, state machines'])}</td><td>${cell(['Component in isolation', 'or workflow diagram / narrative'])}</td><td>${cell(['<b>Verbs</b>Inspector | Used by | Source | Diff | Flow'])}</td><td>same bottom panel</td></tr>
<tr><td>PRs</td><td>${cell(['<b>Tabs</b>Open PRs | Branches', 'Changed-file tree'])}</td><td>Change view, blast radius</td><td>${cell(['<b>Verbs</b>Findings | Detail | Plan match', 'Review lives here'])}</td><td>Analysis process, Approvals for auto-fix</td></tr>
<tr><td>Tests</td><td>${cell(['<b>Tabs</b>Tests | Coverage', 'Scenario and test list'])}</td><td>Test steps document, run result</td><td>${cell(['<b>Verbs</b>Edit step | Record | Freshness'])}</td><td>Test runs as processes</td></tr>
</table>
<p class="note">Not screens: Settings, Local model, Help, account and sign-out (top-right profile menu); the project switcher (top bar); the command palette (Ctrl K). The bottom panel is identical on every screen, so a running process or a waiting approval is never more than one keypress away (Ctrl J).</p>`;

/* ------------------------------------------------ 4 Notes states */
const dcard = (h, ind, body, extra = '') => `<div class="card"><b>${h}</b><div>${ind}</div><p>${body}</p>${extra}</div>`;
const drafts = `
<div class="hh">Notes: durable, per project, on this machine<small>Autosaved on the server into the per-user state directory. Never committed, never sent to a model unless you press a model step.</small></div>
<div class="sheet3">
 <div><h3>While you type</h3>
  ${dcard('Saving', '<span class="saveind busy"><span class="spin"></span> Saving...</span>', 'Fires 800 ms after you stop typing. The text is never blocked.')}
  ${dcard('Saved', '<span class="saveind ok">&#10003; Saved on this machine &middot; 12:41</span>', 'Reload the page or restart the Cockpit and the note is still there.')}
  ${dcard('Empty', '<span class="saveind">No notes yet</span>', 'Describe a change you want. It saves as you go.', '<div><button class="btn primary sm">New note</button></div>')}</div>
 <div><h3>When something is wrong</h3>
  ${dcard('Changed somewhere else', '<span class="saveind warn">&#9888; This note changed in another tab</span>', 'Two tabs edited the same note. Nothing is overwritten. Choose which copy wins.', '<div><button class="btn sm primary">Keep mine</button> <button class="btn sm">Load theirs</button> <button class="btn sm">Compare</button></div>')}
  ${dcard('Could not save', '<span class="saveind bad">&#10005; Not saved &middot; disk full</span>', 'Your text stays in the page. Free some space and press Retry. Do not close the tab yet.', '<div><button class="btn sm primary">Retry</button></div>')}</div>
 <div><h3>Life of a note</h3>
  ${dcard('Draft', '<span class="st draft">Draft</span>', 'Editable. Autosaved. Listed under Features, Notes.')}
  ${dcard('Plan ready', '<span class="st ready">Plan ready</span>', 'Steps proposed and tagged. Still editable; editing the text marks the plan Out of date.')}
  ${dcard('Ran', '<span class="st run">Ran</span> Process #12', 'Pressing Run copies the note and plan into a process record. The note becomes read-only history; duplicate it to iterate.')}</div>
</div>`;

/* ------------------------------------------------ 5 No project */
const noProj = frame({
  screen: 'Features', off: true, project: false, procs: '0 running',
  left: `<div class="pane-h"><span class="title">Features</span></div><div class="scroll" style="padding:14px;color:var(--text-muted)">Nothing to browse until a project is open.</div>`,
  mid: `<div class="stage">${stateCard('&#9635;', 'Open a project to start', 'Pick a folder that contains an architecture.yml, or open a repository from GitHub.', '<button class="btn primary">Open a project...</button>')}<div class="slotlab" style="left:16px;top:12px">Being built separately (workspace-scoped): only its position is shown here</div></div>`,
  right: `<div class="pane-h"><span class="title">Inspect</span></div><div class="scroll" style="padding:14px;color:var(--text-muted)">Select something to inspect.</div>`,
  bot: bottom('Processes', '<div style="padding:14px;color:var(--text-muted)">No processes yet. Running and finished processes for a project appear here, on every screen.</div>', 110, { p: '0', a: '0' }), botH: 110,
});

/* ------------------------------------------------ 6 PRs */
const prs = frame({
  screen: 'PRs',
  left: `<div class="pane-h"><span class="title">PRs</span><span class="spacer"></span><button class="icon-btn">&laquo;</button></div>${tabs([['Open PRs', ['3', 'acc']], ['Branches']], 'Open PRs')}<div class="scroll"><div class="tree" style="padding-top:8px">
   <div class="dr sel"><span class="n">#341 Refund a delivered order</span><span class="st stale">2 findings</span><span class="s">shashank-p &middot; 11 files &middot; matches plan</span></div>
   <div class="dr"><span class="n">#338 Guest checkout</span><span class="st run">Clean</span><span class="s">4 files</span></div>
   <div class="dr"><span class="n">#335 Fix cart rounding</span><span class="st draft">No plan</span><span class="s">2 files</span></div></div>
   <div class="sect">Changed files &middot; 11</div><div class="tree"><div class="row">${L('workflow')}refundMachine.ts<span class="meta">+64</span></div><div class="row sel">${L('component')}RefundForm.tsx<span class="meta">+38 -2</span></div><div class="row">${L('component')}AmountField.tsx<span class="meta">+3</span></div></div></div>`,
  mid: `<div class="canvas-tb"><span class="crumbs">PRs &rsaquo; #341 &rsaquo; <b>RefundForm.tsx</b></span><span class="spacer"></span><span class="tag det">Deterministic checks</span></div>
   <div class="scroll"><div class="code">${[['12', ' import { useRefundForm } from "../hooks/useRefundForm";', ''], ['13', '+import { orderService } from "@/features/orders/services/orderService";', 'add'], ['14', ' export function RefundForm() {', ''], ['15', '+  const orders = orderService.list();', 'add'], ['16', '   return <AmountField />;', '']].map((l) => `<div class="ln ${l[2]}"><i>${l[0]}</i><span>${l[1].replace(/</g, '&lt;')}</span></div>`).join('')}</div>
   <div class="callout warn"><span>&#9888;</span><div class="grow"><b>A component imports a service</b><small>Components go through a hook. Rule COMPONENT-002, deterministic.</small></div><button class="btn sm">Show in findings</button></div></div>`,
  right: `<div class="pane-h"><span class="title">Review</span></div>${tabs([['Findings', ['2', '']], ['Detail'], ['Plan match']], 'Findings')}<div class="scroll">
   <div class="step"><span class="no">!</span><div><b>Component imports a service</b><small>RefundForm.tsx:13 &middot; COMPONENT-002</small></div><span class="tag det">Deterministic</span></div>
   <div class="step"><span class="no">!</span><div><b>Touches shared AmountField (used by 5 features)</b><small>not in the plan</small></div><span class="tag det">Deterministic</span></div>
   <div style="padding:12px"><button class="btn">Propose a fix</button> <span class="tag llm">Local model - diff shown first</span></div></div>`,
  bot: bottom('Approvals', `<table><tr><th>Waiting for you</th><th>Proposed by</th><th></th></tr><tr><td><b>Fix: route RefundForm through useRefundForm</b> &middot; 1 file, +4 -2</td><td><span class="tag llm">Local model</span></td><td><button class="btn sm primary">Review diff</button> <button class="btn sm">Dismiss</button></td></tr></table>`, 110, { p: '1', a: '1' }), botH: 110,
});

/* ------------------------------------------------ 7 Narrow */
const phone = (title, tab, body, extra = '') => `<div><h3 style="margin:0 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.07em;color:var(--text-muted)">${title}</h3><div class="narrow" style="position:relative;height:780px">
 <div class="topbar" style="height:44px;flex:none"><div class="brand"><i></i>Cockpit</div><span class="spacer"></span><span class="pill run"><span class="spin"></span>2</span><span class="avatar" aria-label="Account">SP</span></div>
 <nav class="snav" aria-label="Screens" style="height:38px;overflow:hidden;border-bottom:1px solid var(--border-subtle);flex:none;margin:0;padding:0 4px">${['Features', 'Pages', 'Comp.', 'PRs', 'Tests'].map((s, i) => `<a class="${i === 0 ? 'on' : ''}" style="padding:0 9px;font-size:12px">${s}</a>`).join('')}</nav>
 <div style="flex:1;overflow:hidden;position:relative">${body}${extra}</div>
 <div class="tabbar" role="tablist">${['Browse', 'Stage', 'Inspect', 'Run'].map((t) => `<div class="${t === tab ? 'on' : ''}" role="tab">${t}${t === 'Run' ? ' <span class="badge acc">2</span>' : ''}</div>`).join('')}</div></div></div>`;
const narrow = `<div class="sheet3" style="grid-template-columns:repeat(3,390px);justify-content:space-between">
 ${phone('Browse: notes', 'Browse', `<div class="sect">Notes &middot; 3</div><div class="tree" style="padding:0 6px">
   <div class="dr sel"><span class="n">Refund a delivered order</span><span class="st draft">Draft</span><span class="s">Saved 12:41</span></div><div class="dr"><span class="n">Guest checkout</span><span class="st ready">Plan ready</span><span class="s">5 steps</span></div><div class="dr"><span class="n">Split cart totals</span><span class="st run">Ran</span><span class="s">Process #12</span></div></div>`)}
 ${phone('Run: processes and approvals', 'Run', `<div style="padding:10px;display:grid;gap:10px"><div class="card"><b>plan &middot; refund a delivered order</b><div class="bar-track" style="width:100%"><div class="bar-fill" style="width:60%"></div></div><span class="saveind">Step 3 of 5 &middot; <span class="tag llm">Local model</span></span><div><button class="btn sm">Pause</button> <button class="btn sm danger">Cancel</button></div></div><div class="card"><b>1 approval waiting</b><p>Fix: route RefundForm through useRefundForm</p><button class="btn sm primary">Review diff</button></div></div>`)}
 ${phone('Account menu (sheet)', 'Stage', `<div style="padding:14px;color:var(--text-muted)">Stage content is dimmed behind the sheet.</div>`, `<div class="menu" style="top:auto;bottom:0;left:0;right:0;width:auto;border-radius:var(--r-lg) var(--r-lg) 0 0">${menuInner}</div>`)}
</div>`;

const out = { 'ia-features': features, 'ia-account-menu': menuMock, 'ia-slot-matrix': matrix, 'ia-notes-states': drafts, 'ia-no-project': noProj, 'ia-prs': prs, 'ia-narrow': narrow };
const titles = { 'ia-features': 'Features screen: notes, impact, plan, processes', 'ia-account-menu': 'Account menu: settings, local model, theme, help, sign out', 'ia-slot-matrix': 'Five screens, four slots', 'ia-notes-states': 'Notes: durable states', 'ia-no-project': 'No project: where the Open a project prompt sits', 'ia-prs': 'PRs screen: review inside the shell', 'ia-narrow': 'Narrow (390 px): one panel at a time' };
for (const [k, v] of Object.entries(out)) writeFileSync(join(here, `${k}.html`), page(titles[k], v));
console.log('ia mocks written');
