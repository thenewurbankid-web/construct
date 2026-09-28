// Concept mocks for the Rules and Envelopes composers (#395), placed as two new tabs on the
// Features screen (see docs/design/rules-envelopes.md). Usage:
//   node docs/design/mocks/build-rules.mjs && node docs/design/mocks/render.mjs ia-rules
//   node docs/design/mocks/render.mjs ia-envelopes
// Reuses the five-screen shell chrome and ia.css classes (.tree/.row/.layer/.card/.dt/.art/.st/.fm/
// .step/.nx) rather than inventing a new visual language. Content is real repo vocabulary: rule ids
// and messages from packages/core/config.mjs DEFAULT_RULES / architecture-enforcer.mjs, envelope
// shape from schemas/envelope.v1.json.
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
const topbar = ({ screen = 'Features', procs = '1 running' } = {}) => `
<header class="topbar" role="banner">
  <div class="brand"><i></i>Cockpit</div>
  <button class="chip-btn" aria-haspopup="listbox">storefront <span class="sub">main</span> &#9662;</button>
  <nav class="snav" aria-label="Screens">${SCREENS.map((s) => `<a class="${s === screen ? 'on' : ''}" ${s === screen ? 'aria-current="page"' : ''}>${s}</a>`).join('')}</nav>
  <button class="chip-btn palette-trigger"><span>Search or run a command...</span><kbd>Ctrl K</kbd></button>
  <span class="pill run"><span class="spin"></span>${procs}</span>
  <button class="acct" aria-haspopup="true" aria-expanded="false"><span class="avatar">SP</span>shashank-p &#9662;</button>
</header>`;

const statusbar = (right = '0 new violations') => `<footer class="statusbar"><span class="ok">&#9679; validate: ${right}</span><span>Rules saved on this machine</span><span class="spacer"></span><span>qwen2.5-coder:7b</span><span><kbd>F6</kbd> next panel</span><span><kbd>Ctrl J</kbd> bottom panel</span></footer>`;

const bottom = (on = 'Diagnostics', body, h = 130) => `
<div class="drawer" aria-label="Bottom panel: Run" style="height:${h}px">
  ${tabs([['Processes', ['1', 'acc']], ['Approvals', ['1', '']], ['Diagnostics', ['17', 'danger']], ['Logs', null]], on)}
  <div class="body">${body}</div>
</div>`;

const frame = ({ screen = 'Features', left, mid, right, bot, lw, rw, botH = 130 }) => `
<div class="shell" style="${lw ? `--lw:${lw}px;` : ''}${rw ? `--rw:${rw}px;` : ''}grid-template-rows:44px 1fr ${botH}px 24px;position:relative">
  ${topbar({ screen })}
  <div class="ia-main">
    <aside class="pane" aria-label="Left panel: Browse">${left}</aside><div class="resizer" role="separator" aria-orientation="vertical" tabindex="0"></div>
    <section class="pane mid" aria-label="Center stage">${mid}</section><div class="resizer" role="separator" aria-orientation="vertical" tabindex="0"></div>
    <aside class="pane" aria-label="Right panel: Inspect">${right}</aside>
  </div>
  ${bot}
  ${statusbar()}
</div>`;

const L = (k) => `<span class="layer ${k}">${k}</span>`;
const sev = (s) => `<span class="st ${s === 'error' ? 'stale' : s === 'warning' ? 'draft' : 'ready'}" style="${s === 'error' ? 'background:var(--danger-soft);color:var(--danger)' : ''}">${s}</span>`;
const violBadge = (n) => n === 0
  ? `<span class="st ready" style="background:var(--success-soft);color:var(--success)">0</span>`
  : `<span class="st stale" style="background:var(--danger-soft);color:var(--danger)">${n}</span>`;

const RULES = [
  { id: 'ROUTE-001', name: 'Routes delegate to controllers', layer: 'route', severity: 'error', violations: 0,
    why: 'A route entry (app/<route>/page.tsx) may only import a controller and render it — nothing else. Keeps request handling out of the route file so the same page logic works if the framework or route path ever changes.' },
  { id: 'PAGE-004', name: 'Pages cannot call fetch', layer: 'page', severity: 'error', violations: 14,
    why: 'A page component may not call fetch() directly. Keeps data-fetching out of pages so a page stays swappable without touching how data is loaded — call a service through a controller instead.' },
  { id: 'COMPONENT-002', name: 'Components cannot import controllers', layer: 'component', severity: 'error', violations: 0,
    why: 'A presentation component may not import a controller. Keeps components reusable outside any one page or flow — a component that reaches for a controller has become a page in disguise.' },
  { id: 'SERVICE-002', name: 'Services own network calls', layer: 'service', severity: 'warning', violations: 2,
    why: 'Only a service may call fetch() or an SDK client. Keeps every network boundary in one place per feature, so mocking a service in a test is enough to isolate the rest of the feature.' },
  { id: 'DOMAIN-001', name: 'Domain is pure', layer: 'domain', severity: 'error', violations: 0,
    why: 'Domain functions take plain data in and return plain data out — no fetch, no DOM, no framework import. Keeps business rules testable without a browser or a server.' },
  { id: 'EXCEPTION-EXPIRED', name: 'Exception past its expiry', layer: 'readability', severity: 'warning', violations: 1,
    why: 'An exceptions[] entry with an expires date in the past no longer suppresses its rule, and is itself flagged so a stale exemption is never silently permanent.' },
];

const ruleRow = (r, sel) => `<div class="row ${sel === r.id ? 'sel' : ''}" title="${r.name}">${L(r.layer)}<b style="flex:none">${r.id}</b><span class="nbs">${sev(r.severity)}${violBadge(r.violations)}</span></div>`;

const rulesLeft = (sel) => `
<div class="pane-h"><span class="title">Rules</span><span class="spacer"></span><button class="icon-btn" aria-label="Collapse">&laquo;</button></div>
${tabs([['Notes'], ['Features'], ['Rules'], ['Envelopes']], 'Rules')}
<div class="search">&#8981; Filter by id or name <span class="spacer"></span><kbd>/</kbd></div>
<div style="padding:8px 12px;border-bottom:1px solid var(--border-subtle);font-size:12px;color:var(--text-muted)">Preset: <b style="color:var(--text)">strict-nextjs</b> &middot; <a>Change preset</a></div>
<div style="padding:6px 12px;border-bottom:1px solid var(--border-subtle)"><label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-muted)"><input type="checkbox" checked style="width:14px;height:14px"> Errors and warnings only</label></div>
<div class="scroll">
  <div class="sect">Route</div><div class="tree">${ruleRow(RULES[0], sel)}</div>
  <div class="sect">Page</div><div class="tree">${ruleRow(RULES[1], sel)}</div>
  <div class="sect">Component</div><div class="tree">${ruleRow(RULES[2], sel)}</div>
  <div class="sect">Service</div><div class="tree">${ruleRow(RULES[3], sel)}</div>
  <div class="sect">Domain</div><div class="tree">${ruleRow(RULES[4], sel)}</div>
  <div class="sect">Readability</div><div class="tree">${ruleRow(RULES[5], sel)}</div>
</div>`;

const violationRow = (path, line, msg) => `<div class="art" style="grid-template-columns:1fr auto"><span>${path}<small style="display:block;color:var(--text-faint)">line ${line} &middot; ${msg}</small></span><a>Open in Source</a></div>`;

const ruleDetail = (r) => `
<div class="hh" style="padding:16px 20px 0">${r.id} <small>${r.name}</small></div>
<div style="padding:14px 20px 0"><div class="card"><b>Why this rule exists</b><p>${r.why}</p></div></div>
<div style="padding:0 20px"><div class="card">
  <b>Severity</b>
  <div class="seg" role="radiogroup" aria-label="Severity for ${r.id}">
    <button role="radio" aria-checked="${r.severity === 'error'}" class="${r.severity === 'error' ? 'on' : ''}">Error</button>
    <button role="radio" aria-checked="${r.severity === 'warning'}" class="${r.severity === 'warning' ? 'on' : ''}">Warning</button>
    <button role="radio" aria-checked="${r.severity === 'off'}" class="${r.severity === 'off' ? 'on' : ''}">Off</button>
  </div>
</div></div>
<div style="padding:0 20px 8px">
  <details class="dt" open><summary>Violates today <span class="c ${r.violations ? 'warn' : ''}">${r.violations}</span></summary>
  ${r.violations
    ? [violationRow('features/catalog/pages/ProductPage.tsx', 22, 'Page calls fetch().'), violationRow('features/cart/pages/CartPage.tsx', 9, 'Page calls fetch().')].join('')
    : `<p style="color:var(--text-muted);padding:6px 0">No files currently violate ${r.id}.</p>`}
  <a style="display:inline-block;margin-top:6px">View all in Diagnostics &rarr;</a>
  </details>
</div>
<div style="padding:0 20px 20px">
  <details class="dt"><summary>Exceptions for ${r.id} <span class="c">1</span></summary>
  <div class="irow" style="margin-top:8px"><span class="in">features/legacy/**</span><span>expires 2026-12-01</span><span class="inote">matches 3 files today &middot; "old checkout, ticket #512"</span></div>
  <a style="display:inline-block;margin-top:8px">+ Add exception</a>
  </details>
</div>`;

const rulesRight = () => `
<div class="pane-h"><span class="title">Inspect</span></div>
${tabs([['Diff'], ['All exceptions'], ['Advanced'], ['Project']], 'Diff')}
<div class="scroll" style="padding:14px">
  <p style="color:var(--text-muted);margin:0 0 10px">No pending changes. Edit a rule's severity or an exception to see it here as a diff before it is saved.</p>
  <div class="card"><b>Advanced (nonLayer, frozen)</b><p>Glob lists that change what counts as a layer file, or is read-only. Collapsed by default — open from here.</p></div>
</div>`;

const diagBody = `<table><tr><th>Rule</th><th>File</th><th>Line</th><th>Message</th></tr>
<tr><td>PAGE-004</td><td>features/catalog/pages/ProductPage.tsx</td><td>22</td><td>Page calls fetch().</td></tr>
<tr><td>PAGE-004</td><td>features/cart/pages/CartPage.tsx</td><td>9</td><td>Page calls fetch().</td></tr>
<tr><td>SERVICE-002</td><td>features/billing/services/InvoiceService.ts</td><td>14</td><td>Direct SDK call outside a service boundary.</td></tr>
</table>`;

writeFileSync(join(here, 'ia-rules.html'), page('Rules', frame({
  left: rulesLeft('PAGE-004'), mid: ruleDetail(RULES[1]), right: rulesRight(),
  bot: bottom('Diagnostics', diagBody), rw: 320,
})));

// --- ia-rules-edit.html: severity changed + an exception added, shown as a pending diff with impact preview ---
const pendingDiff = `
<div class="pane-h"><span class="title">Inspect</span></div>
${tabs([['Diff', ['2', 'acc']], ['All exceptions'], ['Advanced'], ['Project']], 'Diff')}
<div class="scroll" style="padding:14px">
  <div class="card" style="border-color:var(--warn)">
    <b>This makes 14 files newly violate PAGE-004</b>
    <p>Tightening PAGE-004 from Warning to Error turns today's warnings into build-blocking errors. Nothing is written until you save.</p>
  </div>
  <details class="dt" open><summary>Pending changes <span class="c warn">2</span></summary>
    <div class="nx"><div class="nxh"><span class="no">1</span><div class="grow"><b>PAGE-004: Warning &rarr; Error</b><small>0 files newly pass, 14 already-warned files become errors</small></div></div></div>
    <div class="nx"><div class="nxh"><span class="no">2</span><div class="grow"><b>+ exception: features/legacy/** &rarr; PAGE-004</b><small>expires 2026-12-01 &middot; matches 3 files</small></div></div></div>
  </details>
  <details class="dt"><summary>YAML diff</summary>
  <div class="fm" style="margin-top:8px"><div class="fmh">architecture.yml</div><pre>  rules:
-   PAGE-004: warning
+   PAGE-004: error

  exceptions:
+   - path: features/legacy/**
+     rule: PAGE-004
+     expires: 2026-12-01
+     reason: old checkout, ticket #512</pre></div>
  </details>
  <div style="display:flex;flex-direction:column;gap:8px;margin-top:12px;align-items:stretch">
    <button class="btn primary" style="width:100%">Save &middot; 14 new errors (dry-run checked)</button>
    <button class="btn" style="width:100%">Discard</button>
  </div>
</div>`;

const ruleDetailEdit = (r) => ruleDetail({ ...r, severity: 'error' }).replace('Violates today', 'Violates today (before this change)');

writeFileSync(join(here, 'ia-rules-edit.html'), page('Rules - editing', frame({
  left: rulesLeft('PAGE-004'), mid: ruleDetailEdit(RULES[1]), right: pendingDiff,
  bot: bottom('Approvals', `<div class="card"><b>Nothing waiting yet</b><p>Save the pending rules change above to send it here for approval before it is written.</p></div>`), rw: 340,
})));

// --- ia-envelopes.html: step list + preview ---
const envLeft = () => `
<div class="pane-h"><span class="title">Envelopes</span><span class="spacer"></span><button class="icon-btn" aria-label="New flow">+</button></div>
${tabs([['Notes'], ['Features'], ['Rules'], ['Envelopes']], 'Envelopes')}
<div class="search">&#8981; Filter flows <span class="spacer"></span><kbd>/</kbd></div>
<div class="scroll">
  <div class="sect">Saved flows &middot; 2</div>
  <div class="tree">
    <div class="row sel"><span>Add CRUD feature</span><span class="meta">5 steps</span></div>
    <div class="row"><span>Add a service + hook only</span><span class="meta">2 steps</span></div>
  </div>
</div>`;

const stepRow = (n, layer, name, mech, args) => `
<div class="step">
  <span class="no">${n}</span>
  <div><div>${L(layer)} <b>${name}</b></div>${args ? `<small>${args}</small>` : ''}</div>
  <span>${mech ? '<span class="tag det">Deterministic</span>' : '<span class="tag llm">Local model</span>'}</span>
</div>`;

const envMid = () => `
<div class="hh" style="padding:16px 20px 0">Add CRUD feature <small>5 steps &middot; last used 2 days ago</small></div>
<div style="padding:10px 20px 0;display:flex;gap:8px">
  <button class="btn">&#8593;&#8595; Reorder (Alt+&uarr;/&darr;)</button>
  <button class="btn">+ Add step</button>
  <span class="spacer"></span>
  <button class="btn primary">Run this flow</button>
</div>
<div style="padding:10px 20px 20px">
  <div style="border:1px solid var(--border-subtle);border-radius:var(--r-lg);overflow:hidden">
    ${stepRow(1, 'domain', 'Total', true)}
    ${stepRow(2, 'service', 'Total', true, 'reads: Total (domain)')}
    ${stepRow(3, 'workflow', 'cartMachine', true, 'reads: Total (service)')}
    ${stepRow(4, 'hook', 'useCart', true, 'reads: cartMachine (workflow)')}
    ${stepRow(5, 'page', 'CartPage', false, 'body filled on create --llm; stub is mechanical')}
  </div>
  <p style="color:var(--text-muted);font-size:12px;margin-top:10px">Feature name is asked once, at "Run this flow" — every step below runs against it. Steps shown here are a saved shape, not yet bound to a project.</p>
</div>`;

const envRight = () => `
<div class="pane-h"><span class="title">Inspect</span></div>
${tabs([['Preview'], ['Save']], 'Preview')}
<div class="scroll" style="padding:14px">
  <p style="color:var(--text-muted);margin:0 0 8px">Envelope handed to step 3 (workflow cartMachine) — computed, not stored.</p>
  <div class="fm"><div class="fmh">envelope (preview)</div><pre>{
  "version": 1,
  "feature": "&lt;feature&gt;",
  "status": "pending",
  "layers": {
    "domain": ["features/&lt;feature&gt;/domain/Total.ts"],
    "service": ["features/&lt;feature&gt;/services/TotalService.ts"]
  },
  "steps": [
    { "layer": "workflow", "name": "cartMachine" },
    { "layer": "hook", "name": "useCart" },
    { "layer": "page", "name": "CartPage" }
  ]
}</pre></div>
  <p style="color:var(--text-muted);font-size:12px;margin-top:8px">"&lt;feature&gt;" is filled in when the flow runs.</p>
</div>`;

writeFileSync(join(here, 'ia-envelopes.html'), page('Envelopes', frame({
  left: envLeft(), mid: envMid(), right: envRight(),
  bot: bottom('Processes', `<table><tr><th>Process</th><th>Step</th><th>Progress</th><th></th></tr>
<tr><td><b>flow &middot; Add a service + hook only</b></td><td>1 of 2 &middot; service Refund</td><td><div class="bar-track"><div class="bar-fill" style="width:40%"></div></div></td><td><button class="btn sm danger">Cancel</button></td></tr></table>`), rw: 340,
})));

// --- ia-rules-states.html: empty / loading / error, as illustrative cards (same pattern as ia-git-states.html) ---
writeFileSync(join(here, 'ia-rules-states.html'), page('Rules - states', `
<div class="hh">Rules and Envelopes: empty, loading and error<small>Shown as the center-stage card on the Rules tab; the left/right panels stay populated (principles.md #9, "designed screens, not blank space").</small></div>
<div class="sheet3">
  <div><h3>No architecture.yml yet</h3>${stateCard('&#128196;', 'No rules file yet', 'This project has no architecture.yml. Create one from the strict-nextjs preset to get started — this is itself a reviewable diff, nothing is written silently.', '<button class="btn primary">Create with defaults</button>')}</div>
  <div><h3>Impact check running</h3>${stateCard('&#8635;', 'Checking impact...', 'Re-running construct validate against the pending config, against 214 files. This can take a few seconds; Save stays disabled until it finishes.', '')}</div>
  <div><h3>Validate failed to run</h3>${stateCard('&#9888;', 'Could not run validate', `The validate process exited with an error: "architecture.yml: unknown rule id 'PAGE-099'." Fix the file or retry.`, '<button class="btn">Retry</button>')}</div>
</div>
`));

// --- ia-rules-narrow.html: 390px, Stage tab open on a rule (same split as ia-git-narrow.html) ---
const phone = (title, body) => `<div><h3 style="margin:0 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.07em;color:var(--text-muted)">${title}</h3>
<div class="narrow" style="position:relative;height:780px;width:390px;border:1px solid var(--border-strong);border-radius:20px;overflow:hidden;background:var(--surface-0)">
  ${topbar({ screen: 'Features', procs: '' })}
  <div style="height:calc(780px - 44px - 40px);overflow:auto">${body}</div>
  <div class="tabbar" style="height:40px;display:flex;border-top:1px solid var(--border-subtle)"><div style="flex:1">Browse</div><div style="flex:1;font-weight:700">Stage</div><div style="flex:1">Inspect</div><div style="flex:1">Run</div></div>
</div></div>`;

writeFileSync(join(here, 'ia-rules-narrow.html'), page('Rules - narrow', `<div class="sheet3" style="grid-template-columns:repeat(3,390px);justify-content:space-between">
${phone('Narrow &middot; Stage tab (rule detail)', ruleDetail(RULES[1]))}
${phone('Narrow &middot; Browse tab (rule list)', `${tabs([['Notes'], ['Features'], ['Rules'], ['Envelopes']], 'Rules')}<div class="tree" style="padding-top:8px">${ruleRow(RULES[0])}${ruleRow(RULES[1], 'PAGE-004')}${ruleRow(RULES[2])}${ruleRow(RULES[3])}</div>`)}
${phone('Narrow &middot; Inspect tab (pending diff)', pendingDiff)}
</div>`));

console.log('built ia-rules.html, ia-rules-edit.html, ia-envelopes.html, ia-rules-states.html, ia-rules-narrow.html');
