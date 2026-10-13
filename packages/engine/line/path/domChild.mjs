// #921 path-first proof: the DOM render child. Renders one React unit (bundled by the parent with esbuild) into jsdom
// and walks each render example's steps with @testing-library/dom queries (roles, labels, names; no browser, no test
// ids). Prints one JSON line: per example {id, ok} or the first failing step with what was expected and what was found.
//   node domChild.mjs <request.json>   request: {bundle, export, examples}
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { computeAccessibleName, getRole } from 'dom-accessibility-api';

const req = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
for (const k of Object.getOwnPropertyNames(dom.window)) {
  if (k in globalThis) continue;
  try { globalThis[k] = dom.window[k]; } catch { /* read-only */ }
}
for (const k of ['window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'HTMLElement', 'Node', 'Event', 'MutationObserver', 'getComputedStyle']) {
  try { Object.defineProperty(globalThis, k, { value: k === 'window' ? dom.window : dom.window[k], configurable: true, writable: true }); } catch { /* keep */ }
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const errors = [];
const origError = console.error;
console.error = (...a) => { errors.push(a.map(String).join(' ').slice(0, 300)); };
const tl = await import('@testing-library/dom');
const { M, React, ReactDOMClient, TestUtils } = await import(pathToFileURL(req.bundle).href);
const act = React.act ?? TestUtils.act;
console.error = origError;

const Unit = M[req.export];
const results = [];
const exact = (s) => new RegExp(`^\\s*${String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');
const nameOf = (el) => computeAccessibleName(el);
const names = (c, role) => tl.queryAllByRole(c, role).map((el) => nameOf(el)).slice(0, 15);

function props(spec, spies) {
  if (Array.isArray(spec)) return spec.map((x) => props(x, spies));
  if (spec && typeof spec === 'object') {
    if (typeof spec.$spy === 'string') { const calls = (spies[spec.$spy] = []); return (...a) => { calls.push(JSON.parse(JSON.stringify(a))); }; }
    return Object.fromEntries(Object.entries(spec).map(([k, v]) => [k, props(v, spies)]));
  }
  return spec;
}

function labelled(c, label) {
  const byLabel = tl.queryAllByLabelText(c, exact(label));
  if (byLabel.length) return byLabel[0];
  return tl.queryAllByRole(c, 'group', { name: exact(label) })[0] ?? tl.queryAllByRole(c, 'radiogroup', { name: exact(label) })[0] ?? null;
}

async function step(c, s, spies) {
  if (s.fill) {
    const el = labelled(c, s.fill.label);
    if (!el) return { expected: `a field labelled "${s.fill.label}"`, got: `fields: ${JSON.stringify(names(c, 'textbox').concat(names(c, 'spinbutton')))}` };
    await act(async () => { tl.fireEvent.change(el, { target: { value: String(s.fill.value) } }); });
    await act(async () => { tl.fireEvent.blur(el); });
    return null;
  }
  if (s.click) {
    const el = tl.queryAllByRole(c, s.click.role ?? 'button', { name: exact(s.click.name) })[0];
    if (!el) return { expected: `a ${s.click.role ?? 'button'} named "${s.click.name}"`, got: `${s.click.role ?? 'button'}s: ${JSON.stringify(names(c, s.click.role ?? 'button'))}` };
    await act(async () => { tl.fireEvent.click(el); });
    return null;
  }
  if (s.choose) {
    const el = labelled(c, s.choose.label);
    if (!el) return { expected: `a control labelled "${s.choose.label}"`, got: `comboboxes: ${JSON.stringify(names(c, 'combobox'))}, groups: ${JSON.stringify(names(c, 'group'))}` };
    if (el.tagName === 'SELECT') {
      const opt = [...el.options].find((o) => exact(s.choose.option).test(o.textContent ?? ''));
      if (!opt) return { expected: `an option "${s.choose.option}" in the "${s.choose.label}" select`, got: `options: ${JSON.stringify([...el.options].map((o) => o.textContent))}` };
      await act(async () => { tl.fireEvent.change(el, { target: { value: opt.value } }); });
      return null;
    }
    const inGroup = ['radio', 'button', 'tab'].map((r) => tl.queryAllByRole(el, r, { name: exact(s.choose.option) })[0]).find(Boolean);
    if (!inGroup) return { expected: `a native <select> labelled "${s.choose.label}" (or a labelled group of buttons/radios) with "${s.choose.option}"`, got: `the labelled element is a <${el.tagName.toLowerCase()}>${el.getAttribute('role') ? ` role ${el.getAttribute('role')}` : ''}` };
    await act(async () => { tl.fireEvent.click(inGroup); });
    return null;
  }
  if (s.expect) {
    const e = s.expect;
    const q = e.name !== undefined ? { name: exact(e.name) } : e.nameRe ? { name: new RegExp(e.nameRe, 'i') } : {};
    const found = tl.queryAllByRole(c, e.role, q);
    const want = e.count ?? null;
    if (want !== null ? found.length !== want : !found.length) return { expected: `${want ?? 'a'} ${e.role}${e.name !== undefined ? ` named "${e.name}"` : e.nameRe ? ` named like /${e.nameRe}/` : ''}`, got: `${e.role}s: ${JSON.stringify(names(c, e.role))}` };
    if (e.value !== undefined && found[0].value !== String(e.value)) return { expected: `${e.role} "${e.name ?? ''}" with value "${e.value}"`, got: `value "${found[0].value}"` };
    if (e.href !== undefined && found[0].getAttribute('href') !== e.href) return { expected: `${e.role} "${e.name ?? ''}" with href "${e.href}"`, got: `href "${found[0].getAttribute('href')}"` };
    return null;
  }
  if (s.expectText) {
    const hit = new RegExp(String(s.expectText).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(c.textContent ?? '');
    return hit ? null : { expected: `the text "${s.expectText}"`, got: `text: ${JSON.stringify((c.textContent ?? '').slice(0, 200))}` };
  }
  if (s.expectLinks) {
    const have = names(c, 'link').map((n) => n.trim());
    const all = tl.queryAllByRole(c, 'link').map((el) => nameOf(el).trim());
    const missing = (s.expectLinks.present ?? []).filter((n) => !all.includes(n));
    const extra = (s.expectLinks.absent ?? []).filter((n) => all.includes(n));
    return missing.length || extra.length ? { expected: `links ${JSON.stringify(s.expectLinks.present ?? [])}${(s.expectLinks.absent ?? []).length ? ` and none of ${JSON.stringify(s.expectLinks.absent)}` : ''}`, got: `links: ${JSON.stringify(have)}` } : null;
  }
  if (s.expectCalls) {
    const got = spies[s.expectCalls.spy] ?? [];
    return JSON.stringify(got) === JSON.stringify(s.expectCalls.calls) ? null : { expected: `${s.expectCalls.spy} called with ${JSON.stringify(s.expectCalls.calls)}`, got: `${s.expectCalls.spy} called with ${JSON.stringify(got)}` };
  }
  return { expected: 'a known step', got: JSON.stringify(s) };
}

/** The snapshot of a rendered tree: each element with a role, as role, accessible name and (for leaves) text. */
function snapshot(c) {
  const nodes = [];
  for (const el of c.querySelectorAll('*')) {
    const role = getRole(el);
    if (!role || ['generic', 'presentation', 'none'].includes(role)) continue;
    nodes.push({ role, name: nameOf(el).trim(), ...(el.tagName === 'SELECT' || el.tagName === 'INPUT' ? { value: el.value } : {}) });
  }
  return nodes;
}

if (req.mode === 'snapshot') {
  // #921 visual diff: render the page, then for each state apply its steps (cumulative) and snapshot.
  const snaps = [];
  const spies = {};
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOMClient.createRoot(container);
  let broken = null;
  try {
    if (typeof Unit !== 'function') throw new Error(`${req.export} is not exported as a component`);
    console.error = () => {};
    await act(async () => { root.render(React.createElement(Unit, props(req.props ?? {}, spies))); });
  } catch (e) { broken = String(e?.message ?? e).split('\n')[0]; }
  for (const st of req.states) {
    if (broken) { snaps.push({ label: st.label, error: broken, nodes: [] }); continue; }
    let stepError = null;
    try {
      for (const s of st.steps ?? []) { const r = await step(container, s, spies); if (r) { stepError = `${JSON.stringify(s)}: expected ${r.expected}, got ${r.got}`; break; } }
    } catch (e) { stepError = String(e?.message ?? e).split('\n')[0]; }
    snaps.push({ label: st.label, nodes: snapshot(container), ...(stepError ? { stepError } : {}) });
  }
  process.stdout.write(`${JSON.stringify({ snapshots: snaps })}\n`);
  process.exit(0);
}

for (const ex of req.examples) {
  localStorage.clear();
  const spies = {};
  const p = props(ex.props ?? {}, spies);
  let container = document.createElement('div');
  document.body.appendChild(container);
  let root = ReactDOMClient.createRoot(container);
  let failed = null;
  try {
    if (typeof Unit !== 'function') throw new Error(`${req.export} is not exported as a component`);
    await act(async () => { root.render(React.createElement(Unit, p)); });
    for (let i = 0; i < (ex.steps ?? []).length && !failed; i += 1) {
      const s = ex.steps[i];
      if (s.remount) {
        await act(async () => root.unmount());
        container.remove();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = ReactDOMClient.createRoot(container);
        await act(async () => { root.render(React.createElement(Unit, p)); });
        continue;
      }
      const r = await step(container, s, spies);
      if (r) failed = { step: i + 1, did: s, ...r };
    }
  } catch (e) {
    failed = { step: 0, expected: 'the unit renders', got: `it threw ${String(e?.message ?? e).split('\n')[0]}` };
  }
  try { await act(async () => root.unmount()); } catch { /* already gone */ }
  container.remove();
  results.push(failed ? { id: ex.id, ok: false, ...failed } : { id: ex.id, ok: true });
}
process.stdout.write(`${JSON.stringify({ results, consoleErrors: errors.slice(0, 5) })}\n`);
process.exit(0);
