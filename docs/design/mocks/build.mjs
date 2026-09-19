// Generates the static concept-mock HTML pages (shared shell so every mock stays consistent).
// Usage: node docs/design/mocks/build.mjs   (output is committed; the HTML is what reviewers open)
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { page, tabs, drawerBar, tree, shell, stateCard } from './parts.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const loginPreview = (selected = true) => `
<div class="device" style="height:500px">
  <div class="bar"><i></i><i></i><i></i>&nbsp;&nbsp;localhost:5173/login</div>
  <div class="app-nav"><b>Storefront</b><span>Catalog</span><span>Cart (2)</span><span>Sign in</span></div>
  <div class="login" id="lf">
    <h2>Welcome back</h2><p>Sign in to continue checkout.</p>
    <label>Email</label><div class="in">sam@example.com</div>
    <label>Password</label><div class="in">••••••••••</div>
    <div class="cta">Sign in</div>
  </div>
  ${selected ? `<div class="sel-box" style="left:calc(50% - 170px - 4px);top:98px;width:348px;height:322px"></div><div class="sel-tag" style="left:calc(50% - 174px);top:78px">LoginForm · components/LoginForm.tsx:14</div>` : ''}
</div>`;

const canvasTb = (crumb, extra = '') => `
<div class="canvas-tb">
  <span class="crumbs">auth › pages › <b>${crumb}</b></span><span class="spacer"></span>${extra}
  <div class="seg"><button class="on">Desktop</button><button>Tablet</button><button>Phone</button></div>
  <button class="btn sm" aria-pressed="true">⊕ Pick element</button>
  <button class="icon-btn" aria-label="Reload">↻</button><span class="mono" style="color:var(--text-muted)">100%</span>
</div>`;

const diagnosticsBody = `
<div class="body"><table><tr><th>Rule</th><th>Message</th><th>File</th></tr>
<tr><td><span class="tag" style="background:var(--danger-soft);color:var(--danger)">error</span> PAGE-006</td><td>Page imports a hook; go through a controller</td><td class="mono">features/auth/pages/LoginPage.tsx:3</td></tr>
<tr><td><span class="tag" style="background:var(--warn-soft);color:var(--warn)">warn</span> COMP-002</td><td>Component reads a service directly</td><td class="mono">features/cart/components/CartLine.tsx:9</td></tr></table></div>`;

// 1 — default shell
const inspector = `
${tabs([['Inspector'], ['Scope'], ['Source'], ['Diff', ['1']], ['Flow']], 'Inspector')}
<div class="scroll">
  <div class="section"><div class="el-head"><span class="layer component">component</span><span class="name">LoginForm</span><span class="spacer"></span><button class="btn sm">Open source</button></div>
  <div class="path" style="margin-top:4px">features/auth/components/LoginForm.tsx:14</div></div>
  <div class="section"><h4>Props <button class="btn sm">+ Add prop</button></h4>
    <div class="prop"><span class="k">email</span><span class="field">email</span><span class="bind var">variable</span></div>
    <div class="prop"><span class="k">onSubmit</span><span class="field">handleLogin</span><span class="bind var">variable</span></div>
    <div class="prop"><span class="k">submitLabel</span><span class="field">"Sign in"</span><span class="bind lit">literal</span></div>
    <div class="prop"><span class="k">disabled</span><span class="field">isPending</span><span class="bind var">variable</span></div>
  </div>
  <div class="section"><h4>Belongs to</h4>
    <div class="row muted" style="padding:0">page · LoginPage &nbsp;→&nbsp; controller · authController</div></div>
  <div class="section"><h4>Where it is used</h4><div class="row muted" style="padding:0">LoginPage.tsx:22 · RegisterPage.tsx:31</div></div>
</div>`;
writeFileSync(join(here, 'cockpit-shell.html'), page('Cockpit shell — Explore mode', shell({
  left: tree('features'),
  mid: `${canvasTb('login')}<div class="stage">${loginPreview()}</div><div class="canvas-foot"><span class="dot" style="color:var(--success)"></span>Live · HMR connected<span class="spacer"></span>Alt+Click any element to jump to source</div>`,
  right: inspector,
  drawer: `${drawerBar('Diagnostics')}${diagnosticsBody}`,
})));

// 2 — pages editor in shell (Source tab + external change diff)
const codeLines = [
  ['12', '<span class="k1">export function</span> <span class="k2">LoginForm</span>({ email, onSubmit, disabled }: Props) {'],
  ['13', '  <span class="k1">return</span> ('],
  ['14', '    &lt;<span class="k2">form</span> onSubmit={onSubmit}&gt;', 'hl'],
  ['15', '      &lt;<span class="k2">EmailField</span> value={email} /&gt;'],
  ['16', '      &lt;<span class="k2">PasswordField</span> label=<span class="k3">"Password"</span> /&gt;', 'del'],
  ['16', '      &lt;<span class="k2">PasswordField</span> label=<span class="k3">"Password"</span> showToggle /&gt;', 'add'],
  ['17', '      &lt;<span class="k2">button</span> disabled={disabled}&gt;Sign in&lt;/<span class="k2">button</span>&gt;'],
  ['18', '    &lt;/<span class="k2">form</span>&gt;'],
  ['19', '  );'],
];
const codeHtml = `<div class="code">${codeLines.map(([n, t, c]) => `<div class="ln ${c || ''}"><i>${n}</i><span>${t}</span></div>`).join('')}</div>`;
writeFileSync(join(here, 'pages-editor-in-shell.html'), page('Pages editor inside the shell — Source, Diff and Scope', shell({
  mode: 'Explore',
  left: tree('pages'),
  mid: `${canvasTb('login', '<span class="pill" style="color:var(--warn)">● Changed on disk</span>')}<div class="stage">${loginPreview()}</div><div class="canvas-foot"><span class="dot" style="color:var(--warn)"></span>Preview reloaded after external edit (2s ago)<span class="spacer"></span>Selection follows the source cursor</div>`,
  right: `${tabs([['Inspector'], ['Scope'], ['Source'], ['Diff', ['1']], ['Flow']], 'Diff')}
  <div class="callout warn"><span>⚠</span><div class="grow"><b>LoginForm.tsx changed on disk</b><small>By another process, 12 s ago. Your unsaved edits: none.</small></div></div>
  <div style="padding:0 12px 8px;display:flex;gap:8px"><button class="btn primary sm">Accept change</button><button class="btn sm">Keep mine</button><span class="spacer"></span><button class="btn sm">Open in Source</button></div>
  <div class="scroll" style="border-top:1px solid var(--border-subtle)">${codeHtml}
  <div class="section" style="border-top:1px solid var(--border-subtle)"><h4>Scope links touched</h4>
   <div class="link">email → EmailField.value</div><div class="link">disabled → button.disabled</div></div></div>`,
  drawer: `${drawerBar('Logs')}<div class="body" style="padding-top:6px">
  <div class="logline"><time>14:02:11</time><span class="lv-ok">ok</span>watch: features/auth/components/LoginForm.tsx changed</div>
  <div class="logline"><time>14:02:11</time><span>preview: hot update applied in 84 ms</span></div>
  <div class="logline"><time>14:02:12</time><span class="lv-ok">ok</span>validate: 0 new violations</div></div>`,
  drawerH: 116,
})));

// 3 — workflows in shell
const svgMachine = (dark) => `
<svg viewBox="0 0 700 380" width="700" height="380" role="img" aria-label="cartMachine state diagram">
  <defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--text-muted)"/></marker></defs>
  ${[['idle', 40, 150, 0], ['loading', 230, 150, 0], ['ready', 420, 150, 1], ['checkingOut', 420, 290, 0], ['failed', 230, 290, 0]].map(([n, x, y, sel]) => `<g><rect x="${x}" y="${y}" width="150" height="56" rx="10" fill="var(--surface-2)" stroke="${sel ? 'var(--accent)' : 'var(--border-strong)'}" stroke-width="${sel ? 2.5 : 1.5}"/><text x="${x + 75}" y="${y + 33}" text-anchor="middle" fill="var(--text)" font-family="var(--mono)" font-size="13">${n}</text></g>`).join('')}
  <g stroke="var(--text-muted)" stroke-width="1.5" fill="none" marker-end="url(#a)">
    <path d="M190 178H228"/><path d="M380 178H418"/><path d="M495 206V288"/><path d="M420 318H382"/><path d="M305 206V288" /></g>
  <g fill="var(--text-muted)" font-size="11" font-family="var(--mono)"><text x="192" y="142">FETCH</text><text x="384" y="142">LOADED</text><text x="502" y="252">CHECKOUT</text><text x="384" y="346">ERROR</text><text x="312" y="252">ERROR</text></g>
  <rect x="20" y="20" width="14" height="14" rx="7" fill="var(--accent)"/><path d="M34 27H40V150" stroke="var(--accent)" fill="none" stroke-width="1.5"/>
</svg>`;
writeFileSync(join(here, 'workflows-in-shell.html'), page('Workflows inside the shell — machine canvas, context and actions', shell({
  mode: 'Explore',
  left: tree('workflows'),
  mid: `<div class="canvas-tb"><span class="crumbs">cart › workflows › <b>cartMachine</b></span><span class="spacer"></span><div class="seg"><button class="on">Diagram</button><button>Narrative</button></div><button class="btn sm">Edit transitions</button></div>
   <div class="stage" style="background-image:radial-gradient(var(--border-subtle) 1px,transparent 1px);background-size:20px 20px">${svgMachine()}</div>
   <div class="canvas-foot">5 states · 5 events · ready is selected<span class="spacer"></span>Drag from a handle to rewire an event</div>`,
  right: `${tabs([['Inspector'], ['Scope'], ['Source'], ['Diff'], ['Flow']], 'Flow')}
  <div class="scroll">
   <div class="section"><div class="el-head"><span class="layer workflow">state</span><span class="name">ready</span></div><div class="path" style="margin-top:4px">features/cart/workflows/cartMachine.ts:31</div></div>
   <div class="section"><h4>What happens here</h4><div style="color:var(--text-muted)">The cart has loaded. The shopper can change quantities, or start checkout.</div></div>
   <div class="section"><h4>Context</h4>
    <div class="prop"><span class="k">items</span><span class="field">CartItem[]</span><span class="bind lit">array</span></div>
    <div class="prop"><span class="k">total</span><span class="field">number</span><span class="bind lit">derived</span></div></div>
   <div class="section"><h4>Actions</h4>
    <div class="prop"><span class="k">entry</span><span class="field">recalculateTotal</span><span class="bind var">action</span></div>
    <div class="prop"><span class="k">on CHECKOUT</span><span class="field">→ checkingOut</span><span class="bind var">guard: hasItems</span></div></div>
  </div>`,
  drawer: `${drawerBar('Diagnostics', ['0', '', '0'])}<div class="body"><div style="padding:14px 12px;color:var(--text-muted)">No diagnostics for this workflow.</div></div>`,
  drawerH: 96,
  rw: 380,
})));

// 4 — research mode
writeFileSync(join(here, 'research-mode.html'), page('Research mode — request, impact, plan', shell({
  mode: 'Research',
  procs: '1 running',
  left: `<div class="pane-h"><span class="title">Request</span></div>
  <div class="scroll"><div class="section"><h4>Ticket</h4>
   <div style="font-weight:600;margin-bottom:6px">Add "show password" toggle to the login form</div>
   <div style="color:var(--text-muted)">Shoppers mistype passwords on mobile. Add a visibility toggle to PasswordField, and keep the field accessible to screen readers.</div></div>
  <div class="section"><h4>Constraints</h4>
   <div class="row" style="padding:0">✓ &nbsp;architecture.yml layers respected</div>
   <div class="row" style="padding:0">✓ &nbsp;No new dependencies</div>
   <div class="row" style="padding:0">✓ &nbsp;Existing tests stay green</div></div>
  <div class="section"><h4>Source</h4><div class="path">github.com/acme/storefront#142</div></div>
  <div style="padding:12px"><button class="btn primary">Analyse impact</button></div></div>`,
  mid: `<div class="canvas-tb"><span class="crumbs">Impact · <b>2 features · 5 files</b></span><span class="spacer"></span><span class="pill ok"><span class="dot"></span>Analysis complete in 1.8 s · deterministic</span></div>
  <div class="scroll" style="padding:14px 16px;background:var(--canvas)">
   <table style="background:var(--surface-1);border:1px solid var(--border-subtle);border-radius:8px">
    <tr><th>File</th><th>Layer</th><th>Feature</th><th>Why</th></tr>
    <tr><td class="mono">components/PasswordField.tsx</td><td><span class="layer component">component</span></td><td>auth</td><td>Renders the input to change</td></tr>
    <tr><td class="mono">components/LoginForm.tsx</td><td><span class="layer component">component</span></td><td>auth</td><td>Uses PasswordField</td></tr>
    <tr><td class="mono">components/RegisterForm.tsx</td><td><span class="layer component">component</span></td><td>auth</td><td>Uses PasswordField</td></tr>
    <tr><td class="mono">components/CheckoutGuestForm.tsx</td><td><span class="layer component">component</span></td><td>checkout</td><td>Uses PasswordField</td></tr>
    <tr><td class="mono">e2e/login.spec.js</td><td><span class="layer">test</span></td><td>auth</td><td>Covers the login form</td></tr></table>
   <div class="callout info" style="margin:14px 0 0"><span>ℹ</span><div class="grow"><b>PasswordField is shared by 3 forms</b><small>Changing its default affects Register and Guest checkout. The plan keeps the toggle opt-in via a <span class="mono">showToggle</span> prop.</small></div></div>
  </div>`,
  right: `${tabs([['Plan', ['6', 'acc']], ['Impact'], ['Cost']], 'Plan')}
  <div class="scroll"><div style="padding:6px 0">
   ${[['1', 'Add showToggle prop to PasswordField', 'det', '4 s'], ['2', 'Bind prop at LoginForm usage', 'det', '2 s'], ['3', 'Write toggle behaviour (scoped snippet)', 'llm', '~40 s'], ['4', 'Add test to login.spec.js', 'llm', '~30 s'], ['5', 'Run construct validate', 'det', '3 s'], ['6', 'Review diff before merge', 'human', '']].map(([n, t, k, d]) => `<div class="section" style="display:flex;gap:10px;align-items:center"><span class="badge acc">${n}</span><div style="flex:1">${t}</div><span class="tag ${k}">${k === 'det' ? 'Deterministic' : k === 'llm' ? 'Local model' : 'You'}</span><span style="color:var(--text-faint);width:44px;text-align:right;white-space:nowrap">${d}</span></div>`).join('')}
  </div>
  <div style="padding:12px;display:flex;gap:8px"><button class="btn primary">Run plan in Build mode</button><button class="btn">Edit plan</button></div></div>`,
  drawer: `${drawerBar('Processes', ['0', '', '1'])}<div class="body"><table><tr><th>Process</th><th>Status</th><th>Progress</th><th></th></tr>
   <tr><td>research · issue #142</td><td><span class="pill run" style="height:20px"><span class="spin"></span>Analysing</span></td><td><div class="bar-track"><div class="bar-fill" style="width:100%"></div></div></td><td></td></tr></table></div>`,
  drawerH: 116, lw: 300, rw: 440,
})));

// 5 — processes drawer
const steps = [['Add showToggle prop to PasswordField', 'Done', 100, 'det'], ['Bind prop at LoginForm usage', 'Done', 100, 'det'], ['Write toggle behaviour (scoped snippet)', 'Running', 62, 'llm'], ['Add test to login.spec.js', 'Queued', 0, 'llm'], ['Run construct validate', 'Queued', 0, 'det']];
writeFileSync(join(here, 'processes-drawer.html'), page('Processes drawer — running plan in Build mode', shell({
  mode: 'Build',
  procs: '2 running',
  left: tree('features'),
  mid: `${canvasTb('login', '<span class="pill run"><span class="spin"></span>Plan running</span>')}<div class="stage">${loginPreview(false)}</div><div class="canvas-foot">Live · HMR connected</div>`,
  right: `${tabs([['Inspector'], ['Scope'], ['Source'], ['Diff', ['2']], ['Flow']], 'Diff')}
  <div class="scroll"><div class="callout info"><span>ℹ</span><div class="grow"><b>2 files changed by the running plan</b><small>Review each change; nothing is committed until you approve.</small></div></div>${codeHtml}</div>`,
  drawer: `${drawerBar('Processes', ['0', '', '2'])}
  <div class="body" style="display:grid;grid-template-columns:1fr 520px">
  <table><tr><th>Step · plan “show password toggle”</th><th>Kind</th><th>Status</th><th>Progress</th><th></th></tr>
  ${steps.map(([t, s, p, k]) => `<tr><td>${t}</td><td><span class="tag ${k}">${k === 'det' ? 'Deterministic' : 'Local model'}</span></td><td>${s === 'Running' ? '<span class="pill run" style="height:20px"><span class="spin"></span>Running</span>' : s === 'Done' ? '<span style="color:var(--success)">✓ Done</span>' : '<span style="color:var(--text-faint)">Queued</span>'}</td><td><div class="bar-track"><div class="bar-fill" style="width:${p}%;${s === 'Done' ? 'background:var(--success)' : ''}"></div></div></td><td>${s === 'Running' ? '<button class="btn sm">Pause</button> <button class="btn sm danger">Cancel</button>' : ''}</td></tr>`).join('')}</table>
  <div style="border-left:1px solid var(--border-subtle);padding-top:6px;overflow:hidden">
   <div class="logline"><time>14:05:02</time><span class="lv-ok">ok</span>step 2 done · 1 file changed</div>
   <div class="logline"><time>14:05:03</time><span class="lv-llm">llm</span>qwen2.5-coder:7b · scoped to PasswordField.tsx:8-31</div>
   <div class="logline"><time>14:05:19</time><span class="lv-llm">llm</span>received 412 tokens · 3 s/…</div>
   <div class="logline"><time>14:05:20</time><span>guard: snippet only touches allowed range ✓</span></div>
   <div class="logline"><time>14:05:21</time><span class="lv-warn">warn</span>waiting for your approval of step 3 diff</div></div></div>`,
  drawerH: 290,
})));

// 6 — command palette
writeFileSync(join(here, 'command-palette.html'), page('Command palette (Ctrl K)', shell({
  left: tree('features'),
  mid: `${canvasTb('login')}<div class="stage">${loginPreview(false)}</div>`,
  right: inspector,
  drawer: `${drawerBar('Diagnostics')}${diagnosticsBody}`,
  dim: true,
  overlay: `<div class="scrim"><div class="palette" role="dialog" aria-label="Command palette">
   <div class="q">⌕ <span>pass</span><span class="caret"></span></div>
   <div class="grp">Files and components</div>
   <div class="item on"><span class="layer component">component</span>PasswordField<span class="r mono">auth/components</span></div>
   <div class="item"><span class="layer">service</span>passwordPolicyApi<span class="r mono">auth/services</span></div>
   <div class="grp">Commands</div>
   <div class="item">Research this ticket…<span class="r"><kbd>Ctrl</kbd> <kbd>R</kbd></span></div>
   <div class="item">Switch to Build mode<span class="r"><kbd>Ctrl</kbd> <kbd>3</kbd></span></div>
   <div class="item">Toggle drawer: Processes<span class="r"><kbd>Ctrl</kbd> <kbd>J</kbd></span></div>
   <div class="foot"><span><kbd>↑</kbd> <kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span><span class="spacer"></span><span>Every command runs a Construct block — same as the CLI</span></div>
  </div></div>`,
})));

// 7 — states + narrow
writeFileSync(join(here, 'states-and-narrow.html'), page('Empty, loading, error states and narrow-screen behaviour', `
<div class="sheet">
 <div class="two"><h3>Empty — no project</h3>${stateCard('▣', 'Open a project to start', 'Pick a folder that contains an architecture.yml, or create a new project.', '<button class="btn primary">Open project…</button>')}
  <h3>Empty — nothing selected</h3>${stateCard('⊕', 'Select something to inspect', 'Alt+Click an element in the preview, or choose a file in the Browser.')}</div>
 <div class="two"><h3>Loading — preview starting</h3><div class="state-card"><span class="pill run"><span class="spin"></span>Starting preview server…</span><div class="skel"></div><div class="skel" style="width:60%"></div><p>Usually 3–5 s. The Browser and Source stay usable meanwhile.</p></div>
  <h3>Loading — analysing</h3><div class="state-card"><span class="pill run"><span class="spin"></span>Scanning 41 files</span><div class="bar-track" style="width:200px"><div class="bar-fill" style="width:58%"></div></div><p>Deterministic — no model involved.</p></div></div>
 <div class="two"><h3>Error — preview failed</h3><div class="state-card" style="border-color:var(--danger)"><div class="ico" style="color:var(--danger);background:var(--danger-soft)">!</div><h5>Preview could not start</h5><p>Port 5173 is already in use by another process.</p><div><button class="btn primary sm">Use port 5174</button> <button class="btn sm">Show logs</button></div></div>
  <h3>Error — model offline</h3><div class="state-card" style="border-color:var(--warn)"><div class="ico" style="color:var(--warn);background:var(--warn-soft)">◌</div><h5>Local model is offline</h5><p>Deterministic steps still work. Model steps are paused.</p><button class="btn sm">Open Settings</button></div></div>
 <div><h3>Narrow (phone, 390 px) — one pane at a time</h3><div class="narrow">
  <div class="topbar" style="height:44px;flex:none"><div class="brand"><i></i>Construct</div><span class="spacer"></span><span class="pill run"><span class="spin"></span>2</span><button class="icon-btn" aria-label="Menu">≡</button></div>
  <div class="canvas-tb"><span class="crumbs">auth › <b>login</b></span><span class="spacer"></span><button class="btn sm">⊕ Pick</button></div>
  <div class="stage" style="padding:10px;flex:1"><div class="device" style="width:100%;height:100%;max-height:none"><div class="bar"><i></i><i></i><i></i></div><div class="login" style="width:88%;margin:22px auto;padding:16px"><h2>Welcome back</h2><label>Email</label><div class="in">sam@example.com</div><div class="cta">Sign in</div></div></div></div>
  <div class="tabbar" role="tablist"><div>Browser</div><div class="on">Preview</div><div>Tools</div><div>Processes</div></div></div></div>
</div>`));
console.log('mocks written');
