// Concept mocks for the five-screen information architecture (Features / Pages / Components / Git / Tests).
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

const SCREENS = ['Features', 'Pages', 'Components', 'Git', 'Tests'];
const topbar = ({ screen, menuOpen = false, off = false, procs = '2 running', project = true }) => `
<header class="topbar" role="banner">
  <div class="brand"><i></i>Cockpit</div>
  ${project ? '<button class="chip-btn" aria-haspopup="listbox">storefront <span class="sub">main</span> &#9662;</button>' : '<button class="chip-btn" aria-haspopup="listbox">No project &#9662;</button>'}
  <nav class="snav ${off ? 'off' : ''}" aria-label="Screens">${SCREENS.map((s) => `<a class="${s === screen ? 'on' : ''}" ${s === screen ? 'aria-current="page"' : ''}>${s}${s === 'Git' && !off ? ' <span class="badge">3</span>' : ''}</a>`).join('')}</nav>
  <button class="chip-btn palette-trigger"><span>Search or run a command...</span><kbd>Ctrl K</kbd></button>
  <span class="pill run"><span class="spin"></span>${procs}</span>
  <button class="acct ${menuOpen ? 'open' : ''}" aria-haspopup="true" aria-expanded="${menuOpen}"><span class="avatar">SP</span>shashank-p &#9662;</button>
</header>`;

const menuInner = `
  <div class="who"><span class="avatar">SP</span><div><b>shashank-p</b><small>Signed in with GitHub</small></div></div>
  <div class="mgrp">Preferences</div>
  <div class="mi on"><span class="g">&#9881;</span>Settings<span class="r">Git, commits, model choice</span></div>
  <div class="mi"><span class="g">&#9673;</span>Local model<span class="r"><span class="pill ok" style="height:20px;padding:0 8px"><span class="dot"></span>Ready</span></span></div>
  <div class="mi"><span class="g">&#9680;</span>Theme<span class="r"><span class="seg"><button>Dark</button><button>Light</button><button class="on">System</button></span></span></div>
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
<tr><td>Git</td><td>${cell(['<b>Tabs</b>Changes | Branches | PRs | Commits', 'Changed-file tree, branch and PR lists'])}</td><td>${cell(['Change view, blast radius', 'Connect / clone a remote (empty state)'])}</td><td>${cell(['<b>Verbs</b>Findings | Detail | Plan match | Commit (auto-commit, branch, dirty tree)', 'Review lives here, inside Git'])}</td><td>Analysis process, Approvals for auto-fix</td></tr>
<tr><td>Tests</td><td>${cell(['<b>Tabs</b>Tests | Coverage', 'Scenario and test list'])}</td><td>Test steps document, run result</td><td>${cell(['<b>Verbs</b>Edit step | Record | Freshness'])}</td><td>Test runs as processes</td></tr>
</table>
<p class="note">Git holds source control (changes, branches, commits), pull requests and Review. Not screens: Settings, Local model, Help, account and sign-out (top-right profile menu); the project switcher (top bar); the command palette (Ctrl K). The bottom panel is identical on every screen, so a running process or a waiting approval is never more than one keypress away (Ctrl J).</p>`;

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
  mid: `<div class="stage">${stateCard('&#9635;', 'Open a project to start', 'Pick a folder that contains an architecture.yml, or open a repository from GitHub.', '<div><button class="btn primary">Open a project...</button> <button class="btn">Clone a repository...</button></div>')}<div class="slotlab" style="left:16px;top:12px">Prompt and clone are built separately (workspace-scoped, #330 slice A): only their position is shown here</div></div>`,
  right: `<div class="pane-h"><span class="title">Inspect</span></div><div class="scroll" style="padding:14px;color:var(--text-muted)">Select something to inspect.</div>`,
  bot: bottom('Processes', '<div style="padding:14px;color:var(--text-muted)">No processes yet. Running and finished processes for a project appear here, on every screen.</div>', 110, { p: '0', a: '0' }), botH: 110,
});

/* ------------------------------------------------ 6 Git (PRs + Review inside) */
const gitLeft = (tab) => `<div class="pane-h"><span class="title">Git</span><span class="spacer"></span><button class="btn sm" aria-label="Connect remote">Connect remote</button><button class="icon-btn">&laquo;</button></div>${tabs([['Changes', ['11', '']], ['Branches'], ['PRs', ['3', 'acc']], ['Commits']], tab)}<div class="scroll"><div class="tree" style="padding-top:8px">
   <div class="dr sel"><span class="n">#341 Refund a delivered order</span><span class="st stale">2 findings</span><span class="s">shashank-p &middot; 11 files &middot; matches plan</span></div>
   <div class="dr"><span class="n">#338 Guest checkout</span><span class="st run">Clean</span><span class="s">4 files</span></div>
   <div class="dr"><span class="n">#335 Fix cart rounding</span><span class="st draft">No plan</span><span class="s">2 files</span></div></div>
   <div class="sect">Changed files &middot; 11</div><div class="tree"><div class="row">${L('workflow')}refundMachine.ts<span class="meta">+64</span></div><div class="row sel">${L('component')}RefundForm.tsx<span class="meta">+38 -2</span></div><div class="row">${L('component')}AmountField.tsx<span class="meta">+3</span></div></div></div>`;
const git = frame({
  screen: 'Git', lw: 356,
  left: gitLeft('PRs'),
  mid: `<div class="canvas-tb"><span class="crumbs">Git &rsaquo; PRs &rsaquo; #341 &rsaquo; <b>RefundForm.tsx</b></span><span class="spacer"></span><span class="tag det">Deterministic checks</span></div>
   <div class="scroll"><div class="code">${[['12', ' import { useRefundForm } from "../hooks/useRefundForm";', ''], ['13', '+import { orderService } from "@/features/orders/services/orderService";', 'add'], ['14', ' export function RefundForm() {', ''], ['15', '+  const orders = orderService.list();', 'add'], ['16', '   return <AmountField />;', '']].map((l) => `<div class="ln ${l[2]}"><i>${l[0]}</i><span>${l[1].replace(/</g, '&lt;')}</span></div>`).join('')}</div>
   <div class="callout warn"><span>&#9888;</span><div class="grow"><b>A component imports a service</b><small>Components go through a hook. Rule COMPONENT-002, deterministic.</small></div><button class="btn sm">Show in findings</button></div></div>`,
  right: `<div class="pane-h"><span class="title">Review and commit</span></div>${tabs([['Findings', ['2', '']], ['Detail'], ['Plan match'], ['Commit']], 'Findings')}<div class="scroll">
   <div class="step"><span class="no">!</span><div><b>Component imports a service</b><small>RefundForm.tsx:13 &middot; COMPONENT-002</small></div><span class="tag det">Deterministic</span></div>
   <div class="step"><span class="no">!</span><div><b>Touches shared AmountField (used by 5 features)</b><small>not in the plan</small></div><span class="tag det">Deterministic</span></div>
   <div style="padding:12px"><button class="btn">Propose a fix</button> <span class="tag llm">Local model - diff shown first</span></div></div>`,
  bot: bottom('Approvals', `<table><tr><th>Waiting for you</th><th>Proposed by</th><th></th></tr><tr><td><b>Fix: route RefundForm through useRefundForm</b> &middot; 1 file, +4 -2</td><td><span class="tag llm">Local model</span></td><td><button class="btn sm primary">Review diff</button> <button class="btn sm">Dismiss</button></td></tr></table>`, 134, { p: '1', a: '1' }), botH: 134,
});

/* Git with no remote: where "Connect remote" (clone and connect, #330 slice A) sits */
const gitConnect = frame({
  screen: 'Git', lw: 356,
  left: `<div class="pane-h"><span class="title">Git</span><span class="spacer"></span><button class="btn sm primary" aria-label="Connect remote">Connect remote</button></div>${tabs([['Changes', ['3', '']], ['Branches'], ['PRs'], ['Commits']], 'Changes')}<div class="scroll"><div class="sect">Changed files &middot; 3</div><div class="tree"><div class="row">${L('page')}checkout/page.tsx<span class="meta">+4 -1</span></div><div class="row">${L('component')}CartTotals.tsx<span class="meta">+12</span></div><div class="row">${L('workflow')}cartMachine.ts<span class="meta">+2</span></div></div></div>`,
  mid: `<div class="stage">${stateCard('&#8644;', 'This project has no remote yet', 'Connect a GitHub repository to see pull requests, branches and reviews here. Cloning always goes into your single workspace root.', '<div><button class="btn primary">Connect remote...</button> <button class="btn">Clone a repository...</button></div>')}<div class="slotlab" style="left:16px;top:12px">Being built as #330 slice A: only its position is shown here</div></div>`,
  right: `<div class="pane-h"><span class="title">Review</span></div><div class="scroll" style="padding:14px;color:var(--text-muted)">Findings appear here once a pull request is selected. Local changes can still be reviewed against the plan.</div>`,
  bot: bottom('Processes', '<div style="padding:14px;color:var(--text-muted)">No processes yet. Running and finished processes for a project appear here, on every screen.</div>', 110, { p: '0', a: '0' }), botH: 110,
});

/* ------------------------------------------------ 7 Narrow */
const phone = (title, tab, body, extra = '') => `<div><h3 style="margin:0 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.07em;color:var(--text-muted)">${title}</h3><div class="narrow" style="position:relative;height:780px">
 <div class="topbar" style="height:44px;flex:none"><div class="brand"><i></i>Cockpit</div><span class="spacer"></span><span class="pill run"><span class="spin"></span>2</span><span class="avatar" aria-label="Account">SP</span></div>
 <nav class="snav" aria-label="Screens" style="height:38px;overflow:hidden;border-bottom:1px solid var(--border-subtle);flex:none;margin:0;padding:0 4px">${['Features', 'Pages', 'Comp.', 'Git', 'Tests'].map((s, i) => `<a class="${i === 0 ? 'on' : ''}" style="padding:0 9px;font-size:12px">${s}</a>`).join('')}</nav>
 <div style="flex:1;overflow:hidden;position:relative">${body}${extra}</div>
 <div class="tabbar" role="tablist">${['Browse', 'Stage', 'Inspect', 'Run'].map((t) => `<div class="${t === tab ? 'on' : ''}" role="tab">${t}${t === 'Run' ? ' <span class="badge acc">2</span>' : ''}</div>`).join('')}</div></div></div>`;
const narrow = `<div class="sheet3" style="grid-template-columns:repeat(3,390px);justify-content:space-between">
 ${phone('Browse: notes', 'Browse', `<div class="sect">Notes &middot; 3</div><div class="tree" style="padding:0 6px">
   <div class="dr sel"><span class="n">Refund a delivered order</span><span class="st draft">Draft</span><span class="s">Saved 12:41</span></div><div class="dr"><span class="n">Guest checkout</span><span class="st ready">Plan ready</span><span class="s">5 steps</span></div><div class="dr"><span class="n">Split cart totals</span><span class="st run">Ran</span><span class="s">Process #12</span></div></div>`)}
 ${phone('Run: processes and approvals', 'Run', `<div style="padding:10px;display:grid;gap:10px"><div class="card"><b>plan &middot; refund a delivered order</b><div class="bar-track" style="width:100%"><div class="bar-fill" style="width:60%"></div></div><span class="saveind">Step 3 of 5 &middot; <span class="tag llm">Local model</span></span><div><button class="btn sm">Pause</button> <button class="btn sm danger">Cancel</button></div></div><div class="card"><b>1 approval waiting</b><p>Fix: route RefundForm through useRefundForm</p><button class="btn sm primary">Review diff</button></div></div>`)}
 ${phone('Account menu (sheet)', 'Stage', `<div style="padding:14px;color:var(--text-muted)">Stage content is dimmed behind the sheet.</div>`, `<div class="menu" style="top:auto;bottom:0;left:0;right:0;width:auto;border-radius:var(--r-lg) var(--r-lg) 0 0">${menuInner}</div>`)}
</div>`;

const runProcs = () => `<table><tr><th>Process</th><th>Project</th><th>Status</th><th></th></tr>
 <tr><td><b>dev server &middot; storefront</b> <span class="tag det">Deterministic</span></td><td>storefront (inside the workspace)</td><td>running on :5173 &middot; 14 min</td><td><button class="btn sm">Restart</button> <button class="btn sm danger">Stop</button></td></tr></table>`;

/* ================================================= POC parity (preview-first Pages / Components), quiet IDE feel */
// Density rule: at rest the tree shows at most ONE dot per row; badges, impact, tests, findings and Notes
// appear on the SELECTED row and in the right panel (collapsed sections). Overlays sit in one menu.
const nb = (k, t) => `<span class="nb ${k}">${t}</span>`;
const dot = (k, t) => `<span class="nd ${k}" title="${t}" aria-label="${t}"></span>`;
const trow = (lvl, layer, name, tail = '', o = {}) => `<div class="row l${lvl} ${o.sel ? 'sel' : ''}">${o.tw ? `<span class="twisty">${o.tw}</span>` : ''}${L(layer)}<span>${name}</span><span class="nbs">${tail}</span></div>`;
const etabs = (items) => `<div class="etabs" role="tablist">${items.map(([n, on, pin]) => `<button role="tab" class="${on ? 'on' : ''}" aria-selected="${!!on}">${pin ? '&#9679; ' : ''}${n}${pin ? '' : ' <span class="x">&times;</span>'}</button>`).join('')}</div>`;
const treeHead = (title, tabsArr, on) => `<div class="pane-h"><span class="title">${title}</span><span class="spacer"></span><button class="icon-btn" aria-label="New">+</button><button class="icon-btn" aria-label="Collapse">&laquo;</button></div>${tabs(tabsArr, on)}<div class="search">&#8981; Go to file, node or route <span class="spacer"></span><kbd>Ctrl P</kbd></div>`;
const pagesTree = (sel = 'LoginForm', extraPage = false) => `${treeHead('Pages', [['Tree'], ['Pages'], ['Flow']], 'Tree')}
  <div class="scroll"><div class="sect">${extraPage ? '/account/profile' : '/login'}</div><div class="tree">
   ${extraPage
     ? `${trow(0, 'page', 'ProfilePage', nb('git', 'new'), { tw: '&#9662;', sel: true })}${trow(1, 'component', 'AppNav')}${trow(1, 'component', 'Section', '', {})}`
     : `${trow(0, 'page', 'LoginPage', '', { tw: '&#9662;' })}
   ${trow(1, 'component', 'AppNav')}
   ${trow(1, 'component', 'LoginForm', sel === 'LoginForm' ? nb('imp', '3 feat') + nb('find', '2') + nb('test', '2') : dot('find', '2 findings'), { tw: '&#9662;', sel: sel === 'LoginForm' })}
   ${trow(2, 'component', 'EmailField', dot('git', 'edited'))}
   ${trow(2, 'component', 'PasswordField')}
   ${trow(2, 'component', 'SubmitButton')}
   ${trow(1, 'component', 'AuthFooter', dot('git', 'new'))}`}
  </div></div>`;
const loginDevice = ({ sel = true, pins = '', ghosts = '', h = 440, w = 640 }) => `
<div class="device" style="height:${h}px;width:${w}px">
  <div class="bar"><i></i><i></i><i></i>&nbsp;&nbsp;localhost:5173/login</div>
  <div class="app-nav"><b>Storefront</b><span>Catalog</span><span>Cart (2)</span><span>Sign in</span></div>
  <div class="login" id="lf"><h2>Welcome back</h2><p>Sign in to continue checkout.</p><label>Email</label><div class="in">sam@example.com</div><label>Password</label><div class="in">&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;</div><div class="cta">Sign in</div></div>
  ${sel ? `<div class="sel-box" style="left:calc(50% - 174px);top:98px;width:348px;height:322px"></div><div class="sel-tag" style="left:calc(50% - 174px);top:78px">LoginForm</div>` : ''}
  ${pins}${ghosts}
</div>`;
const profileDevice = `<div class="device" style="height:400px;width:640px"><div class="bar"><i></i><i></i><i></i>&nbsp;&nbsp;localhost:5173/account/profile</div><div class="app-nav"><b>Storefront</b><span>Catalog</span><span>Cart (2)</span></div><div style="padding:34px 40px;color:#667085"><h2 style="margin:0 0 6px;color:#1a1d24">Profile</h2><p>New page. Nothing here yet.</p></div><div class="sel-box" style="left:16px;top:112px;width:608px;height:150px"></div><div class="sel-tag" style="left:16px;top:92px">ProfilePage</div></div>`;
const devpill = `<span class="devpill"><span class="dot"></span>:5173 running</span>`;
const ovMenu = (n = 2) => `<button class="tg" aria-haspopup="true">Overlays &middot; ${n} on &#9662;</button>`;
const editorBar = (crumb, tabsHtml, right = '') => `${etabs(tabsHtml)}<div class="canvas-tb"><span class="crumbs">${crumb}</span>${devpill}<span class="spacer"></span>${right}<button class="tg" aria-pressed="true" title="Click an element without holding Alt">&#8853; Pick</button></div>`;
const foot = `<div class="canvas-foot"><span>Desktop 1280</span><span>Alt+Click opens source</span><span class="spacer"></span><span>Live: reloads when a file changes</span></div>`;

// The reusable inline action: GenerateChip. Mechanical is the default; AI is opt-in per action.
const gen = (o = {}) => {
  const ai = o.mode === 'ai'; const only = o.only; const dis = o.disabled;
  return `<span class="gen ${dis ? 'dis' : ''}" role="group" aria-label="${o.label || 'Generate'}">
   <span class="mode" role="radiogroup" aria-label="How">${only ? `<button role="radio" aria-checked="true" class="on ai" disabled>AI only</button>` : `<button role="radio" aria-checked="${!ai}" class="${!ai ? 'on det' : ''}" ${dis ? 'disabled' : ''}>Mechanical</button><button role="radio" aria-checked="${ai}" class="${ai ? 'on ai' : ''}" ${dis ? 'disabled' : ''}>AI</button>`}</span>
   <button class="go" ${dis ? 'disabled' : ''}>${o.running ? 'Cancel' : 'Generate'}</button></span>`;
};
const nextRow = (n, what, sub, chip, extra = '', flag = '') => `<div class="nx"><div class="nxh"><span class="no">${n}</span><div class="grow"><b>${what}</b><small>${sub}</small></div>${chip}</div>${flag ? `<div class="nxf">${flag}</div>` : ''}${extra}</div>`;

/* --- 1 Pages: preview first, quiet ------------------------------------------------- */
const inspectorQuiet = `
  <div class="section"><div class="el-head"><span class="name">LoginForm</span>${L('component')}<span class="spacer"></span><button class="icon-btn" aria-label="More">&#8943;</button></div><div class="path">features/auth/components/LoginForm.tsx:14</div></div>
  <details class="dt" open><summary>Props and bindings <span class="c">3</span></summary>
   <div class="prop"><span class="k">email</span><span class="field">email</span><span class="bind var">state</span></div>
   <div class="prop"><span class="k">onSubmit</span><span class="field">handleLogin</span><span class="bind var">handler</span></div>
   <div class="prop"><span class="k">disabled</span><span class="field">false</span><span class="bind lit">literal</span></div></details>
  <details class="dt"><summary>Impact <span class="c">3 features</span></summary></details>
  <details class="dt"><summary>Findings <span class="c warn">2</span></summary></details>
  <details class="dt"><summary>Tests <span class="c">2 pass</span></summary></details>
  <details class="dt"><summary>Notes <span class="c">1</span></summary></details>`;
const pagesMock = frame({ screen: 'Pages', lw: 300, rw: 360,
  left: pagesTree(),
  mid: editorBar('Pages &rsaquo; /login &rsaquo; <b>LoginForm</b>', [['Preview /login', true, true], ['LoginForm.tsx'], ['loginMachine.ts']], ovMenu(2)) +
    `<div class="stage" style="flex:1;padding:14px;place-items:start center">${loginDevice({ h: 500, pins: '<span class="pin find" style="left:calc(50% + 156px);top:88px" aria-label="2 findings">2</span>' })}<div class="ovcard" style="left:calc(50% - 174px);top:432px;flex-direction:row;align-items:center;width:348px"><b>LoginForm</b><span>Change touches 3 features</span><span style="display:flex;gap:6px"><button class="btn sm">Change...</button><button class="btn sm">Open source</button></span></div></div>` + foot,
  right: `<div class="pane-h"><span class="title">Inspect</span></div>${tabs([['Inspector'], ['Scope'], ['Source'], ['Change'], ['Diff']], 'Inspector')}<div class="scroll">${inspectorQuiet}</div>`,
  bot: bottom('Processes', runProcs(), 104, { p: '1', a: '0' }), botH: 104 });

/* --- 2 Pages: headline for Generate: a freshly created page ------------------------- */
const nextSteps = `
  <div class="section"><div class="el-head"><span class="name">ProfilePage</span>${L('page')}<span class="spacer"></span><button class="icon-btn" aria-label="More">&#8943;</button></div><div class="path">features/account/pages/ProfilePage.tsx (just created)</div></div>
  <div class="sect" style="padding-top:10px">Suggested next steps <span class="tag det" style="margin-left:6px">Mechanical by default</span></div>
  ${nextRow(1, 'Add the missing layer files', 'hook, service, domain stubs for account', gen({}), '<div class="nxl"><a>Preview diff</a> &middot; 3 files &middot; 0 model calls</div>')}
  ${nextRow(2, 'Fill their bodies', 'write real code into those stubs', gen({ mode: 'ai' }),
    `<div class="disc"><b>Before it runs</b> Sends 3 stub files and their layer rules (4.1 KB) to <b>qwen2.5-coder:7b</b> on this machine. <b>3 model calls</b>, one per file. Result arrives as a diff you approve file by file. <a>Change model</a></div>`)}
  ${nextRow(3, 'Auto-map props', 'wire 3 parent variables to child props', gen({}), '<div class="nxl"><a>Preview diff</a> &middot; 1 file</div>')}
  ${nextRow(4, 'Add test ids', 'data-testid from the flow events', gen({}), '', 'block exists; not offered as a command yet')}
  ${nextRow(5, 'Extract to component', 'select part of the page, name it', gen({ only: true }), '', 'no block yet: AI only (logged as a request for one)')}
  ${nextRow(6, 'Generate tests for this route', 'scenarios from the account flow', gen({}), '<div class="nxl"><a>Preview diff</a> &middot; 2 tests</div>')}`;
const nextMock = frame({ screen: 'Pages', lw: 250, rw: 480,
  left: pagesTree('', true),
  mid: editorBar('Pages &rsaquo; /account/profile &rsaquo; <b>ProfilePage</b>', [['Preview /account/profile', true, true], ['ProfilePage.tsx']], ovMenu(0)) +
    `<div class="stage" style="flex:1;padding:14px;place-items:start center">${profileDevice}</div>` + foot,
  right: `<div class="pane-h"><span class="title">Next</span></div>${tabs([['Next steps', ['6', 'acc']], ['Inspector'], ['Source'], ['Diff']], 'Next steps')}<div class="scroll">${nextSteps}</div>`,
  bot: bottom('Processes', runProcs(), 104, { p: '1', a: '0' }), botH: 104 });

/* --- 3 Pages: change a selection --------------------------------------------------- */
const changeMock = frame({ screen: 'Pages', lw: 300, rw: 400,
  left: pagesTree(),
  mid: editorBar('Pages &rsaquo; /login &rsaquo; <b>LoginForm</b>', [['Preview /login', true, true], ['LoginForm.tsx']], ovMenu(1)) +
    `<div class="stage" style="flex:1;padding:14px;place-items:start center">${loginDevice({ h: 500, ghosts: '<div class="ghost" style="left:12px;top:36px;width:616px;height:34px"></div><div class="ghost-tag" style="left:16px;top:38px;left:300px">will change: AppNav import</div>' })}<div class="ovcard" style="left:calc(50% - 174px);top:432px;width:348px;border-color:var(--warn)"><b>Preview of the change</b><span>Dashed boxes will change. Nothing is written until you approve.</span></div></div>` + foot,
  right: `<div class="pane-h"><span class="title">Change</span></div>${tabs([['Inspector'], ['Scope'], ['Source'], ['Change', ['4', 'acc']], ['Diff']], 'Change')}<div class="scroll">
   <div class="verbs">${['Move', 'Rename', 'Extract', 'Wrap in...', 'Delete'].map((v, i) => `<button class="tg" aria-pressed="${i === 0}">${v}</button>`).join('')}</div>
   <div class="ask"><b>Move</b> LoginForm to <span class="field" style="display:inline-flex;width:160px">features/account</span></div>
   ${nextRow(1, 'Move the file, rewrite 3 imports', 'construct refactor move', gen({}))}
   ${nextRow(2, 'Update the folder description', 'a sentence for the new folder', gen({ mode: 'ai' }))}
   <div class="sect" style="padding-top:10px">Approve per file &middot; 4 of 5</div>
   ${[['LoginForm.tsx', 'moved', 1], ['LoginPage.tsx', '+1 -1', 1], ['CheckoutPage.tsx', '+1 -1', 1], ['LoginForm.test.ts', '+1 -1', 1], ['README.md (AI)', '+3', 0]].map((a) => `<div class="art"><span class="cb ${a[2] ? 'on' : ''}">${a[2] ? '&#10003;' : ''}</span><span>${a[0]}</span><span style="color:var(--text-muted)">${a[1]}</span></div>`).join('')}
   <div style="padding:10px 12px"><button class="btn primary">Approve 4 of 5</button> <button class="btn">Discard</button></div></div>`,
  bot: bottom('Approvals', `<table><tr><th>Waiting for you</th><th>From</th><th></th></tr><tr><td><b>Move LoginForm to features/account</b> &middot; 5 files, 4 selected</td><td><span class="tag det">Mechanical</span> <span class="tag llm">Local model</span></td><td><button class="btn sm primary">Review diff</button></td></tr></table>`, 110, { p: '1', a: '1' }), botH: 110 });

/* --- 4 Components ------------------------------------------------------------------ */
const compMock = frame({ screen: 'Components', lw: 300, rw: 410,
  left: `${treeHead('Components', [['Components'], ['Workflows']], 'Components')}<div class="scroll"><div class="sect">auth</div><div class="tree">
   ${trow(1, 'component', 'LoginForm', nb('imp', '3 feat') + nb('find', '2') + nb('test', '2'), { sel: true })}${trow(1, 'component', 'PasswordField')}${trow(1, 'component', 'AuthFooter', dot('git', 'new'))}${trow(1, 'workflow', 'loginMachine')}</div><div class="sect">ui-kit</div><div class="tree">${trow(1, 'component', 'AmountField')}${trow(1, 'component', 'SubmitButton')}${trow(1, 'component', 'Modal')}</div></div>`,
  mid: editorBar('Components &rsaquo; auth &rsaquo; <b>LoginForm</b>', [['Preview LoginForm', true, true], ['LoginForm.tsx']], ovMenu(1)) +
    `<div class="canvas-tb" style="height:32px"><span style="color:var(--text-faint);font-size:11px">State</span><span class="seg" role="radiogroup" aria-label="State"><button class="on" role="radio" aria-checked="true">idle</button><button role="radio" aria-checked="false">submitting</button><button role="radio" aria-checked="false">error</button></span><span class="tag det">from loginMachine</span><span class="spacer"></span><button class="tg" aria-pressed="false">Mobile 390</button></div>
   <div class="stage" style="flex:1;place-items:start center;padding:16px"><div class="device" style="height:320px;width:480px"><div class="bar"><i></i><i></i><i></i>&nbsp;&nbsp;LoginForm, on its own</div><div class="login" style="margin:14px auto"><h2>Welcome back</h2><label>Email</label><div class="in">sam@example.com</div><label>Password</label><div class="in">&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;</div><div class="cta">Sign in</div></div></div>
   <div class="mach"><div class="mh">Flow &middot; loginMachine</div><div><span class="st2 cur">idle</span><span class="arr">SUBMIT &rarr;</span><span class="st2">submitting</span><span class="arr">FAIL &rarr;</span><span class="st2">error</span></div></div></div>` + `<div class="canvas-foot"><span>Same live app, this component only</span><span class="spacer"></span><span>Live</span></div>`,
  right: `<div class="pane-h"><span class="title">Inspect</span></div>${tabs([['Inspector'], ['Used by', ['2', '']], ['Source'], ['Change'], ['Diff']], 'Inspector')}<div class="scroll">
   <div class="section"><div class="el-head"><span class="name">LoginForm</span>${L('component')}<span class="spacer"></span><button class="icon-btn" aria-label="More">&#8943;</button></div><div class="path">features/auth/components/LoginForm.tsx:14</div></div>
   <details class="dt" open><summary>Props <span class="c">3</span></summary><div class="prop"><span class="k">email</span><span class="field">string</span><span class="bind lit">required</span></div><div class="prop"><span class="k">onSubmit</span><span class="field">() =&gt; void</span><span class="bind lit">required</span></div><div class="prop"><span class="k">disabled</span><span class="field">boolean</span><span class="bind lit">= false</span></div><div style="margin-top:6px"><button class="btn sm">+ Add prop</button></div></details>
   <details class="dt"><summary>Used by <span class="c">2 pages</span></summary></details><details class="dt"><summary>Tests <span class="c">2 pass</span></summary></details><details class="dt"><summary>Findings <span class="c warn">2</span></summary></details></div>`,
  bot: bottom('Processes', runProcs(), 110, { p: '1', a: '0' }), botH: 110 });

/* --- 5 Generate states ------------------------------------------------------------- */
const sc = (h, p, body) => `<div class="card"><b>${h}</b><p>${p}</p>${body}</div>`;
const genStates = `
<div class="hh">The inline Generate control: one contract, every place a step can be produced<small>Mechanical (a deterministic block, zero model calls) is the default and says so. AI is opt-in per action, and output only ever lands as a reviewable diff.</small></div>
<div class="sheet3">
 <div><h3>States</h3>
  ${sc('Idle, mechanical (default)', 'Add the missing layer files', `<div>${gen({})}</div><span class="tag det">Deterministic &middot; 0 model calls</span>`)}
  ${sc('AI chosen: says what it will send', 'Fill their bodies', `<div>${gen({ mode: 'ai' })}</div><div class="disc"><b>Before it runs</b> Sends 3 files (4.1 KB) to qwen2.5-coder:7b, on this machine. 3 model calls. Result is a diff you approve.</div>`)}
  ${sc('Running, with cancel', 'Fill their bodies', `<div>${gen({ mode: 'ai', running: true })}</div><span class="saveind busy"><span class="spin"></span> File 2 of 3 &middot; Process #15</span>`)}</div>
 <div><h3>Results and refusals</h3>
  ${sc('Result', 'A diff, never a silent write', `<div><span class="tag llm">Local model</span> 3 files ready</div><div><button class="btn sm primary">Review diff</button> <button class="btn sm">Discard</button></div><p>Lands in Approvals, approved per file.</p>`)}
  ${sc('Refused: model offline', 'AI is off, nothing ran', `<div>${gen({ mode: 'ai' })}</div><div class="callout warn" style="margin:0"><span>&#9888;</span><div class="grow"><b>Local model is offline</b><small>Nothing was sent.</small></div></div><div><button class="btn sm">Use Mechanical instead</button> <button class="btn sm">Open Local model</button></div>`)}
  ${sc('Disabled, with the reason', 'Extract to component', `<div>${gen({ disabled: true })}</div><span class="saveind">Select part of the page first</span>`)}</div>
 <div><h3>Rules of the contract</h3>
  ${sc('No block yet', 'Where no deterministic block exists', `<div>${gen({ only: true })}</div><span class="saveind">Flagged "no block yet": counted as a request for a mechanical block, never a silent model fallback.</span>`)}
  <div class="card"><b>Remembered</b><p>The Mechanical / AI choice is stored per user and per action kind (for example "fill a layer"), in the browser's local settings. It defaults to Mechanical when there is no choice, and to Mechanical again if the model is offline.</p></div>
  <div class="card"><b>Slot contract</b><p>Props in: action id, label, mechanical block (or none), AI allowed, what would be sent, target. Events out: run, cancel, choose-mode. Result is an artifact handed to Approvals; the chip never writes files.</p></div></div>
</div>`;

/* --- 6 Live preview states --------------------------------------------------------- */
const pst = (h, p, extra = '', c = '') => `<div class="card" ${c}><b>${h}</b><p>${p}</p>${extra}</div>`;
const previewStates = `
<div class="hh">The live preview needs the target app's dev server<small>Tree, impact, findings, Notes, plan, source and diff work from the files alone. Only the rendered canvas, click-to-source and live reload need the server.</small></div>
<div class="sheet3">
 <div><h3>Before it runs</h3>
  ${pst('Dev server not running', 'Start it to see /login. It runs inside your workspace, for this project only.', '<div><button class="btn primary sm">Start dev server</button> <button class="btn sm">Use a URL instead</button></div>')}
  ${pst('Starting', '<span class="saveind busy"><span class="spin"></span> npm run dev, Process #14</span> Watch it in the bottom panel. Usually 3 to 5 s.', '<div><button class="btn sm">Open in Processes</button></div>')}
  ${pst('Outside the workspace', 'This project is not inside the workspace root, so the Cockpit will not start a server for it.', '<div><button class="btn sm">Open a project in the workspace</button></div>', 'style="border-color:var(--danger)"')}</div>
 <div><h3>When it goes wrong</h3>
  ${pst('Server stopped', 'Port 5173 is in use by another process.', '<div><button class="btn primary sm">Use port 5174</button> <button class="btn sm">Show log</button></div>', 'style="border-color:var(--danger)"')}
  ${pst('Click-to-source is off', 'Your app does not load the Cockpit preview plugin. Tree, impact and source still work.', '<div><span class="mono" style="background:var(--surface-3);padding:2px 6px;border-radius:4px">plugins: [constructPreview(), react()]</span></div><div><button class="btn sm">Copy line</button></div>', 'style="border-color:var(--warn)"')}
  ${pst('App error in the preview', 'The app threw: Cannot read properties of undefined (reading email).', '<div><button class="btn sm">Show in source</button></div>', 'style="border-color:var(--danger)"')}</div>
 <div><h3>Running, and what needs it</h3>
  ${pst('Running', '<span class="saveind ok">&#10003; :5173 running &middot; live reload on</span>', '<div><button class="btn sm">Restart</button> <button class="btn sm danger">Stop</button></div>')}
  ${pst('Needs the server', 'Rendered canvas, Alt+Click and Pick, live reload, isolated component view, state switching.', '')}
  ${pst('Works without it', 'File tree, impact, findings, Notes, plan, diff, tests list, Generate.', '')}</div>
</div>`;

/* --- 7 Side preview on Tests ------------------------------------------------------- */
const sideMock = frame({ screen: 'Tests', lw: 300, rw: 340,
  left: `<div class="pane-h"><span class="title">Tests</span></div>${tabs([['Tests', ['6', 'acc']], ['Coverage']], 'Tests')}<div class="scroll"><div class="tree" style="padding-top:8px"><div class="row sel">${L('page')}login happy path<span class="meta">passed</span></div><div class="row">${L('page')}wrong password<span class="meta">passed</span></div><div class="row">${L('page')}guest checkout<span class="meta">failed</span></div></div></div>`,
  mid: `<div class="etabs"><button class="on" aria-selected="true">login happy path</button></div><div class="canvas-tb"><span class="crumbs">Tests &rsaquo; <b>login happy path</b></span><span class="spacer"></span><button class="tg" aria-pressed="true">Preview beside</button></div><div class="half"><div style="padding:14px;border-right:1px solid var(--border-subtle)"><div class="sect" style="padding-left:0">Step 2 of 4</div><div class="card"><b>Type the email</b><p>Fill "Email" with sam@example.com</p></div><div class="card"><b>Type the password</b><p>Fill "Password"</p></div></div><div class="stage" style="padding:12px;place-items:start center;background:var(--canvas)">${loginDevice({ h: 360, w: 350, sel: false })}</div></div>`,
  right: `<div class="pane-h"><span class="title">Inspect</span></div>${tabs([['Edit step'], ['Record'], ['Freshness']], 'Edit step')}<div class="scroll" style="padding:14px;color:var(--text-muted)">The preview beside the steps is the same live app. Pick an element there to fill a step's target.</div>`,
  bot: bottom('Processes', runProcs(), 110, { p: '1', a: '0' }), botH: 110 });

const pocOut = { 'ia-pages': pagesMock, 'ia-pages-next': nextMock, 'ia-pages-change': changeMock, 'ia-components': compMock, 'ia-generate-states': genStates, 'ia-preview-states': previewStates, 'ia-side-preview': sideMock };
const pocTitles = { 'ia-pages': 'Pages: live preview first, quiet until you select', 'ia-pages-next': 'Pages: a new page selected, with suggested next steps and the inline Generate control', 'ia-pages-change': 'Pages: change a selection with impact preview and per-file approval', 'ia-components': 'Components: one component on its own, with flow states', 'ia-generate-states': 'Inline Generate: Mechanical | AI, states and rules', 'ia-preview-states': 'Live preview: needs the dev server (states)', 'ia-side-preview': 'Tests: the live preview as a side view' };

/* ================================================= Story: feature-level story.md (link or paste) */
const acRow = (id, text, st) => `<div class="ac"><span class="acid">${id}</span><span class="grow">${text}</span>${st}</div>`;
const storyLeft = `${treeHead('Features', [['Notes', ['3', '']], ['Features']], 'Features')}
  <div class="scroll"><div class="tree" style="padding-top:8px">
   <div class="row"><span class="twisty">&#9656;</span>auth</div><div class="row"><span class="twisty">&#9656;</span>cart</div><div class="row"><span class="twisty">&#9656;</span>checkout</div>
   <div class="row"><span class="twisty">&#9662;</span>orders<span class="nbs">${nb('imp', 'story')}</span></div>
   <div class="row l1"><span class="twisty">&#9656;</span>pages &middot; components &middot; workflows</div>
   <div class="row l1 sel">&#9776; story.md<span class="nbs">${dot('find', '2 to review')}</span></div>
   <div class="row l1">&#9776; architecture notes</div></div></div>`;
const storyMid = editorBar('Features &rsaquo; orders &rsaquo; <b>story.md</b>', [['Story: orders', true, true], ['refundMachine.ts']], '') .replace(devpill, '').replace(/<button class="tg" aria-pressed="true" title="Click an element[^]*?<\/button>/, '') + `
  <div style="overflow:hidden;flex:1;padding:14px 18px;display:flex;flex-direction:column;gap:10px">
   <div class="srcbar"><span class="lab">Linked ticket</span><span class="field" style="flex:1">https://github.com/acme/storefront/issues/142</span><button class="btn sm">Refresh</button></div>
   <div class="saveind"><span class="saveind ok">&#10003; Snapshot fetched 2026-09-20 12:02</span> &middot; public page &middot; 1 redirect &middot; 38 KB &middot; <a>Paste text instead</a></div>
   <div class="notebox" style="margin:0"><div class="t">Refund a delivered order <span class="spacer"></span><span class="st draft">Snapshot</span></div>
    <div class="b">As a customer I want to request a refund from the order page so that I do not need to contact support. Refunds are allowed within 30 days of delivery.</div>
    <div style="border-top:1px solid var(--border-subtle);padding:6px 0">
     ${acRow('S1', 'Refund button shows only on delivered orders', '<span class="nb test">matched</span>')}
     ${acRow('S2', 'Refund allowed within 30 days of delivery', '<span class="nb test">matched</span>')}
     ${acRow('S3', 'Partial refunds are allowed', '<span class="nb find">missing</span>')}
     ${acRow('S4', 'Customer confirms before the refund is sent', '<span class="nb test">matched</span>')}
     ${acRow('S5', 'An audit entry is written', '<span class="nb find">missing</span>')}</div>
    <div class="f"><span class="saveind">Stored in <span class="mono">features/orders/story.md</span></span><span class="spacer"></span><label class="saveind"><span class="cb on" style="width:14px;height:14px;border:2px solid var(--accent);background:var(--accent);border-radius:3px;display:inline-block"></span> Keep out of git</label></div></div>
  </div>`;
const cmpList = (h, tag, items, extra = '') => `<details class="dt" open><summary>${h} <span class="c ${tag}">${items.length}</span></summary>${items.join('')}${extra}</details>`;
const cmpItem = (t, sub, chip = '') => `<div class="nx" style="padding:6px 0;border:0"><div class="nxh"><div class="grow"><b>${t}</b><small>${sub}</small></div>${chip}</div></div>`;
const storyRight = `<div class="pane-h"><span class="title">Compare</span><span class="spacer"></span><span class="tag det">Mechanical compare</span></div>${tabs([['Compare', ['2', '']], ['Sources'], ['History']], 'Compare')}<div class="scroll">
  <div class="callout warn" style="margin:10px 12px 0"><span>&#9888;</span><div class="grow"><b>Summary may be out of date</b><small>The generated summary changed since you last reviewed.</small></div><button class="btn sm">Mark reviewed</button></div>
  ${cmpList('Missing from the code', 'warn', [cmpItem('S3 Partial refunds are allowed', 'no scenario, route or test mentions it', gen({ label: 'Add scenario' })), cmpItem('S5 An audit entry is written', 'no test carries @story S5', gen({ label: 'Generate test' }))])}
  ${cmpList('In the code, not in the story', '', [cmpItem('state manualReview', 'refundMachine has it; no acceptance line does', '<button class="btn sm">Add to story</button>')])}
  ${cmpList('Matched', '', [cmpItem('S1, S2, S4', '3 lines matched to scenarios and tests (@story S1, S2, S4)', '')])}
  <div style="padding:10px 12px;color:var(--text-muted);font-size:12px">Compare is deterministic: ids and keywords against scenarios, routes, states and tests. Switch a row to AI for a fuzzier match; citations are checked mechanically before they are shown.</div></div>`;
const storyMock = frame({ screen: 'Features', lw: 280, rw: 400, left: storyLeft, mid: storyMid, right: storyRight, bot: bottom('Processes', runProcs(), 104, { p: '1', a: '0' }), botH: 104 });

const storyStates = `
<div class="hh">Story: link or paste, snapshot kept, never a login you did not give<small>The Cockpit fetches a public page's HTML and reads it; there is no Jira or GitHub API connection. Pages that need a login cannot be fetched, so paste the text instead.</small></div>
<div class="sheet3">
 <div><h3>Getting the ticket</h3>
  ${pst('Link a ticket', 'Paste a GitHub issue URL. It is fetched once, read, and saved as a snapshot you can review offline.', '<div><span class="field" style="display:inline-flex;width:100%">https://github.com/acme/storefront/issues/142</span></div><div><button class="btn primary sm">Fetch</button> <button class="btn sm">Paste text instead</button></div>')}
  ${pst('Fetching', '<span class="saveind busy"><span class="spin"></span> Fetching github.com, no login sent</span>', '<div><button class="btn sm">Cancel</button></div>')}
  ${pst('This page needs a login', 'Jira Cloud and private GitHub issues cannot be read without credentials or an API, and this version has neither. The link is saved as a reference.', '<div><button class="btn primary sm">Paste the text instead</button></div>', 'style="border-color:var(--warn)"')}</div>
 <div><h3>Refused, and why</h3>
  ${pst('Host not allowed', 'Only https pages on github.com are fetched. Add an Atlassian host in Settings if your team uses one.', '<div><button class="btn sm">Open Settings</button></div>', 'style="border-color:var(--danger)"')}
  ${pst('Blocked for safety', 'That address points at a private or local network. The Cockpit never fetches those.', '', 'style="border-color:var(--danger)"')}
  ${pst('Too big or too slow', 'The page is larger than 1 MB or took longer than 10 s. Nothing was saved.', '<div><button class="btn sm">Paste text instead</button></div>', 'style="border-color:var(--danger)"')}</div>
 <div><h3>Keeping it current and private</h3>
  ${pst('Refresh: ticket vs snapshot', 'The ticket changed since 12:02.', '<div class="code" style="border:1px solid var(--border-subtle);border-radius:var(--r-sm)"><div class="ln"><i>4</i><span>Refunds allowed within 30 days</span></div><div class="ln del"><i>5</i><span>- Partial refunds are not allowed</span></div><div class="ln add"><i>5</i><span>+ Partial refunds are allowed</span></div></div><div><button class="btn primary sm">Accept changes</button> <button class="btn sm">Keep my snapshot</button></div>')}
  ${pst('Private ticket, public repo', 'This ticket looks private and the repository is public. Committing the snapshot would publish it.', '<div><button class="btn primary sm">Keep out of git</button> <button class="btn sm">Commit anyway</button></div>', 'style="border-color:var(--warn)"')}
  ${pst('Kept out of git', 'Stored in your per-user state folder (with Notes), not in the project. It is not shared with teammates.', '')}</div>
</div>`;
Object.assign(pocOut, { 'ia-story': storyMock, 'ia-story-states': storyStates });
Object.assign(pocTitles, { 'ia-story': 'Features: a feature story linked to a ticket, compared with the code', 'ia-story-states': 'Story: fetch states, refusals, refresh and privacy' });

/* ================================================= Clipper: click-to-parse userscript for tickets behind a login */
const ol = (label, style, cls = '') => `<div class="olx ${cls}" style="${style}"><span class="oll">${label}</span></div>`;
const jiraPage = `
<div class="jp">
  <div class="jbar"><i></i><i></i><i></i>&nbsp;&nbsp;acme.atlassian.net/browse/STORE-142 <span style="margin-left:auto;color:#667085">(a page you are logged in to)</span></div>
  <div class="jnav"><b>Jira</b><span>Your work</span><span>Projects</span><span>Boards</span></div>
  <div class="jbody">
   <div class="jcrumb">Projects / Storefront / <span style="position:relative">STORE-142</span></div>
   <h2>Refund a delivered order</h2>
   <div class="jmeta"><span class="jstat">In Progress</span> <span>Assignee: Sam</span></div>
   <h4>Description</h4>
   <p>As a customer I want to request a refund from the order page so that I do not need to contact support.</p>
   <h4>Acceptance criteria</h4>
   <ul><li>Refund button shows only on delivered orders</li><li>Refund allowed within 30 days of delivery</li><li>Partial refunds are allowed</li><li>Customer confirms before the refund is sent</li><li>An audit entry is written</li></ul>
   <div class="jside">Details<br>Priority: High<br>Sprint: 14</div>
   ${ol('Key', 'left:154px;top:14px;width:80px;height:22px', 'done')}
   ${ol('Title', 'left:26px;top:42px;width:330px;height:34px', 'done')}
   ${ol('Status', 'left:26px;top:80px;width:98px;height:26px', 'done')}
   ${ol('Description', 'left:26px;top:150px;width:604px;height:48px', 'done')}
   ${ol('Acceptance criteria: click the list', 'left:26px;top:238px;width:420px;height:118px', 'cur')}
  </div>
</div>`;
const clipPanel = `
<div class="clp"><div class="clh"><b>Construct Clipper</b> <span class="tag det">Deterministic</span><span class="spacer"></span><span style="color:var(--text-muted);font-size:12px">userscript</span></div>
  <div class="clb">
   <div class="sect" style="padding:0 0 6px">Pick a field, then click it on the page</div>
   <div class="clf"><button class="tg" aria-pressed="false">&#10003; Key</button><button class="tg" aria-pressed="false">&#10003; Title</button><button class="tg" aria-pressed="false">&#10003; Status</button><button class="tg" aria-pressed="false">&#10003; Description</button><button class="tg" aria-pressed="true">Acceptance criteria</button></div>
   <div class="card" style="margin:10px 0 0"><b>Preview (plain text)</b>
     <div class="kv"><span>Key</span><span>STORE-142</span><span>Title</span><span>Refund a delivered order</span><span>Status</span><span>In Progress</span><span>Acceptance</span><span>5 lines found</span></div></div>
   <div class="card" style="margin:10px 0 0"><b>Template</b><span class="mono">acme.atlassian.net &nbsp;/browse/*</span><p>Saves selectors only (data, never code). The next ticket on this site is read automatically.</p><div><button class="btn primary sm">Save template</button> <button class="btn sm">Copy clip</button></div></div>
   <div class="sect" style="padding:12px 0 4px">Saved templates &middot; 3</div>
   <div class="tpl"><span>acme.atlassian.net /browse/*</span><span class="nb test">matches this page</span></div>
   <div class="tpl"><span>github.com /acme/*/issues/*</span></div>
   <div class="tpl"><span>tracker.example.org /t/*</span><span class="nb find">did not match: re-pick</span></div>
   <div style="padding-top:8px"><button class="btn sm">Export JSON</button> <button class="btn sm">Import JSON</button></div>
  </div></div>`;
const clipperMock = `<div class="clipwrap">${jiraPage}${clipPanel}</div>`;

const clipPaste = `
<div class="hh">Paste clip: the safe way to bring in a ticket from behind a login<small>You are logged in in your own browser. The clipper reads the page there and copies plain data. Nothing is sent to the Cockpit, and no cookie or password ever leaves your browser.</small></div>
<div class="sheet3">
 <div><h3>In the Story tab</h3>
  ${pst('Paste clip', 'Paste what the clipper copied.', '<div class="code" style="border:1px solid var(--border-subtle);border-radius:var(--r-sm);padding:6px 8px;white-space:pre-wrap">{ "key": "STORE-142", "title": "Refund a delivered order", "acceptance": ["Refund button...", "..."], "url": "https://acme.atlassian.net/browse/STORE-142" }</div><div><button class="btn primary sm">Use this clip</button> <button class="btn sm">Cancel</button></div>')}
  ${pst('Shown as plain text', 'Key, title, status, description and 5 acceptance lines (S1 to S5). Text is escaped, never rendered as HTML, and no link in it is opened or fetched.', '<div><span class="tag det">Deterministic</span> 2.1 KB</div>')}</div>
 <div><h3>When it does not work</h3>
  ${pst('Template did not match', 'The site changed its layout, so the saved selectors found nothing for Acceptance criteria.', '<div><button class="btn primary sm">Re-pick this field</button> <button class="btn sm">Paste text instead</button></div>', 'style="border-color:var(--warn)"')}
  ${pst('Clip is too large', 'Clips over 64 KB are refused. Nothing was saved.', '', 'style="border-color:var(--danger)"')}
  ${pst('Not a clip', 'That text is not clipper data. It was not saved.', '<div><button class="btn sm">Paste as plain story text</button></div>', 'style="border-color:var(--danger)"')}</div>
 <div><h3>Later: one-time delivery (v1.5)</h3>
  ${pst('Send to Cockpit', 'Instead of copy and paste, the userscript can send the clip to one endpoint.', '<div><span class="mono">Clip token: 4F7K-9Q2M &middot; valid 5 min &middot; one use</span></div><div><button class="btn sm">Create clip token</button></div>')}
  ${pst('What the token can do', 'Only POST one clip to <span class="mono">/api/story/clip</span> for this feature. It cannot read anything, and dies on first use or after 5 minutes.', '')}</div>
</div>`;
Object.assign(pocOut, { 'ia-clipper': clipperMock, 'ia-clip-paste': clipPaste });
Object.assign(pocTitles, { 'ia-clipper': 'Clipper: click to pick ticket fields on a page you are logged in to', 'ia-clip-paste': 'Clipper: paste clip, failure states, one-time token' });

const out = { 'ia-features': features, 'ia-account-menu': menuMock, 'ia-slot-matrix': matrix, 'ia-notes-states': drafts, 'ia-no-project': noProj, 'ia-git': git, 'ia-git-connect': gitConnect, 'ia-narrow': narrow };
const titles = { 'ia-features': 'Features screen: notes, impact, plan, processes', 'ia-account-menu': 'Account menu: settings, local model, theme, help, sign out', 'ia-slot-matrix': 'Five screens, four slots', 'ia-notes-states': 'Notes: durable states', 'ia-no-project': 'No project: where the Open a project prompt sits', 'ia-git': 'Git screen: PRs and review inside the shell', 'ia-git-connect': 'Git with no remote: where Connect remote and Clone sit', 'ia-narrow': 'Narrow (390 px): one panel at a time' };
Object.assign(out, pocOut); Object.assign(titles, pocTitles);
for (const [k, v] of Object.entries(out)) writeFileSync(join(here, `${k}.html`), page(titles[k], v));
console.log('ia mocks written');
