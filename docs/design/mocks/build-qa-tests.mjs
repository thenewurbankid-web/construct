// Concept mocks for QA test authoring (design ticket for #284).
// Usage: node docs/design/mocks/build-qa-tests.mjs && node docs/design/mocks/render.mjs
//
// Every scenario title, route, guard and Given/When/Then line below is REAL
// output of `explainSource(fixtures/workflow-graphs/refund-request.ts)` — the
// deterministic enumerator in packages/engine/workflowScenarios.mjs — so the mocks
// show what the tool actually computes, not invented content.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tabs, drawerBar, shell } from './parts.mjs';

// Local page wrapper: same frame as parts.page, plus this feature's own stylesheet
// (kept separate from mock.css so other mock work never collides with it).
const page = (title, body) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title} — Concept</title>
<link rel="stylesheet" href="mock.css"><link rel="stylesheet" href="qa-tests.css">
<script>document.documentElement.dataset.theme = new URLSearchParams(location.search).get('theme') || 'dark';</script>
</head><body>
<div class="concept">Concept — not implemented <span>${title}</span></div>
${body}
</body></html>`;

const here = dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ data */

// Real enumerator output (9 scenarios). `branch` is the distinguishing guard.
const SCENARIOS = [
  [1, 'Happy path', 'submitted → auto check → approved → refunded → closed', 'is low value', 'gen'],
  [2, 'Path 2', 'submitted → auto check → manual review → approved → refunded → closed', 'is suspicious', 'gen'],
  [3, 'Path 3', 'submitted → auto check → manual review → rejected', 'is suspicious', 'gen'],
  [4, 'Path 4', 'submitted → auto check → manual review → escalated → approved → refunded → closed', 'is suspicious · 48 h', 'gen'],
  [5, 'Path 5', 'submitted → auto check → manual review → escalated → rejected', 'is suspicious · 48 h', 'gen'],
  [6, 'Path 6', 'submitted → auto check → manual review → approved → refunded → closed', 'otherwise', 'gen'],
  [7, 'Path 7', 'submitted → auto check → manual review → rejected', 'otherwise', 'gen'],
  [8, 'Path 8', 'submitted → auto check → manual review → escalated → approved → refunded → closed', 'otherwise · 48 h', 'gen'],
  [9, 'Path 9', 'submitted → auto check → manual review → escalated → rejected', 'otherwise · 48 h', 'gen'],
];

/* --------------------------------------------------------------- pieces */

/** Browser pane, "Tests" tab: generated (locked) above, QA's own below. */
const testsTree = (sel = 'clone') => `
  <div class="pane-h"><span class="title">Browser</span><span class="spacer"></span><button class="icon-btn" aria-label="New test">+</button><button class="icon-btn" aria-label="Collapse pane">«</button></div>
  ${tabs([['Features'], ['Pages'], ['Flows'], ['Tests']], 'Tests')}
  <div class="search">⌕ Filter <span class="spacer"></span><kbd>/</kbd></div>
  <div class="scroll">
    <div class="sect">refunds · tests</div>
    <div class="tree">
      <div class="row"><span class="twisty">▾</span>Generated<span class="chip lock" style="margin-left:6px">Locked</span><span class="meta">9</span></div>
      ${SCENARIOS.slice(0, 5).map(([id, t], i) => `<div class="row l1 ${sel === 'gen' && i === 0 ? 'sel' : ''}"><span class="mark pass">✓</span><span class="lbl">${t}</span><span class="meta">#${id}</span></div>`).join('')}
      <div class="row l1"><span class="mark skip">·</span><span style="color:var(--text-faint)">4 more…</span></div>
      <div class="row" style="margin-top:6px"><span class="twisty">▾</span>Yours<span class="meta">2</span></div>
      <div class="row l1 ${sel === 'clone' ? 'sel' : ''}"><span class="mark fail">✗</span><span class="lbl">Refund over £50 → manual review</span><span class="meta">clone</span></div>
      <div class="row l1 ${sel === 'new' ? 'sel' : ''}"><span class="mark skip">○</span><span class="lbl">${sel === 'new' ? 'Untitled test' : 'Reviewer can ask for more info'}</span><span class="meta">${sel === 'new' ? 'new' : 'yours'}</span></div>
    </div>
    <div class="sect" style="margin-top:10px">Other features</div>
    <div class="tree">
      <div class="row"><span class="twisty">▸</span>checkout<span class="meta">6 tests</span></div>
      <div class="row"><span class="twisty">▸</span>auth<span class="meta">4 tests</span></div>
    </div>
  </div>`;

const step = ({ kw = '', txt, note = '', bind = '', cls = '', mark = '', ms = '' }) => `
  <div class="step ${cls}">
    <span class="grip">${mark ? `<span class="mark ${mark[0]}">${mark[1]}</span>` : '⠿'}</span>
    <span class="kw ${kw.toLowerCase()}">${kw}</span>
    <span class="txt"><span class="step-main">${txt}</span>${note ? `<span class="note">${note}</span>` : ''}</span>
    <span style="display:flex;align-items:center;gap:8px">${bind ? `<span class="bind-sel">${bind}</span>` : ''}${ms ? `<span class="ms">${ms}</span>` : '<span class="icon-btn" aria-label="Step menu">⋯</span>'}</span>
  </div>`;

const docHead = (title, chips, sub, right = '') => `
  <div class="doc-h">
    <div style="flex:1;min-width:0"><h2>${title}</h2><div class="sub">${sub}</div></div>
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:flex-end">${chips}${right}</div>
  </div>`;

const midTb = (crumbs, seg, right = '') => `
<div class="canvas-tb"><span class="crumbs">${crumbs}</span><span class="spacer"></span>${seg}${right}</div>`;

const seg = (items, on) => `<div class="seg">${items.map((i) => `<button class="${i === on ? 'on' : ''}">${i}</button>`).join('')}</div>`;

const idleProcs = (rows = 1) => `${drawerBar('Processes', ['0', '', '1'])}<div class="body"><table>
  <tr><th>Process</th><th>Kind</th><th>Status</th><th>Result</th><th></th></tr>
  <tr><td>test · refunds · Generated (9)</td><td><span class="tag det">Deterministic</span></td><td><span style="color:var(--success)">✓ Finished</span></td><td>9 passed · 11.4 s · 3 min ago</td><td><button class="btn sm">Open report</button></td></tr>
  ${rows > 1 ? '<tr><td>preview · storefront</td><td><span class="tag det">Deterministic</span></td><td><span class="pill run" style="height:20px"><span class="spin"></span>Running</span></td><td>localhost:5173 · up 41 min</td><td><button class="btn sm">Stop</button></td></tr>' : ''}</table></div>`;

/* ------------------------------------------------- 1 — flows and coverage */

const genTestPanel = `
${tabs([['Test'], ['Steps'], ['Code'], ['Runs'], ['Flow']], 'Test')}
<div class="scroll">
  <div class="section">
    <div class="el-head"><span class="name" style="font-size:14px">Happy path</span><span class="spacer"></span><span class="chip lock">Locked</span></div>
    <div class="path" style="margin-top:6px">features/refunds/tests/generated/<br>refund-request-01-happy-path.spec.ts</div>
  </div>
  <div class="callout warn" style="align-items:flex-start"><span>▮</span><div class="grow"><b>Generated — read-only</b><small>Construct writes this from the flow and rewrites it whenever the flow changes. Editing it would be lost. <b>Clone it</b> to make it yours.</small></div></div>
  <div style="padding:0 12px 10px;display:flex;gap:8px"><button class="btn primary sm">Clone to edit</button><button class="btn sm">Run this test</button><button class="btn sm">Show code</button></div>
  <div class="section"><h4>What it does <span class="tag det">Deterministic</span></h4>
    <div style="color:var(--text-muted);line-height:1.75">
      <b style="color:var(--text)">Given</b> the flow starts in <em>submitted</em><br>
      <b style="color:var(--text)">When</b> "request refund" happens<br>
      <b style="color:var(--text)">Then</b> the flow moves to <em>auto check</em><br>
      <b style="color:var(--text)">And</b> when it is low value<br>
      <b style="color:var(--text)">Then</b> the flow moves to <em>approved</em><br>
      <b style="color:var(--text)">And</b> when <span class="mono">issueRefund</span> finishes successfully<br>
      <b style="color:var(--text)">Then</b> the flow moves to <em>refunded</em><br>
      <b style="color:var(--text)">And</b> when "close" happens<br>
      <b style="color:var(--text)">Then</b> the flow moves to <em>closed</em>
    </div>
  </div>
  <div class="section"><h4>Last run</h4><div style="display:flex;gap:8px;align-items:center"><span class="chip pass">✓ Passed</span><span style="color:var(--text-muted)">1.3 s · 3 min ago · chromium</span></div></div>
</div>`;

writeFileSync(join(here, 'qa-tests-scenarios.html'), page('QA · flows and the tests that already cover them', shell({
  left: testsTree('gen'),
  mid: `${midTb('refunds › flows › <b>refundRequest</b>', seg(['Diagram', 'Story', 'Tests'], 'Tests'), '<button class="btn sm">Run all 9</button><button class="btn primary sm">+ New test</button>')}
  <div class="scroll" style="padding:14px 16px;background:var(--canvas)">
   <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
     <div><div style="font-weight:600">9 ways this flow can run</div><div style="color:var(--text-muted);font-size:12px">Worked out from the flow itself — no one wrote these by hand. Each one can become a test.</div></div>
     <span class="spacer"></span><span class="tag det">Deterministic</span>
   </div>
   <table class="scen-table" style="background:var(--surface-1);border:1px solid var(--border-subtle);border-radius:8px">
    <tr><th style="width:34px">#</th><th>Scenario</th><th style="width:132px">Which branch</th><th style="width:160px">Test</th></tr>
    ${SCENARIOS.map(([id, t, route, branch], i) => `<tr${i === 0 ? ' style="background:var(--accent-soft)"' : ''}>
      <td class="mono">${id}</td>
      <td><div${i === 0 ? ' style="font-weight:600"' : ''}>${t}</div><div class="mono" style="color:var(--text-faint);font-size:11px">${route}</div></td>
      <td class="scen-branch">${branch}</td>
      <td style="white-space:nowrap">${i < 7 ? '<span class="chip lock">Locked</span> <span style="color:var(--success)">✓ 1.3 s</span>' : '<span class="chip none">None</span> <button class="btn sm">Generate</button>'}</td></tr>`).join('')}
   </table>
  </div>
  <div class="canvas-foot"><span class="dot" style="color:var(--accent)"></span>Your own tests sit beside these and are never overwritten<span class="spacer"></span>9 scenarios · 7 with a generated test · 2 of your own</div>`,
  right: genTestPanel,
  drawer: idleProcs(2),
  drawerH: 146,
  lw: 292,
  rw: 380,
})));

/* -------------------------------------------------- 2 — lock, and cloning */

const lockedDoc = `
<div class="doc">
  ${docHead('Happy path', '<span class="chip lock">Generated · locked</span>', 'features/refunds/tests/generated/refund-request-01-happy-path.spec.ts')}
  <div class="doc-body">
    ${step({ kw: 'GIVEN', txt: 'Open <em>/refunds/new</em>', bind: 'page.goto' })}
    ${step({ kw: 'WHEN', txt: '“request refund” happens', note: 'Event REQUEST_REFUND from the flow', bind: '[data-testid="request-refund"]' })}
    ${step({ kw: 'THEN', txt: 'the flow moves to <em>auto check</em>', bind: '[data-flow-state="autoCheck"]' })}
    ${step({ kw: 'AND', txt: 'when it is low value', note: 'Guard isLowValue', cls: 'sel', bind: 'branch' })}
    ${step({ kw: 'THEN', txt: 'the flow moves to <em>approved</em>', bind: '[data-flow-state="approved"]' })}
    ${step({ kw: 'AND', txt: 'when <span class="mono">issueRefund</span> finishes successfully', bind: 'invoke.onDone' })}
    ${step({ kw: 'THEN', txt: 'the flow moves to <em>refunded</em>', bind: '[data-flow-state="refunded"]' })}
    ${step({ kw: 'AND', txt: 'when “close” happens', bind: '[data-testid="close"]' })}
    ${step({ kw: 'THEN', txt: 'the flow moves to <em>closed</em> — the flow ends here', bind: '[data-flow-state="closed"]' })}
  </div>
  <div class="doc-f"><b>Read-only</b> — — this test is rewritten whenever the flow changes<span class="spacer"></span><button class="btn sm">Show code</button></div>
</div>`;

writeFileSync(join(here, 'qa-tests-clone.html'), page('QA · the lock, and cloning a generated test', shell({
  left: testsTree('gen'),
  mid: `${midTb('refunds › tests › generated › <b>Happy path</b>', seg(['Steps', 'Code'], 'Steps'), '<button class="btn sm">Run</button>')}
   <div class="stage" style="padding:16px 20px;align-items:stretch">${lockedDoc}</div>
   <div class="canvas-foot"><span class="dot" style="color:var(--warn)"></span>You tried to change step 4 · generated tests cannot be edited<span class="spacer"></span>Esc to cancel</div>`,
  right: genTestPanel,
  drawer: idleProcs(1),
  drawerH: 96,
  lw: 292,
  rw: 380,
  dim: true,
  overlay: `<div class="scrim" style="padding-top:150px"><div class="dialog" role="dialog" aria-label="Clone to edit">
   <div class="head"><div><h3>This test is generated — clone it to edit</h3>
     <div style="color:var(--text-muted);margin-top:4px;line-height:1.5">Construct rewrites generated tests every time the flow changes, so an edit here would disappear. A clone is yours: nothing regenerates over it.</div></div></div>
   <div class="cont">
     <div class="frow"><label>Name your test</label><div class="ctl">Refund over £50 goes to manual review<span class="caret" style="width:1px;height:16px;background:var(--text);display:inline-block"></span></div></div>
     <div class="frow"><label>Saved as</label><div class="ctl mono" style="color:var(--text-muted)">features/refunds/tests/refund-over-50.spec.ts</div></div>
     <div class="frow"><label>What you get</label>
       <div style="color:var(--text-muted);line-height:1.7">All 9 steps, copied · editable<br>A note of where it came from: <span class="mono">Happy path · refundRequest@8f3c2a1</span><br><span style="color:var(--text)">So we can tell you later if the flow changes and your test drifts.</span></div></div>
   </div>
   <div class="foot"><button class="btn primary">Create clone and open</button><button class="btn">Cancel</button><span class="spacer"></span><button class="btn sm">Just show me the code</button></div>
  </div></div>`,
})));

/* ------------------------------------------------ 3 — editing without code */

const cloneDoc = (mode = 'edit') => `
<div class="doc">
  ${docHead('Refund over £50 goes to manual review',
    `<span class="chip mine">✎ Yours · clone of #1</span>${mode === 'edit' ? '<span class="chip">3 unsaved changes</span>' : '<span class="chip fail">✗ Failed</span>'}`,
    'features/refunds/tests/refund-over-50.spec.ts · cloned from Happy path (generated) · flow unchanged since')}
  <div class="doc-body">
    ${step({ kw: 'GIVEN', txt: 'Open <em>/refunds/new</em>', bind: 'page.goto', mark: mode === 'run' ? ['pass', '✓'] : '', ms: mode === 'run' ? '412 ms' : '' })}
    ${step({ kw: 'AND', txt: 'Type <em>120</em> into “Amount”', note: 'Added by you — makes the refund too big to auto-approve', cls: mode === 'edit' ? 'edited' : '', bind: '[data-testid="amount"]', mark: mode === 'run' ? ['pass', '✓'] : '', ms: mode === 'run' ? '96 ms' : '' })}
    ${step({ kw: 'WHEN', txt: '“request refund” happens', note: 'Event REQUEST_REFUND from the flow', bind: '[data-testid="request-refund"]', cls: mode === 'run' ? 'failed' : '', mark: mode === 'run' ? ['fail', '✗'] : '', ms: mode === 'run' ? '5.0 s' : '' })}
    ${step({ kw: 'THEN', txt: 'the flow moves to <em>auto check</em>', bind: '[data-flow-state="autoCheck"]', mark: mode === 'run' ? ['skip', '○'] : '', ms: mode === 'run' ? '—' : '' })}
    ${step({ kw: 'AND', txt: 'when it is <em>not</em> low value', note: 'Changed by you — was “when it is low value”', cls: mode === 'edit' ? 'edited' : '', bind: 'branch', mark: mode === 'run' ? ['skip', '○'] : '', ms: mode === 'run' ? '—' : '' })}
    ${step({ kw: 'THEN', txt: 'the flow moves to <em>manual review</em>', bind: '[data-flow-state="manualReview"]', mark: mode === 'run' ? ['skip', '○'] : '', ms: mode === 'run' ? '—' : '' })}
    ${step({ kw: 'CHECK', txt: 'the page shows “A reviewer will check this refund”', note: 'Added by you', cls: mode === 'edit' ? 'sel' : '', bind: 'text is visible', mark: mode === 'run' ? ['skip', '○'] : '', ms: mode === 'run' ? '—' : '' })}
    ${mode === 'edit' ? step({ kw: 'AND', txt: 'when “close” happens', note: 'Removed by you — this test stops at manual review', cls: 'removed', bind: '[data-testid="close"]' }) : ''}
  </div>
  <div class="doc-f">${mode === 'edit'
    ? '<button class="btn sm">+ Add step</button><button class="btn sm">+ Add check</button><span class="spacer"></span><span>Drag ⠿ to reorder · nothing is written until you review the changes</span>'
    : '<span class="chip fail">✗ Failed at step 3</span><span class="spacer"></span><span>2 passed · 1 failed · 4 not run · 5.5 s</span>'}</div>
</div>`;

writeFileSync(join(here, 'qa-tests-editor.html'), page('QA · editing a cloned test without writing code', shell({
  left: testsTree('clone'),
  mid: `${midTb('refunds › tests › <b>Refund over £50 goes to manual review</b>', seg(['Steps', 'Code'], 'Steps'), '<button class="btn sm">Run</button><button class="btn primary sm">Review (3)</button>')}
   <div class="stage" style="padding:16px 20px;align-items:stretch">${cloneDoc('edit')}</div>
   <div class="canvas-foot"><span class="dot" style="color:var(--accent)"></span>Step 7 selected — edit it on the right<span class="spacer"></span>Nothing on disk has changed yet</div>`,
  right: `${tabs([['Step'], ['Test'], ['Code'], ['Changes', ['3', 'acc']], ['Runs']], 'Step')}
   <div class="scroll">
    <div class="section"><div class="el-head"><span class="kw check" style="padding:2px 8px">CHECK</span><span class="name" style="font-size:14px">Step 7</span><span class="spacer"></span><button class="icon-btn" aria-label="Move up">↑</button><button class="icon-btn" aria-label="Move down">↓</button><button class="btn sm">Remove</button></div></div>
    <div class="section">
      <div class="frow"><label>What to check</label><div class="ctl sel-ctl">Text is visible</div></div>
      <div class="frow"><label>Text</label><div class="ctl area">A reviewer will check this refund</div></div>
      <div class="frow"><label>Match</label><div class="ctl sel-ctl">Contains (ignore case)</div></div>
      <div class="frow"><label>Where</label><div class="ctl sel-ctl">Anywhere on the page</div></div>
      <div class="frow"><label>Wait up to</label><div class="ctl sel-ctl">5 seconds</div></div>
    </div>
    <div class="section"><h4>What this becomes <span class="tag det">Deterministic</span></h4>
      <div class="becomes">await expect(
  page.getByText('A reviewer will check this refund')
).toBeVisible({ timeout: 5000 });</div>
      <small style="color:var(--text-muted);display:block;margin-top:6px">Written by a Construct block from the choices above. No model is involved, and you never have to read this.</small>
    </div>
    <div class="section"><h4>Other step types</h4>
      <div style="display:flex;gap:6px;flex-wrap:wrap"><span class="chip">Go to</span><span class="chip">Click</span><span class="chip">Type</span><span class="chip">Flow event</span><span class="chip">Flow state</span><span class="chip">Check</span><span class="chip">Wait</span></div></div>
   </div>`,
  drawer: idleProcs(1),
  drawerH: 96,
  lw: 292,
  rw: 380,
})));

/* --------------------------------------- 4 — the same file, and the diff */

const specLines = [
  ['1', "<span class='k1'>import</span> { test, expect } <span class='k1'>from</span> <span class='k3'>'@playwright/test'</span>;"],
  ['2', "<span class='k1'>import</span> { send, atState } <span class='k1'>from</span> <span class='k3'>'construct/test'</span>;"],
  ['3', ''],
  ['4', "<span class='k4'>// Cloned from generated scenario 1 \"Happy path\" · refundRequest@8f3c2a1</span>"],
  ['5', "<span class='k2'>test</span>(<span class='k3'>'Refund over £50 goes to manual review'</span>, <span class='k1'>async</span> ({ page }) =&gt; {"],
  ['6', "  <span class='k1'>await</span> page.<span class='k2'>goto</span>(<span class='k3'>'/refunds/new'</span>);"],
  ['7', "  <span class='k1'>await</span> page.<span class='k2'>getByTestId</span>(<span class='k3'>'amount'</span>).<span class='k2'>fill</span>(<span class='k3'>'120'</span>);", 'add'],
  ['8', "  <span class='k1'>await</span> <span class='k2'>send</span>(page, <span class='k3'>'REQUEST_REFUND'</span>);"],
  ['9', "  <span class='k1'>await</span> <span class='k2'>atState</span>(page, <span class='k3'>'autoCheck'</span>);"],
  ['10', "  <span class='k1'>await</span> <span class='k2'>atState</span>(page, <span class='k3'>'approved'</span>);", 'del'],
  ['10', "  <span class='k1'>await</span> <span class='k2'>atState</span>(page, <span class='k3'>'manualReview'</span>);", 'add'],
  ['11', "  <span class='k1'>await</span> <span class='k2'>expect</span>(page.<span class='k2'>getByText</span>(<span class='k3'>'A reviewer will check this refund'</span>))", 'add'],
  ['12', "    .<span class='k2'>toBeVisible</span>({ timeout: <span class='k3'>5000</span> });", 'add'],
  ['13', "  <span class='k1'>await</span> <span class='k2'>send</span>(page, <span class='k3'>'CLOSE'</span>);", 'del'],
  ['14', "  <span class='k1'>await</span> <span class='k2'>atState</span>(page, <span class='k3'>'closed'</span>);", 'del'],
  ['15', '});'],
];
const specCode = `<div class="code">${specLines.map(([n, t, c]) => `<div class="ln ${c || ''}"><i>${c === 'add' ? '+' : c === 'del' ? '−' : n}</i><span>${t}</span></div>`).join('')}</div>`;

writeFileSync(join(here, 'qa-tests-changes-code.html'), page('QA · the same file an engineer reads, and the diff before it is written', shell({
  left: testsTree('clone'),
  mid: `${midTb('refunds › tests › <b>Refund over £50 goes to manual review</b>', seg(['Steps', 'Code'], 'Code'), '<button class="btn sm">Run</button><button class="btn primary sm">Review (3)</button>')}
   <div class="stage" style="padding:16px 20px;align-items:stretch">
     <div class="doc">
       ${docHead('refund-over-50.spec.ts', '<span class="chip mine">✎ Yours</span><span class="chip">3 unsaved changes</span>', 'This is the file that actually runs. Reading it is optional — your steps are written here for you.')}
       <div class="doc-body" style="padding:10px 0">${specCode}</div>
       <div class="doc-f"><span class="tag det">Deterministic</span>Every line above came from a step you set — no model wrote any of it<span class="spacer"></span><button class="btn sm">Open in your editor</button></div>
     </div>
   </div>
   <div class="canvas-foot"><span class="dot" style="color:var(--accent)"></span>Code view · switch back to Steps at any time<span class="spacer"></span>Engineers and QA read the same file</div>`,
  right: `${tabs([['Step'], ['Test'], ['Code'], ['Changes', ['3', 'acc']], ['Runs']], 'Changes')}
   <div class="callout info"><span>ℹ</span><div class="grow"><b>3 changes, nothing written yet</b><small>Review them in plain language, then apply. This is the same review step the Pages and Flows editors use.</small></div></div>
   <div class="scroll">
    <div class="section"><h4>What you changed</h4>
      <div class="step" style="grid-template-columns:18px 1fr;padding-left:0"><span class="grip" style="color:var(--success)">+</span><span class="txt">Type <em>120</em> into “Amount”<span class="note">new step 2 · line 7</span></span></div>
      <div class="step" style="grid-template-columns:18px 1fr;padding-left:0"><span class="grip" style="color:var(--warn)">~</span><span class="txt">Branch: <em>not</em> low value → goes to <em>manual review</em><span class="note">was “approved” · line 10</span></span></div>
      <div class="step" style="grid-template-columns:18px 1fr;padding-left:0"><span class="grip" style="color:var(--success)">+</span><span class="txt">Check the page shows “A reviewer will check this refund”<span class="note">new step 7 · lines 11–12</span></span></div>
      <div class="step" style="grid-template-columns:18px 1fr;padding-left:0;border-bottom:0"><span class="grip" style="color:var(--danger)">−</span><span class="txt">Removed “close the refund” and its outcome<span class="note">lines 13–14</span></span></div>
    </div>
    <div class="section"><h4>Where it goes</h4><div class="path">features/refunds/tests/refund-over-50.spec.ts</div>
      <small style="color:var(--text-muted);display:block;margin-top:6px">Your own tests sit beside the generated ones, never inside them.</small></div>
    <div style="padding:12px;display:flex;gap:8px"><button class="btn primary">Apply to file</button><button class="btn">Discard</button><span class="spacer"></span><button class="btn sm">Run after applying</button></div>
   </div>`,
  drawer: `${drawerBar('Diagnostics', ['0', '', '1'])}<div class="body"><div style="padding:14px 12px;color:var(--text-muted)">No problems found in this test. <span style="color:var(--text-faint)">Checked: every event exists in the flow, every check has a value, the file stays outside <span class="mono">tests/generated/</span>.</span></div></div>`,
  drawerH: 96,
  lw: 292,
  rw: 400,
})));

/* -------------------------------------------- 5 — authoring from scratch */

writeFileSync(join(here, 'qa-tests-new.html'), page('QA · writing a brand-new test from scratch', shell({
  left: testsTree('new'),
  mid: `${midTb('refunds › tests › <b>Untitled test</b>', seg(['Steps', 'Code'], 'Steps'), '<button class="btn sm" disabled style="opacity:.5">Run</button><button class="btn primary sm">Review (2)</button>')}
   <div class="stage" style="padding:16px 20px;align-items:stretch">
    <div class="doc">
      ${docHead('Untitled test', '<span class="chip mine">✎ Yours · new</span>', 'features/refunds/tests/ · not saved yet')}
      <div style="padding:10px 14px;border-bottom:1px solid var(--border-subtle);display:flex;gap:8px;align-items:center">
        <span style="color:var(--text-muted);font-size:11px;text-transform:uppercase;letter-spacing:.06em">Start from</span>
        <span class="chip">A flow scenario</span><span class="chip">Record what I do</span><span class="chip">A page</span><span class="chip mine">Blank ✓</span>
        <span class="spacer"></span><span style="color:var(--text-faint);font-size:11px">A scenario copies its steps; recording writes them as you click</span>
      </div>
      <div class="doc-body">
        ${step({ kw: 'GIVEN', txt: 'Open <em>/refunds/42</em>', bind: 'page.goto' })}
        ${step({ kw: 'WHEN', txt: '“need more info” happens', note: 'Event NEED_MORE_INFO from refundRequest', bind: '[data-testid="need-more-info"]', cls: 'sel' })}
        <div class="step" style="grid-template-columns:18px 1fr;color:var(--text-faint)"><span class="grip">+</span><span class="txt">Add step 3 — pick one from <b style="color:var(--text)">Add a step</b> on the right</span></div>
      </div>
      <div class="doc-f"><button class="btn sm">+ Add step</button><button class="btn sm">+ Add check</button><span class="spacer"></span><span>A test needs at least one check before it can run</span></div>
    </div>
   </div>
   <div class="canvas-foot"><span class="dot" style="color:var(--text-faint)"></span>Empty test · 2 steps so far<span class="spacer"></span>Nothing is written until you review the changes</div>`,
  right: `${tabs([['Step'], ['Add a step'], ['Code'], ['Changes', ['2', 'acc']], ['Runs']], 'Add a step')}
   <div class="search" style="margin:8px 12px">⌕ Search steps, events, pages<span class="spacer"></span><kbd>/</kbd></div>
   <div class="scroll">
    <div class="section" style="padding-bottom:4px"><h4>Events in refundRequest <span class="tag det">7 · from the flow</span></h4></div>
    <div class="pal">
      ${[['REQUEST_REFUND', 'request-refund'], ['APPROVE', 'approve'], ['REJECT', 'reject'], ['NEED_MORE_INFO', 'need-more-info'], ['CLOSE', 'close']].map(([e, t]) => `<div class="it"><span class="kw when" style="width:52px;padding:2px 6px;flex:none">WHEN</span><span class="col">${e.toLowerCase().replace(/_/g, ' ')}<code>[data-testid="${t}"]</code></span><span class="add">+</span></div>`).join('')}
    </div>
    <div class="section" style="padding-bottom:4px;border-top:1px solid var(--border-subtle)"><h4>Checks</h4></div>
    <div class="pal">
      ${[['Flow is in a state', 'THEN'], ['Text is visible', 'CHECK'], ['URL is', 'CHECK'], ['Element exists', 'CHECK'], ['Field has value', 'CHECK']].map(([n, k]) => `<div class="it"><span class="kw ${k === 'THEN' ? 'then' : 'check'}" style="width:52px;padding:2px 6px">${k}</span>${n}<span class="add">+</span></div>`).join('')}
    </div>
    <div class="section" style="border-top:1px solid var(--border-subtle)"><h4>Pages in this project</h4>
      <div class="pal" style="padding:0">${['/refunds/new', '/refunds/[id]', '/account'].map((p) => `<div class="it" style="padding:0"><span class="kw given" style="width:52px;padding:2px 6px">GO TO</span><span class="mono">${p}</span><span class="add">+</span></div>`).join('')}</div></div>
   </div>`,
  drawer: idleProcs(1),
  drawerH: 96,
  lw: 292,
  rw: 380,
})));

/* -------------------------------------------- 6 — running it, and failing */

writeFileSync(join(here, 'qa-tests-run-failure.html'), page('QA · running a test as a process, and reading a failure', shell({
  procs: '1 running',
  left: testsTree('clone'),
  mid: `${midTb('refunds › tests › <b>Refund over £50 goes to manual review</b>', seg(['Steps', 'Code'], 'Steps'), '<span class="chip fail">✗ Failed · 5.5 s</span><button class="btn sm">Rerun</button>')}
   <div class="stage" style="padding:14px 20px;align-items:stretch">${cloneDoc('run')}</div>
   <div class="canvas-foot"><span class="dot" style="color:var(--danger)"></span>Step 3 failed — details on the right<span class="spacer"></span>Run #14 · chromium · started 14:22:06</div>`,
  right: `${tabs([['Step'], ['Test'], ['Code'], ['Changes'], ['Runs', ['!', 'danger']]], 'Runs')}
   <div class="callout warn" style="align-items:flex-start"><span>⚠</span><div class="grow"><b>Test harness problem — not a bug in the refunds page</b><small>The page never got as far as behaving wrongly. The test could not find the element it was told to use.</small></div></div>
   <div class="scroll">
    <div class="section"><h4>What happened</h4>
      <div style="line-height:1.7">Step 3 sends the event <span class="mono">REQUEST_REFUND</span>.<br>
      Construct looks for <span class="mono" style="color:var(--text)">[data-testid="request-refund"]</span> on <span class="mono">/refunds/new</span>.<br>
      <b>No element on that page has it.</b></div>
      <div class="becomes" style="margin-top:8px;color:var(--danger);border-color:var(--danger)">ConventionError: event REQUEST_REFUND expects
  [data-testid="request-refund"]
  on /refunds/new — no element matched.</div>
    </div>
    <div class="section"><h4>How to fix it</h4>
      <div class="step" style="grid-template-columns:18px 1fr;padding-left:0"><span class="grip">1</span><span class="txt">Add <span class="mono">data-testid="request-refund"</span> to the refund button<span class="note">Construct adds this to elements it generates; this one was hand-written</span></span></div>
      <div class="step" style="grid-template-columns:18px 1fr;padding-left:0;border-bottom:0"><span class="grip">2</span><span class="txt">Or point this event at a different element<span class="note">architecture.yml → testids: — a fallback, not the normal route</span></span></div>
      <div style="display:flex;gap:8px;margin-top:10px"><button class="btn primary sm">Open the button in Pages</button><button class="btn sm">Add the attribute for me</button></div>
    </div>
    <div class="section"><h4>From the run</h4>
      <div class="arts"><div class="art"><b>Trace</b>step by step</div><div class="art"><b>Video</b>5.5 s</div><div class="art"><b>Screenshot</b>at failure</div></div>
    </div>
   </div>`,
  drawer: `${drawerBar('Processes', ['0', '', '1'])}
   <div class="body" style="display:grid;grid-template-columns:1fr 520px">
    <table>
     <tr><th>Process</th><th>Kind</th><th>Status</th><th>Progress</th><th></th></tr>
     <tr><td>test · Refund over £50 → manual review</td><td><span class="tag det">Deterministic</span></td><td><span style="color:var(--danger)">✗ Failed</span></td><td><div class="bar-track"><div class="bar-fill" style="width:38%;background:var(--danger)"></div></div></td><td><button class="btn sm">Run again</button> <button class="btn sm">Open trace</button></td></tr>
     <tr><td>test · refunds · Generated (9)</td><td><span class="tag det">Deterministic</span></td><td><span class="pill run" style="height:20px"><span class="spin"></span>Running 6/9</span></td><td><div class="bar-track"><div class="bar-fill" style="width:66%"></div></div></td><td><button class="btn sm">Pause</button> <button class="btn sm danger">Cancel</button></td></tr>
    </table>
    <div style="border-left:1px solid var(--border-subtle);padding-top:6px;overflow:hidden">
     <div class="logline"><time>14:22:06</time><span class="lv-ok">ok</span>run #14 · chromium · /refunds/new</div>
     <div class="logline"><time>14:22:07</time><span class="lv-ok">ok</span>step 1 “open /refunds/new” · 412 ms</div>
     <div class="logline"><time>14:22:07</time><span class="lv-ok">ok</span>step 2 “type 120 into Amount” · 96 ms</div>
     <div class="logline"><time>14:22:12</time><span class="lv-err">fail</span>step 3 · convention not met</div>
     <div class="logline"><time>14:22:12</time><span>trace, video and screenshot saved</span></div>
    </div>
   </div>`,
  drawerH: 144,
  lw: 292,
  rw: 400,
})));

/* ------------------------------ 7 — empty, loading, error, stale, narrow */

const card = (title, body, tone = '') => `
 <div class="state-card" style="height:auto;min-height:196px;align-items:flex-start;text-align:left;${tone ? `border-color:var(--${tone})` : ''}">${title}${body}</div>`;

writeFileSync(join(here, 'qa-tests-states.html'), page('QA tests · empty, loading, failure kinds, stale clone, narrow screen', `
<div class="sheet" style="grid-template-columns:1fr 1fr 1fr 400px">
 <div class="two">
  <h3>Empty — feature has no tests yet</h3>
  ${card('<div class="ico">▤</div><h5 style="margin-top:6px">No tests for refunds yet</h5>',
    '<p style="max-width:none">Construct already worked out <b>9 ways this flow can run</b>. Generate tests for them in one step, or start your own.</p><div style="display:flex;gap:8px;margin-top:6px"><button class="btn primary sm">Generate 9 tests</button><button class="btn sm">New test</button></div>')}
  <h3>Empty — no flow to start from</h3>
  ${card('<div class="ico">◇</div><h5 style="margin-top:6px">This feature has no flow</h5>',
    '<p style="max-width:none">Generated tests come from a flow (an XState machine). You can still write a test by hand, page by page.</p><div style="display:flex;gap:8px;margin-top:6px"><button class="btn sm">New blank test</button><button class="btn sm">Create a flow</button></div>')}
  <h3>Failure kind 1 — the test could not find the element</h3>
  ${card('<span class="chip lock">Convention not met</span>',
    '<p style="max-width:none">Step 3 sends <b>REQUEST_REFUND</b>, so the test looks for <span class="mono">[data-testid="request-refund"]</span>. Nothing on the page has it.<br><span style="color:var(--text-faint)">Not a product bug: the page was never exercised. Do not raise a ticket against refunds.</span></p><div style="display:flex;gap:8px"><button class="btn primary sm">Add the attribute</button><button class="btn sm">Show me the element</button></div>', 'warn')}
 </div>
 <div class="two">
  <h3>Loading — queued and running</h3>
  ${card('<span class="pill run"><span class="spin"></span>Queued · waiting for the preview server</span>',
    '<div class="skel" style="margin-top:10px"></div><div class="skel" style="width:60%"></div><p style="max-width:none">Runs are processes: you can leave this screen, and pause or cancel them from the drawer.</p><div style="display:flex;gap:8px"><button class="btn sm">Open Processes</button><button class="btn sm danger">Cancel</button></div>')}
  <h3>Failure kind 2 — the app behaved differently</h3>
  ${card('<span class="chip fail">✗ App behaved differently</span>',
    '<p style="max-width:none">Step 6 expected the flow to reach <b>manual review</b>. It reached <b>approved</b> instead.<br><span style="color:var(--text-faint)">The element was found, the click worked — the product did something else. This one is worth a bug report.</span></p><div style="display:flex;gap:8px"><button class="btn primary sm">Open trace</button><button class="btn sm">Copy as bug report</button></div>', 'danger')}
 </div>
 <div class="two">
  <h3>Error — cannot run yet</h3>
  ${card('<div class="ico" style="color:var(--danger);background:var(--danger-soft)">!</div><h5 style="margin-top:6px">Browsers are not installed</h5>',
    '<p style="max-width:none">Playwright needs Chromium once, on this machine.</p><div class="becomes">npx playwright install chromium</div><div style="display:flex;gap:8px;margin-top:6px"><button class="btn primary sm">Install now</button><button class="btn sm">Show logs</button></div>', 'danger')}
  <h3>Never run</h3>
  ${card('<div class="ico">○</div><h5 style="margin-top:6px">This test has not run yet</h5>',
    '<p style="max-width:none">Saved, but never executed. Running it starts a process; you can watch it in the drawer.</p><div style="display:flex;gap:8px;margin-top:6px"><button class="btn primary sm">Run now</button><button class="btn sm">Run with the other 9</button></div>')}
  <h3>Warning — the flow changed under a clone</h3>
  ${card('<span class="chip lock">Possibly out of date</span>',
    '<p style="max-width:none">“Refund over £50 goes to manual review” was cloned from <b>Happy path</b>. That flow has changed since: <b>auto check</b> now has a third branch.</p><div style="display:flex;gap:8px"><button class="btn primary sm">Compare with the flow</button><button class="btn sm">It is still fine</button></div>', 'warn')}
 </div>
 <div><h3>Narrow (phone, 390 px) — one pane at a time</h3><div class="narrow">
  <div class="topbar" style="height:44px;flex:none"><div class="brand"><i></i>Construct</div><span class="spacer"></span><span class="pill run"><span class="spin"></span>1</span><button class="icon-btn" aria-label="Menu">≡</button></div>
  <div class="canvas-tb"><span class="crumbs">refunds › <b>tests</b></span><span class="spacer"></span><button class="btn sm">Run</button></div>
  <div class="scroll" style="flex:1;background:var(--canvas);padding:10px">
    <div class="doc" style="max-width:none">
      <div class="doc-h" style="padding:10px 12px"><div style="flex:1"><h2 style="font-size:14px">Refund over £50…</h2><div class="sub">2 passed · 1 failed</div></div><span class="chip fail">✗</span></div>
      <div class="doc-body">
        <div class="step" style="grid-template-columns:18px 1fr;padding:2px 10px"><span class="mark pass">✓</span><span class="txt">Open /refunds/new</span></div>
        <div class="step" style="grid-template-columns:18px 1fr;padding:2px 10px"><span class="mark pass">✓</span><span class="txt">Type 120 into “Amount”</span></div>
        <div class="step failed" style="grid-template-columns:18px 1fr;padding:2px 10px"><span class="mark fail">✗</span><span class="txt">“request refund” happens<span class="note">Convention not met: [data-testid="request-refund"]</span></span></div>
        <div class="step" style="grid-template-columns:18px 1fr;padding:2px 10px"><span class="mark skip">○</span><span class="txt">the flow moves to auto check</span></div>
        <div class="step" style="grid-template-columns:18px 1fr;padding:2px 10px"><span class="mark skip">○</span><span class="txt">when it is not low value</span></div>
      </div>
      <div class="doc-f" style="padding:8px 10px"><button class="btn sm">Fix the attribute</button><button class="btn sm">Trace</button></div>
    </div>
  </div>
  <div class="tabbar" role="tablist"><div>Tests</div><div class="on">Steps</div><div>Tools</div><div>Processes</div></div></div></div>
</div>`));

console.log('qa test mocks written');

/* ===========================================================================
   Click and record (#284, owner 2026-09-20). Recording is the INPUT; the step
   document is the OUTPUT — the same rows the editor screens already show, so
   clone / lock / edit / review-diff / run-as-a-process all work unchanged. */

const refundApp = ({ hi = '', banner = false } = {}) => `
<div class="device" style="width:100%;height:100%;max-height:none">
  <div class="bar"><i></i><i></i><i></i>&nbsp;&nbsp;localhost:5173/refunds/new <span style="margin-left:auto;color:#7a8497">recording</span></div>
  <div class="app-nav"><b>Storefront</b><span>Orders</span><span>Refunds</span><span>Account</span></div>
  <div class="refund">
    <h2>Request a refund</h2><p>Order #4471 · placed 12 March</p>
    ${banner ? '<div class="banner">A reviewer will check this refund</div>' : ''}
    <label>Amount</label><div class="in">120</div>
    <label>Reason</label><div class="in">Item arrived damaged</div>
    <div class="cta">Request refund</div>
    <div class="ghost">Save as draft</div>
  </div>
  ${hi}
</div>`;

const capRow = (kw, txt, note, cls = '') => `
  <div class="cap ${cls}"><span class="kw ${kw.toLowerCase()}">${kw}</span>
    <span class="txt">${txt}${note ? `<span class="note">${note}</span>` : ''}</span></div>`;

const recTabs = (on, changes = '3') => tabs([['Recording'], ['Step'], ['Code'], ['Changes', [changes, 'acc']], ['Runs']], on);

const recProcs = (h) => `${drawerBar('Processes', ['0', '', '2'])}<div class="body"><table>
  <tr><th>Process</th><th>Kind</th><th>Status</th><th>Detail</th><th></th></tr>
  <tr><td>recorder · chromium</td><td><span class="tag det">Deterministic</span></td><td><span class="pill run" style="height:20px"><span class="spin"></span>${h}</span></td><td>capturing into “Untitled recording”</td><td><button class="btn sm">Pause</button> <button class="btn sm danger">Stop</button></td></tr>
  <tr><td>preview · storefront</td><td><span class="tag det">Deterministic</span></td><td><span class="pill run" style="height:20px"><span class="spin"></span>Running</span></td><td>localhost:5173 · up 41 min</td><td><button class="btn sm">Stop</button></td></tr></table></div>`;

const whatIsCaptured = `
  <div class="section"><h4>What gets captured</h4>
    <div style="color:var(--text-muted);line-height:1.7">Clicks · typing · moving between pages · the checks you pick<br>
    <span style="color:var(--text-faint)">Not captured: hovering, scrolling, how fast you clicked.</span></div></div>`;

/* --- A. starting a recording ------------------------------------------- */

const blankDoc = `
<div class="doc">
  ${docHead('Untitled test', '<span class="chip mine">Yours · new</span>', 'features/refunds/tests/ · not saved yet')}
  <div style="padding:10px 14px;border-bottom:1px solid var(--border-subtle);display:flex;gap:8px;align-items:center">
    <span style="color:var(--text-muted);font-size:11px;text-transform:uppercase;letter-spacing:.06em">Start from</span>
    <span class="chip">A flow scenario</span><span class="chip mine">Record what I do ✓</span><span class="chip">A page</span><span class="chip">Blank</span>
  </div>
  <div class="doc-body"><div class="step" style="grid-template-columns:18px 1fr;color:var(--text-faint)"><span class="grip">+</span><span class="txt">No steps yet — recording will write them here as you click</span></div></div>
  <div class="doc-f"><button class="btn sm">+ Add step</button><span class="spacer"></span><span>Nothing is written until you review the changes</span></div>
</div>`;

writeFileSync(join(here, 'qa-tests-record-start.html'), page('QA · starting a recording', shell({
  procs: '1 running',
  left: testsTree('new'),
  mid: `${midTb('refunds › tests › <b>Untitled test</b>', seg(['Steps', 'Code'], 'Steps'), '<button class="btn primary sm">Record</button>')}
   <div class="stage" style="padding:16px 20px;align-items:stretch">${blankDoc}</div>
   <div class="canvas-foot"><span class="dot" style="color:var(--text-faint)"></span>Empty test<span class="spacer"></span>Recording is one of three ways to get steps</div>`,
  right: `${recTabs('Recording', '0')}
   <div class="scroll">
    <div class="section"><h4>Record what you do</h4>
      <div style="color:var(--text-muted);line-height:1.7">A real browser opens on your running app. Everything you click is written down as a step you can read — not as code.</div></div>
    ${whatIsCaptured}
    <div class="section"><h4>Then what</h4>
      <div style="color:var(--text-muted);line-height:1.7">The steps land in this document, exactly like generated or hand-written ones: editable, reorderable, reviewed as a diff before anything is written.</div></div>
   </div>`,
  drawer: idleProcs(1),
  drawerH: 96,
  lw: 292,
  rw: 380,
  dim: true,
  overlay: `<div class="scrim" style="padding-top:120px"><div class="dialog" role="dialog" aria-label="Record a test">
   <div class="head"><div><h3>Record a test</h3>
     <div style="color:var(--text-muted);margin-top:4px;line-height:1.5">A real browser opens against your running app. Everything you click becomes a step in plain language — you never see code.</div></div></div>
   <div class="cont">
     <div class="frow"><label>Record into</label><div class="ctl sel-ctl">A new test in <b style="margin-left:4px">refunds</b></div></div>
     <div class="frow"><label>Start at</label><div class="ctl sel-ctl mono">/refunds/new</div></div>
     <div class="frow"><label>Browser</label><div class="ctl sel-ctl">Chromium — the same one your tests run in</div></div>
     <div style="display:flex;gap:8px;align-items:center"><span class="pill ok"><span class="dot"></span>Preview running · localhost:5173</span><span style="color:var(--text-faint)">no need to start anything</span></div>
     <div class="frow"><label>What gets captured</label>
       <div style="color:var(--text-muted);line-height:1.7">Clicks · typing · moving between pages · the checks you pick<br>
       <span style="color:var(--text-faint)">Not captured: hovering, scrolling, how fast you clicked.</span></div></div>
   </div>
   <div class="foot"><button class="btn primary">Open browser and record</button><button class="btn">Cancel</button><span class="spacer"></span><span style="color:var(--text-faint)">You can pause at any time</span></div>
  </div></div>`,
})));

/* --- B. recording: the split view --------------------------------------- */

const hiSubmit = `
  <div class="sel-box" style="left:60px;right:60px;top:316px;height:34px"></div>
  <div class="sel-tag" style="left:56px;top:296px">button · data-testid="request-refund"</div>`;

writeFileSync(join(here, 'qa-tests-record.html'), page('QA · recording: the app on one side, readable steps on the other', shell({
  procs: '2 running',
  left: testsTree('new'),
  mid: `<div class="canvas-tb"><span class="crumbs">refunds › tests › <b>Untitled recording</b></span>
     <span class="rec"><span class="bulb"></span>Recording 00:42</span><span class="spacer"></span>
     ${seg(['Record actions', 'Check this'], 'Record actions')}
     <button class="btn sm">Pause</button><button class="btn primary sm">Finish</button></div>
   <div class="split">
     <div class="appcol">${refundApp({ hi: hiSubmit })}</div>
     <div class="capcol">
       <div class="caph">Steps so far<span class="spacer"></span><span class="chip ok">3 bound by convention</span></div>
       <div class="capbody">
         ${capRow('GIVEN', 'Open <em>/refunds/new</em>', 'page.goto')}
         ${capRow('AND', 'Type <em>120</em> into “Amount”', '[data-testid="amount"]')}
         ${capRow('AND', 'Type <em>Item arrived damaged</em> into “Reason”', '[data-testid="reason"]')}
         ${capRow('WHEN', '“request refund” happens', 'REQUEST_REFUND · [data-testid="request-refund"]', 'now')}
       </div>
       <div class="capf"><button class="btn sm">Undo last</button><span class="spacer"></span>4 steps</div>
     </div>
   </div>
   <div class="canvas-foot"><span class="dot" style="color:var(--danger)"></span>Click in the browser window — steps appear beside it as you go<span class="spacer"></span>Esc pauses</div>`,
  right: `${recTabs('Recording', '4')}
   <div class="scroll">
    <div class="section"><h4>Mode</h4>
      <div class="picks col">
        <div class="pick on"><b><span class="radio"></span>Record actions</b><small>Clicking and typing become steps.</small></div>
        <div class="pick"><b><span class="radio"></span>Check this</b><small>Pick anything on the page and say what must be true about it.</small></div>
      </div></div>
    <div class="section"><h4>Just captured <span class="tag det">Deterministic</span></h4>
      <div class="prop"><span class="k">element</span><span class="field">button “Request refund”</span></div>
      <div class="prop"><span class="k">test id</span><span class="field mono">request-refund</span><span class="bind var">found</span></div>
      <div class="prop"><span class="k">event</span><span class="field mono">REQUEST_REFUND</span><span class="bind var">matched</span></div>
      <small style="color:var(--text-muted);display:block;margin-top:6px">The test id matches an event in <b>refundRequest</b>, so this is recorded as the flow event rather than “a click on a button”.</small>
    </div>
    <div class="section"><h4>How the steps are bound</h4>
      <div class="prop"><span class="k">matched</span><span class="field">3 · expected id</span><span class="bind var">ideal</span></div>
      <div class="prop"><span class="k">other id</span><span class="field">0 · different id</span><span class="bind lit">fine</span></div>
      <div class="prop"><span class="k">no id</span><span class="field">0 · none</span><span class="bind lit">—</span></div>
    </div>
    ${whatIsCaptured}
   </div>`,
  drawer: recProcs('Recording'),
  drawerH: 146,
  lw: 264,
  rw: 360,
})));

/* --- C. "check this" mode ----------------------------------------------- */

const hiBanner = `
  <div class="sel-box check-box" style="left:56px;right:56px;top:192px;height:34px"></div>
  <div class="sel-tag check-tag" style="left:52px;top:172px">text · “A reviewer will check this refund”</div>
  <div class="pop" style="left:52px;top:250px;width:330px">
    <div style="font-weight:600;margin-bottom:6px">What should be true here?</div>
    <div class="picks col" style="gap:6px">
      <div class="pick on" style="padding:7px 9px"><b><span class="radio"></span>This text is visible</b></div>
      <div class="pick" style="padding:7px 9px"><b><span class="radio"></span>This element exists</b></div>
      <div class="pick" style="padding:7px 9px"><b><span class="radio"></span>The page address is /refunds/42</b></div>
    </div>
    <div class="frow" style="margin:8px 0 6px"><label>Text</label><div class="ctl area" style="min-height:34px">A reviewer will check this refund</div></div>
    <div style="display:flex;gap:6px"><button class="btn primary sm">Add this check</button><button class="btn sm">Cancel</button></div>
  </div>`;

writeFileSync(join(here, 'qa-tests-record-check.html'), page('QA · “check this”: recording what must be TRUE, not only what you did', shell({
  procs: '2 running',
  left: testsTree('new'),
  mid: `<div class="canvas-tb"><span class="crumbs">refunds › tests › <b>Untitled recording</b></span>
     <span class="rec"><span class="bulb"></span>Recording 01:20</span><span class="spacer"></span>
     ${seg(['Record actions', 'Check this'], 'Check this')}
     <button class="btn sm">Pause</button><button class="btn primary sm">Finish</button></div>
   <div class="split">
     <div class="appcol">${refundApp({ hi: hiBanner, banner: true })}</div>
     <div class="capcol">
       <div class="caph">Steps so far<span class="spacer"></span><span class="chip">6 steps</span></div>
       <div class="capbody">
         ${capRow('AND', 'Type <em>120</em> into “Amount”', '[data-testid="amount"]')}
         ${capRow('WHEN', '“request refund” happens', 'REQUEST_REFUND')}
         ${capRow('THEN', 'the flow moves to <em>manual review</em>', '[data-flow-state="manualReview"]')}
         ${capRow('CHECK', 'the page shows “A reviewer will check this refund”', 'text is visible · being added', 'check-row')}
       </div>
       <div class="capf"><button class="btn sm">Undo last</button><span class="spacer"></span>1 check so far</div>
     </div>
   </div>
   <div class="canvas-foot"><span class="dot" style="color:var(--llm)"></span>Check mode — clicking picks something to assert instead of pressing it<span class="spacer"></span>Switch back to keep clicking</div>`,
  right: `${recTabs('Recording', '6')}
   <div class="callout info" style="align-items:flex-start"><span>i</span><div class="grow"><b>A recording knows what you did, not what you meant to prove</b><small>Without checks, a recorded test only repeats clicks and can pass while the page is broken. Pick the things a reviewer would look at.</small></div></div>
   <div class="scroll">
    <div class="section"><h4>Mode</h4>
      <div class="picks col">
        <div class="pick"><b><span class="radio"></span>Record actions</b><small>Clicking and typing become steps.</small></div>
        <div class="pick on"><b><span class="radio"></span>Check this</b><small>Clicking picks an element; you say what must be true about it.</small></div>
      </div></div>
    <div class="section"><h4>This check <span class="tag det">Deterministic</span></h4>
      <div class="frow"><label>What to check</label><div class="ctl sel-ctl">Text is visible</div></div>
      <div class="frow"><label>Text</label><div class="ctl area">A reviewer will check this refund</div></div>
      <div class="becomes">await expect(
  page.getByText('A reviewer will check this refund')
).toBeVisible();</div>
    </div>
    <div class="section"><h4>Checks so far</h4>
      <div style="color:var(--text-muted);line-height:1.7">1 check you picked, plus the flow-state checks Construct adds for you.</div></div>
   </div>`,
  drawer: recProcs('Recording'),
  drawerH: 146,
  lw: 264,
  rw: 360,
})));
console.log('record mocks A-C written');

/* --- D. selector reconciliation: the element has no test id -------------- */

const hiDraft = `
  <div class="sel-box warn-box" style="left:26px;right:26px;top:310px;height:30px"></div>
  <div class="sel-tag warn-tag" style="left:22px;top:290px">button “Save as draft” · no data-testid</div>`;

const recCapListD = `
  ${capRow('WHEN', '“request refund” happens', 'REQUEST_REFUND · [data-testid="request-refund"]')}
  ${capRow('AND', 'Click “Add a note”', '[data-testid="refund-note-toggle"] · not an event in the flow, recorded as a plain click')}
  ${capRow('AND', 'Click “Save as draft”', 'no test id — waiting for your decision', 'warn-row')}`;

writeFileSync(join(here, 'qa-tests-record-selector.html'), page('QA · the element has no test id: the choice is made out loud', shell({
  procs: '2 running',
  left: testsTree('new'),
  mid: `<div class="canvas-tb"><span class="crumbs">refunds › tests › <b>Untitled recording</b></span>
     <span class="rec"><span class="bulb"></span>Paused 02:05</span><span class="spacer"></span>
     ${seg(['Record actions', 'Check this'], 'Record actions')}
     <button class="btn sm">Resume</button><button class="btn primary sm">Finish</button></div>
   <div class="split">
     <div class="appcol">${refundApp({ hi: hiDraft })}</div>
     <div class="capcol">
       <div class="caph">Steps so far<span class="spacer"></span><span class="chip warn">1 needs a decision</span></div>
       <div class="capbody">${recCapListD}</div>
       <div class="capf"><button class="btn sm">Undo last</button><span class="spacer"></span>7 steps</div>
     </div>
   </div>
   <div class="canvas-foot"><span class="dot" style="color:var(--warn)"></span>Paused — nothing is recorded for this click until you choose<span class="spacer"></span>Recording resumes after</div>`,
  right: `${recTabs('Recording', '7')}
   <div class="scroll">
    <div class="section"><h4>How the steps are bound</h4>
      <div class="prop"><span class="k">matched</span><span class="field">5 · expected id</span><span class="bind var">ideal</span></div>
      <div class="prop"><span class="k">other id</span><span class="field">1 · different id</span><span class="bind lit">fine</span></div>
      <div class="prop"><span class="k">no id</span><span class="field">1 · no id</span><span class="bind var" style="background:var(--warn-soft);color:var(--warn)">now</span></div>
      <small style="color:var(--text-muted);display:block;margin-top:8px">Every step says how it finds its element. A recording never hides that.</small>
    </div>
    <div class="section"><h4>Why this happens</h4>
      <div style="color:var(--text-muted);line-height:1.7">Construct puts a <span class="mono">data-testid</span> on the elements it generates. Anything written by hand may not have one, and a test that guesses is a test that breaks next month.</div></div>
   </div>`,
  drawer: recProcs('Paused'),
  drawerH: 146,
  lw: 264,
  rw: 360,
  dim: true,
  overlay: `<div class="scrim" style="padding-top:96px"><div class="dialog" role="dialog" aria-label="This element has no test id" style="width:640px">
   <div class="head"><div><span class="chip warn">No test id</span>
     <h3 style="margin-top:8px">How should this step find “Save as draft”?</h3>
     <div style="color:var(--text-muted);margin-top:4px;line-height:1.55">Steps normally find their element by <span class="mono">data-testid</span>. This button, in <span class="mono">features/refunds/components/RefundForm.tsx</span>, was written by hand and has none.</div></div></div>
   <div class="cont">
    <div class="picks col">
      <div class="pick on"><b><span class="radio"></span>Give the button a test id <span class="chip ok" style="margin-left:6px">Recommended</span></b>
        <small><b>You approve the diff before anything is written</b> — the same review as any other change. It adds <span class="mono">data-testid="save-as-draft"</span> to one product file, and the step is stable for good.</small>
        <div class="becomes" style="margin-top:6px">- &lt;button className="ghost"&gt;Save as draft&lt;/button&gt;
+ &lt;button className="ghost" data-testid="save-as-draft"&gt;Save as draft&lt;/button&gt;</div></div>
      <div class="pick"><b><span class="radio"></span>Find it by what it looks like <span class="chip warn" style="margin-left:6px">Brittle</span></b>
        <small><b>Breaks the moment the wording or the role changes.</b> Uses <span class="mono">getByRole('button', { name: 'Save as draft' })</span>: it works today, and the step keeps a visible warning — as does every run that uses it — until someone gives the button a test id.</small></div>
      <div class="pick"><b><span class="radio"></span>Skip this click</b>
        <small>Nothing is recorded for it. Recording carries on from the next thing you do.</small></div>
    </div>
   </div>
   <div class="foot"><button class="btn primary">Use this and carry on</button><button class="btn">Ask me at the end instead</button><span class="spacer"></span><span style="color:var(--text-faint)">Whatever you pick is shown again before anything is written</span></div>
  </div></div>`,
})));

/* --- E. finishing: review before anything is written --------------------- */

const recordedDoc = `
<div class="doc">
  ${docHead('Save a draft, then request the refund',
    '<span class="chip mine">Yours · recorded</span><span class="chip warn">1 brittle step</span>',
    'features/refunds/tests/save-draft-then-request.spec.ts · captured 2 min ago · not written yet')}
  <div class="doc-body">
    ${step({ kw: 'GIVEN', txt: 'Open <em>/refunds/new</em>', bind: 'page.goto' })}
    ${step({ kw: 'AND', txt: 'Type <em>120</em> into “Amount”', bind: '[data-testid="amount"]' })}
    ${step({ kw: 'AND', txt: 'Type <em>Item arrived damaged</em> into “Reason”', bind: '[data-testid="reason"]' })}
    ${step({ kw: 'AND', txt: 'Click “Save as draft”', note: 'Needs a test id — you chose to add one to the button', bind: 'data-testid to add', cls: 'edited' })}
    ${step({ kw: 'AND', txt: 'Click “Add a note”', note: 'A different test id — recorded as a plain click, not a flow event', bind: '[data-testid="refund-note-toggle"]' })}
    ${step({ kw: 'WHEN', txt: '“request refund” happens', note: 'Matched the flow event REQUEST_REFUND', bind: '[data-testid="request-refund"]' })}
    ${step({ kw: 'THEN', txt: 'the flow moves to <em>manual review</em>', bind: '[data-flow-state="manualReview"]' })}
    ${step({ kw: 'CHECK', txt: 'the page shows “A reviewer will check this refund”', note: 'Added by you in check mode', bind: 'text is visible' })}
  </div>
  <div class="doc-f"><button class="btn sm">+ Add step</button><button class="btn sm">Record more</button><span class="spacer"></span><span>8 steps · edit any of them before writing</span></div>
</div>`;

writeFileSync(join(here, 'qa-tests-record-review.html'), page('QA · finishing a recording: two kinds of write, both reviewed', shell({
  procs: '1 running',
  left: testsTree('new'),
  mid: `${midTb('refunds › tests › <b>Save a draft, then request the refund</b>', seg(['Steps', 'Code'], 'Steps'), '<span class="chip">Finished</span><button class="btn primary sm">Review (2)</button>')}
   <div class="stage" style="padding:14px 20px;align-items:stretch">${recordedDoc}</div>
   <div class="canvas-foot"><span class="dot" style="color:var(--accent)"></span>Recorded steps are ordinary steps — reorder, edit or delete any of them<span class="spacer"></span>Nothing on disk has changed yet</div>`,
  right: `${tabs([['Step'], ['Test'], ['Code'], ['Changes', ['2', 'acc']], ['Runs']], 'Changes')}
   <div class="callout info" style="align-items:flex-start"><span>i</span><div class="grow"><b>Nothing is written yet</b><small>A recording produces two different kinds of change. They are approved separately.</small></div></div>
   <div class="scroll">
    <div class="section"><h4>1 · The test <span class="chip mine">yours to keep</span></h4>
      <div class="path">features/refunds/tests/save-draft-then-request.spec.ts</div>
      <div style="color:var(--text-muted);margin-top:6px">New file · 8 steps · 1 check</div>
      <div style="margin-top:8px"><button class="btn primary sm">Write the test</button></div></div>
    <div class="section"><h4>2 · Your app <span class="chip warn">changes product code</span></h4>
      <div class="path">features/refunds/components/RefundForm.tsx</div>
      <div class="becomes" style="margin-top:6px">- &lt;button className="ghost"&gt;Save as draft&lt;/button&gt;
+ &lt;button className="ghost" data-testid="save-as-draft"&gt;Save as draft&lt;/button&gt;</div>
      <small style="color:var(--text-muted);display:block;margin-top:6px">One attribute, no behaviour change. Refuse it and the step falls back to a brittle locator — the test still runs, and says so.</small>
      <div style="display:flex;gap:8px;margin-top:8px"><button class="btn sm">Approve this change</button><button class="btn sm">Open in Pages</button></div></div>
    <div class="section"><h4>Health of this recording</h4>
      <div class="prop"><span class="k">matched</span><span class="field">5 steps · expected test id</span><span class="bind var">ideal</span></div>
      <div class="prop"><span class="k">other id</span><span class="field">1 step · different test id</span><span class="bind lit">fine</span></div>
      <div class="prop"><span class="k">brittle</span><span class="field">0 · once you approve #2</span><span class="bind lit">none</span></div>
    </div>
    <div style="padding:12px;display:flex;gap:8px"><button class="btn primary">Apply both</button><button class="btn">Discard recording</button></div>
   </div>`,
  drawer: `${drawerBar('Processes', ['0', '', '1'])}<div class="body"><table>
    <tr><th>Process</th><th>Kind</th><th>Status</th><th>Detail</th><th></th></tr>
    <tr><td>recorder · chromium</td><td><span class="tag det">Deterministic</span></td><td><span style="color:var(--success)">✓ Finished</span></td><td>8 steps captured · 2 min 11 s</td><td><button class="btn sm">Record more</button></td></tr>
    <tr><td>preview · storefront</td><td><span class="tag det">Deterministic</span></td><td><span class="pill run" style="height:20px"><span class="spin"></span>Running</span></td><td>localhost:5173 · up 44 min</td><td><button class="btn sm">Stop</button></td></tr></table></div>`,
  drawerH: 146,
  lw: 264,
  rw: 400,
})));
console.log('record mocks D-E written');
