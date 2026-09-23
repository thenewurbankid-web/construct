// #536 — Pages editor Browser pane: merge PagesBrowser + TreePanel into one grouped,
// collapsible panel. Usage: node docs/design/mocks/build-browser-merge.mjs
// Grounded in a real screenshot of the live Cockpit (see docs/design/browser-panel-merge.md)
// against a real fixture project (feature "billing", page HomePage.tsx importing Counter).
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { page, shell, tabs } from './parts.mjs';

const here = dirname(fileURLToPath(import.meta.url));

// Extra stylesheet link injected right after mock.css's — `page()` only wires up mock.css, so build
// the head manually via a small wrapper instead of changing the shared helper for one initiative.
const withCss = (html) => html.replace('<link rel="stylesheet" href="mock.css">', '<link rel="stylesheet" href="mock.css">\n<link rel="stylesheet" href="browser-merge.css">');

const paneHead = () => `<div class="pane-h"><span class="title">Pages</span></div>`;
const flowSwitch = () => `<div class="flow-switch" role="radiogroup" aria-label="Browser view"><button type="button" class="on" role="radio" aria-checked="true">Files</button><button type="button" role="radio" aria-checked="false">Flow</button></div>`;

const treeMarkup = (selected = 'Counter') => `
<ul class="tree-root">
  <li><div class="tree-node${selected === 'main' ? ' selected' : ''}"><span class="tree-node-tag">&lt;main&gt;</span></div>
    <ul>
      <li><div class="tree-node${selected === 'h1' ? ' selected' : ''}"><span class="tree-node-tag">&lt;h1&gt;</span></div></li>
      <li><div class="tree-node component${selected === 'Counter' ? ' selected' : ''}"><span class="tree-node-tag">&lt;Counter&gt;</span><span class="tree-node-props">2 props</span></div></li>
    </ul>
  </li>
</ul>`;

const featureField = (value = 'billing') => `
<label class="field"><span>Feature</span>
  <select>${value ? `<option>${value}</option>` : `<option>— select a feature —</option>`}</select>
</label>`;

const fileList = () => `
<div>
  <h4>pages/ in "billing"</h4>
  <ul class="pages-file-list"><li class="active"><button type="button">HomePage.tsx</button></li></ul>
</div>`;

const allPagesList = (state = 'ready') => {
  if (state === 'error') return `<div class="pbm-callout"><b>⚠</b><span>Could not load the pages — network error</span><button type="button" class="btn sm">Retry</button></div>`;
  return `
<div class="lb" data-testid="pages-list">
  <input class="lb-filter" placeholder="Filter pages" aria-label="Filter pages" />
  <p class="lb-count" role="status">3</p>
  <ul class="lb-list" role="listbox" aria-label="Pages">
    <li class="lb-row" role="option"><span class="lb-label">HomePage.tsx · billing</span></li>
  </ul>
</div>`;
};

/* ================= 1. Before: today's real screen — two separate floating cards ================= */
const beforeLeft = `${paneHead()}
<div class="pe-browser">
  ${flowSwitch()}
  <div class="pages-browser pbm-glass">
    ${featureField()}
    ${fileList()}
  </div>
  <button type="button" class="pe-all-pages" data-testid="pages-all">All pages</button>
  <div class="tree-panel pbm-glass">
    <h4>JSX tree</h4>
    ${treeMarkup()}
  </div>
</div>`;

/* ================= 2. After: one grouped card, two open <details> sections ================= */
const afterGroup = (opts = {}) => {
  const { firstOpen = true, secondOpen = true, secondLabel = 'JSX tree', secondBody = treeMarkup(), showAllPages = true, fileSection = `${featureField()}${fileList()}` } = opts;
  return `
<div class="pbm-group pbm-glass">
  <details class="pages-browser" ${firstOpen ? 'open' : ''}>
    <summary>Files <span class="pbm-count">1</span></summary>
    ${fileSection}
    ${showAllPages ? `<button type="button" class="pe-all-pages" data-testid="pages-all">All pages</button>` : ''}
  </details>
  <details class="tree-panel" ${secondOpen ? 'open' : ''}>
    <summary>${secondLabel}</summary>
    ${secondBody}
  </details>
</div>`;
};

const afterLeft = `${paneHead()}
<div class="pe-browser">
  ${flowSwitch()}
  ${afterGroup()}
</div>`;

const collapsedLeft = `${paneHead()}
<div class="pe-browser">
  ${flowSwitch()}
  ${afterGroup({ firstOpen: false, secondOpen: true })}
</div>`;

const noFeatureLeft = `${paneHead()}
<div class="pe-browser">
  ${flowSwitch()}
  ${afterGroup({ fileSection: featureField(''), showAllPages: false, secondLabel: 'All pages <span class="pbm-count">3</span>', secondBody: allPagesList() })}
</div>`;

writeFileSync(join(here, 'browser-merge-before.html'), withCss(page('Pages editor Browser pane — today: two separate floating panels (#536)', shell({
  mode: 'Explore', lw: 300,
  left: beforeLeft,
  mid: `<div class="canvas-tb"><span class="crumbs">billing › pages › <b>HomePage</b></span></div><div class="stage"><div class="device" style="height:220px;width:420px"><div class="bar"><i></i><i></i><i></i>&nbsp;&nbsp;preview</div></div></div><div class="canvas-foot">Selection: &lt;Counter&gt;</div>`,
  right: `${tabs([['Inspector'], ['Scope'], ['Source'], ['Palette'], ['Diff']], 'Inspector')}<div class="scroll"><div class="section"><h4>Props</h4><div class="prop"><span class="k">count</span><span class="field">count</span><span class="bind var">variable</span></div><div class="prop"><span class="k">label</span><span class="field">"Counter"</span><span class="bind lit">literal</span></div></div></div>`,
  drawer: '',
}))));

writeFileSync(join(here, 'browser-merge-after.html'), withCss(page('Pages editor Browser pane — merged, two independently collapsible sections (#536)', shell({
  mode: 'Explore', lw: 300,
  left: afterLeft,
  mid: `<div class="canvas-tb"><span class="crumbs">billing › pages › <b>HomePage</b></span></div><div class="stage"><div class="device" style="height:220px;width:420px"><div class="bar"><i></i><i></i><i></i>&nbsp;&nbsp;preview</div></div></div><div class="canvas-foot">Selection: &lt;Counter&gt;</div>`,
  right: `${tabs([['Inspector'], ['Scope'], ['Source'], ['Palette'], ['Diff']], 'Inspector')}<div class="scroll"><div class="section"><h4>Props</h4><div class="prop"><span class="k">count</span><span class="field">count</span><span class="bind var">variable</span></div><div class="prop"><span class="k">label</span><span class="field">"Counter"</span><span class="bind lit">literal</span></div></div></div>`,
  drawer: '',
}))));

/* ================= 3. States: collapsed, no-feature, empty-no-page, error, keyboard focus, narrow ================= */
const miniPane = (inner, width = 264) => `<div class="pbm-mini" style="width:${width}px"><div class="pe-browser" style="padding:6px">${inner}</div></div>`;

const emptyNoPageGroup = afterGroup({ secondBody: `<p class="pbm-empty">Open a page above to see its structure.</p>` });
const errorGroup = afterGroup({ fileSection: featureField(''), showAllPages: false, secondLabel: 'All pages', secondBody: allPagesList('error') });
const focusGroup = `
<div class="pbm-group pbm-glass">
  <details class="pages-browser" open><summary style="outline:2px solid var(--focus);outline-offset:2px;border-radius:4px">Files <span class="pbm-count">1</span></summary>${featureField()}${fileList()}</details>
  <details class="tree-panel" open><summary>JSX tree</summary>${treeMarkup()}</details>
</div>`;

const statesBody = `
<div class="pbm-sheet">
  <h3>Independent collapse</h3>
  <div class="pbm-card"><b>Files collapsed, JSX tree open</b><p>Each section is its own native &lt;details&gt;/&lt;summary&gt; — collapsing one never affects the other. The Feature select is still reachable: expand "Files" first.</p>${miniPane(flowSwitch() + afterGroup({ firstOpen: false, secondOpen: true }))}</div>
  <div class="pbm-card"><b>Both collapsed</b><p>Scrolling the Browser pane costs nothing once both are closed — useful once a project has many features/pages and a deep tree.</p>${miniPane(flowSwitch() + afterGroup({ firstOpen: false, secondOpen: false }))}</div>
  <div class="pbm-card"><b>Keyboard focus</b><p>Native &lt;summary&gt; is a real tab stop; Enter/Space toggles. Focus ring is the shared --focus token, 2px, matching every other control.</p>${miniPane(flowSwitch() + focusGroup)}</div>

  <h3>Content states (second section)</h3>
  <div class="pbm-card"><b>No feature selected</b><p>Second section relabels to "All pages" and shows the existing all-projects ListBrowser (filter + list) instead of a JSX tree — there is nothing to show a tree of yet.</p>${miniPane(flowSwitch() + afterGroup({ fileSection: featureField(''), showAllPages: false, secondLabel: 'All pages <span class="pbm-count">3</span>', secondBody: allPagesList() }))}</div>
  <div class="pbm-card"><b>Feature picked, no page open yet</b><p>Previously this second panel simply didn't render (roots was null). Now that both sections are a named, persistent pair, it gets a real empty state instead of vanishing.</p>${miniPane(flowSwitch() + emptyNoPageGroup)}</div>
  <div class="pbm-card"><b>Error: all-pages list failed to load</b><p>Reuses ListBrowser's existing ErrorState (status/error/onRetry) — unchanged behaviour, just inside the "All pages" section now.</p>${miniPane(flowSwitch() + errorGroup)}</div>
</div>`;

writeFileSync(join(here, 'browser-merge-states.html'), withCss(page('Browser pane merge: collapse, content and error states (#536)', statesBody)));

/* narrow (390px), same merged group, phone frame — no special narrow-only behaviour needed since the
 * two sections just stack and scroll like any other content at any pane width */
const narrowBody = `
<div style="padding:24px;display:flex;gap:24px;align-items:flex-start">
  <div>
    <h3 style="margin:0 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.07em;color:var(--text-muted)">Narrow (390px) — Browser pane full width, both sections open</h3>
    <div class="narrow" style="height:520px">
      <div class="pe-browser" style="padding:10px">${flowSwitch()}${afterGroup()}</div>
    </div>
  </div>
</div>`;
writeFileSync(join(here, 'browser-merge-narrow.html'), withCss(page('Browser pane merge: narrow screen (#536)', narrowBody)));

console.log('built browser-merge-{before,after,states,narrow}.html');
