// #302 -- a cloned or authored Playwright spec as a STRUCTURED STEP DOCUMENT QA edits without code.
//
// There is no second source of truth: the document IS the spec file. The spec's test body is parsed (packages/ast) into
// steps, an edit changes the steps, and the file is re-rendered through the SAME renderer the generator uses
// (testSpecRender.mjs). The round trip is deterministic and GATED:
//
//   - a file is offered for structured editing only when parse -> render reproduces it BYTE FOR BYTE; anything else
//     (a hand-written statement, single quotes, an extra comment, a changed helper) is shown read-only with the reason;
//   - an edit is validated field by field against an allowlist, rendered through escaped template slots only, then
//     re-parsed: the result must contain exactly the validated steps or the edit is refused and nothing is written;
//   - a write needs the content hash the user reviewed (stale = refused) and the hash of the exact text previewed.
//
// JSON in, JSON out, deterministic, no LLM, no `ui/` imports. Expected refusals are RETURNED as { ok:false, code, error }.
// Nothing under features/*/tests/generated/ is ever written (generated tests are locked: clone them first, #300).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseToAst } from '../../packages/ast/index.mjs';
import { buildDiffView } from '../../src/text-diff.mjs';
import { GENERATED_MARKER, assertSafeDir, featureMachines } from './testGenerator.mjs';
import { CLONE_MARKER, locate, parseLineage, readRegular } from './testClone.mjs';
import { HELPERS, machineLine, startUrlLine, testBlockLines } from './testSpecRender.mjs';
import { humanize } from './workflowNarrator.mjs';

const NAME_RE = /^[a-z0-9][a-z0-9-]*\.spec\.ts$/;
const MAX_BASE = 80;
const MAX_STEPS = 200;
const MAX_TEXT = 200;
const MAX_TIMEOUT_MS = 120_000;
const CONTROL = new RegExp('[\\x00-\\x1f\\x7f\\x85' + String.fromCharCode(0x2028, 0x2029) + ']');
const URL_RE = /^\/[A-Za-z0-9\-._~/?=&%+#]*$/;

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const refuse = (code, error, extra = {}) => ({ ok: false, code, error, ...extra });

// ---- parsing ---------------------------------------------------------------------------------------

const isStr = (n) => n?.type === 'Literal' && typeof n.value === 'string';
const isInt = (n) => n?.type === 'Literal' && Number.isInteger(n.value) && n.value > 0;
const isId = (n, name) => n?.type === 'Identifier' && n.name === name;
const failAt = (text, at, what) => ({ ok: false, reason: `line ${text.slice(0, at).split('\n').length}: ${what}` });

/** One statement of the test body -> a step, or null when it is not one the editor knows. */
function stepOf(st, text) {
  const src = text.slice(st.range[0], st.range[1]);
  if (st.type === 'IfStatement') return src === 'if (START_URL === null) return;' ? { kind: 'guard' } : null;
  if (st.type !== 'ExpressionStatement') return null;
  const e = st.expression;
  if (e.type === 'CallExpression' && e.callee.type === 'MemberExpression' && isId(e.callee.object, 'test') && isId(e.callee.property, 'fixme')) {
    return e.arguments.length === 2 && e.arguments[0].type === 'Literal' && e.arguments[0].value === true && isStr(e.arguments[1]) ? { kind: 'fixme', text: e.arguments[1].value } : null;
  }
  if (e.type !== 'AwaitExpression') return null;
  if (src === 'await page.goto(START_URL);') return { kind: 'goto-call' };
  const c = e.argument;
  if (c.type !== 'CallExpression') return null;
  const a = c.arguments;
  if (isId(c.callee, 'expectFlowState') && (a.length === 3 || a.length === 4) && isId(a[0], 'page') && isId(a[1], 'MACHINE') && isStr(a[2]) && (a.length === 3 || isInt(a[3]))) {
    return { kind: 'state', state: a[2].value, ...(a.length === 4 ? { timeout: a[3].value } : {}) };
  }
  if (isId(c.callee, 'trigger') && a.length === 3 && isId(a[0], 'page') && isStr(a[1]) && isStr(a[2])) return { kind: 'event', testId: a[1].value, event: a[2].value };
  // await expect(page.getByText("...")).toBeVisible({ timeout: N });
  if (c.callee.type === 'MemberExpression' && isId(c.callee.property, 'toBeVisible') && c.callee.object.type === 'CallExpression' && isId(c.callee.object.callee, 'expect')) {
    const inner = c.callee.object.arguments[0];
    const opt = a[0];
    const ok = inner?.type === 'CallExpression' && inner.callee.type === 'MemberExpression' && isId(inner.callee.object, 'page') && isId(inner.callee.property, 'getByText') && inner.arguments.length === 1 && isStr(inner.arguments[0])
      && a.length === 1 && opt.type === 'ObjectExpression' && opt.properties.length === 1 && isId(opt.properties[0].key, 'timeout') && isInt(opt.properties[0].value);
    if (ok) return { kind: 'check-text', text: inner.arguments[0].value, timeout: opt.properties[0].value.value };
  }
  return null;
}

const CONSTS = /\nconst START_URL: string \| null = (null|"(?:[^"\\\n]|\\.)*");\nconst MACHINE = ("(?:[^"\\\n]|\\.)*");\n\n/;

/** The document a spec's text describes, WITHOUT the round-trip gate: `{ ok, doc:{ pre, machine, title, steps } } | { ok:false, reason }`. */
export function parseSpecRaw(text) {
  const m = CONSTS.exec(text);
  if (!m) return { ok: false, reason: 'It does not have the generated START_URL / MACHINE constants.' };
  let ast;
  try { ast = parseToAst(text); } catch { return { ok: false, reason: 'It is not valid TypeScript.' }; }
  const stmt = ast.body[ast.body.length - 1];
  const call = stmt?.type === 'ExpressionStatement' ? stmt.expression : null;
  const fn = call?.type === 'CallExpression' && isId(call.callee, 'test') && call.arguments.length === 2 && isStr(call.arguments[0]) ? call.arguments[1] : null;
  if (fn?.type !== 'ArrowFunctionExpression' || fn.body.type !== 'BlockStatement') return { ok: false, reason: 'It does not end with the generated test("...", async ({ page }) => { ... }) block.' };
  const comments = (ast.comments ?? []).filter((c) => c.type === 'Line');
  const steps = [];
  let from = fn.body.range[0] + 1;
  let url = JSON.parse(m[1] === 'null' ? 'null' : m[1]);
  for (const st of fn.body.body) {
    const between = comments.filter((c) => c.range[0] >= from && c.range[1] <= st.range[0]);
    if (between.length > 1) return failAt(text, between[1].range[0], 'more than one comment before a step.');
    const step = stepOf(st, text);
    if (!step) return failAt(text, st.range[0], 'a statement the step editor does not know.');
    if (between.length) {
      if (!['state', 'event', 'check-text'].includes(step.kind)) return failAt(text, between[0].range[0], 'a comment where a step has no note.');
      if (!between[0].value.startsWith(' ')) return failAt(text, between[0].range[0], 'a comment without a space after //.');
      step.note = between[0].value.slice(1);
    }
    if (step.kind === 'guard') {
      from = st.range[1];
      steps.push({ kind: 'goto', url, guardOnly: true });
      continue;
    }
    if (step.kind === 'goto-call') {
      const g = steps[steps.length - 1];
      if (g?.guardOnly !== true) return failAt(text, st.range[0], 'page.goto without its START_URL guard.');
      delete g.guardOnly;
    } else if (steps[steps.length - 1]?.guardOnly) return failAt(text, st.range[0], 'the START_URL guard is not followed by page.goto(START_URL).');
    else steps.push(step);
    from = st.range[1];
  }
  if (steps.some((s) => s.guardOnly)) return { ok: false, reason: 'The START_URL guard is not followed by page.goto(START_URL).' };
  const tail = comments.filter((c) => c.range[0] >= from && c.range[1] <= fn.body.range[1]);
  if (tail.length) return failAt(text, tail[0].range[0], 'a comment after the last step.');
  return { ok: true, doc: { pre: text.slice(0, m.index + 1), machine: JSON.parse(m[2]), title: call.arguments[0].value, steps } };
}

/** The text a document renders to. THE renderer: constants and helpers from testSpecRender, the body from its steps. */
export function renderDoc(doc) {
  const url = doc.steps.find((s) => s.kind === 'goto')?.url ?? null;
  return [
    `${doc.pre}${startUrlLine(url)}`,
    machineLine(doc.machine),
    '',
    HELPERS,
    '',
    ...testBlockLines(doc.title, doc.steps),
  ].join('\n') + '\n';
}

/**
 * Parse a spec for structured editing: ok ONLY if rendering the parsed document gives the file back byte for byte.
 * -> { ok:true, doc } | { ok:false, reason }
 */
export function parseSpec(text) {
  const raw = parseSpecRaw(text);
  if (!raw.ok) return raw;
  const again = renderDoc(raw.doc);
  if (again !== text) {
    const a = text.split('\n');
    const b = again.split('\n');
    const i = a.findIndex((line, n) => line !== b[n]);
    return { ok: false, reason: `Re-rendering it would change line ${(i < 0 ? Math.min(a.length, b.length) : i) + 1} (Construct writes ${JSON.stringify(b[i] ?? '')} where the file has ${JSON.stringify(a[i] ?? '')}), so it cannot be edited safely as steps.` };
  }
  return raw;
}

// ---- the machine an edit is checked against ---------------------------------------------------------

/** The machine a spec drives (by the key in `const MACHINE`): its user events with their data-testids, and its leaf states. */
export function machineInfo(root, feature, key) {
  let found;
  try { found = featureMachines(root, feature); } catch { return null; }
  const i = found.keys.indexOf(key);
  if (i < 0) return null;
  const machine = found.found[i].machine;
  return {
    key,
    id: machine.id,
    initial: machine.initial,
    events: [...found.testIds[i]].map(([event, testId]) => ({ event, testId, label: humanize(event) })),
    states: machine.states.filter((s) => !['compound', 'parallel', 'history'].includes(s.type)).map((s) => s.path),
  };
}

// ---- describing (what the Cockpit draws) ------------------------------------------------------------

/** GIVEN / AND / WHEN / THEN / CHECK, the sentence, and the selector each step binds to. */
export function describeSteps(steps) {
  return steps.map((s, i) => {
    const prev = steps[i - 1];
    const base = { ...s, note: s.note ?? '' };
    switch (s.kind) {
      case 'fixme': return { ...base, keyword: 'NEEDS', sentence: s.text, binding: 'test.fixme' };
      case 'goto': return { ...base, keyword: 'GIVEN', sentence: s.url === null ? 'Open the feature (no route reaches it yet)' : `Open ${s.url}`, binding: 'page.goto' };
      case 'state': return { ...base, keyword: prev?.kind === 'event' ? 'THEN' : 'AND', sentence: `the flow ${prev?.kind === 'goto' ? 'starts at' : 'moves to'} ${humanize(s.state)}`, binding: `[data-flow-state="${s.state}"]` };
      case 'event': return { ...base, keyword: 'WHEN', sentence: `"${humanize(s.event)}" happens`, binding: `[data-testid="${s.testId}"]` };
      default: return { ...base, keyword: 'CHECK', sentence: `the page shows "${s.text}"`, binding: 'text is visible' };
    }
  });
}

// ---- validating an edit -----------------------------------------------------------------------------

const plainText = (v, label, { min = 0 } = {}) => {
  if (typeof v !== 'string') return `${label} must be text.`;
  if (v.length < min) return `${label} cannot be empty.`;
  if (v.length > MAX_TEXT) return `${label} is longer than ${MAX_TEXT} characters.`;
  if (CONTROL.test(v)) return `${label} cannot contain line breaks or control characters.`;
  return null;
};

/** A same-origin path: one leading "/", no scheme, no "//", no "..", no backslash. */
export function urlProblem(v) {
  if (typeof v !== 'string' || !v) return 'The address must be a path such as /refunds/new.';
  if (v.length > MAX_TEXT) return `The address is longer than ${MAX_TEXT} characters.`;
  if (!URL_RE.test(v) || v.startsWith('//')) return 'The address must be a path on this site that starts with one "/" (letters, digits and - . _ ~ / ? = & % + # only).';
  let decoded = v;
  try { decoded = decodeURIComponent(v); } catch { return 'The address has a broken % escape.'; }
  if (v.split(/[/?#]/).includes('..') || decoded.split(/[/?#\\]/).includes('..') || decoded.includes('\\')) return 'The address cannot contain "..".';
  return null;
}

const timeoutProblem = (v) => (Number.isInteger(v) && v >= 500 && v <= MAX_TIMEOUT_MS ? null : `The wait must be a whole number of milliseconds between 500 and ${MAX_TIMEOUT_MS}.`);

/**
 * Turn the client's step list into validated, canonical steps. Only the allowlisted fields of each step are read
 * (never spread); an event / state must be one the machine really has (a value already in the file may stay, so a
 * stale clone can still be edited around it); the data-testid is DERIVED from the event, never taken from the client.
 * -> { ok:true, steps } | { ok:false, error }
 */
export function validateSteps(rawSteps, orig, machine) {
  if (!Array.isArray(rawSteps) || rawSteps.length === 0 || rawSteps.length > MAX_STEPS) return { ok: false, error: `A test has between 1 and ${MAX_STEPS} steps.` };
  const had = (kind, key, value) => orig.steps.some((s) => s.kind === kind && s[key] === value);
  const idOf = new Map((machine?.events ?? []).map((e) => [e.event, e.testId]));
  const states = new Set(machine?.states ?? []);
  const out = [];
  for (const [i, r] of rawSteps.entries()) {
    const at = `Step ${i + 1}: `;
    if (!r || typeof r !== 'object' || Array.isArray(r)) return { ok: false, error: `${at}not a step.` };
    const noteProblem = r.note === undefined || r.note === '' ? null : plainText(r.note, 'The note');
    if (noteProblem) return { ok: false, error: at + noteProblem };
    const note = r.note ? { note: r.note } : {};
    let step;
    switch (r.kind) {
      case 'fixme':
        if (!had('fixme', 'text', r.text)) return { ok: false, error: `${at}a "needs" note can be removed but not written.` };
        step = { kind: 'fixme', text: r.text };
        break;
      case 'goto': {
        const first = orig.steps.find((s) => s.kind === 'goto');
        if (r.url === null && first?.url === null) { step = { kind: 'goto', url: null }; break; }
        const p = r.url === first?.url ? null : urlProblem(r.url);
        if (p) return { ok: false, error: at + p };
        step = { kind: 'goto', url: r.url };
        break;
      }
      case 'state': {
        if (typeof r.state !== 'string' || !(states.has(r.state) || had('state', 'state', r.state))) return { ok: false, error: `${at}"${String(r.state).slice(0, 60)}" is not a state of this flow.` };
        if (r.timeout !== undefined && r.timeout !== null && timeoutProblem(r.timeout)) return { ok: false, error: at + timeoutProblem(r.timeout) };
        step = { kind: 'state', state: r.state, ...(r.timeout ? { timeout: r.timeout } : {}), ...note };
        break;
      }
      case 'event': {
        const keep = orig.steps.find((s) => s.kind === 'event' && s.event === r.event);
        if (typeof r.event !== 'string' || !(idOf.has(r.event) || keep)) return { ok: false, error: `${at}"${String(r.event).slice(0, 60)}" is not an event of this flow.` };
        step = { kind: 'event', event: r.event, testId: idOf.get(r.event) ?? keep.testId, ...note };
        break;
      }
      case 'check-text': {
        const p = plainText(r.text, 'The text to look for', { min: 1 }) ?? (r.timeout === undefined ? null : timeoutProblem(r.timeout));
        if (p) return { ok: false, error: at + p };
        step = { kind: 'check-text', text: r.text, timeout: r.timeout ?? 5000, ...note };
        break;
      }
      default: return { ok: false, error: `${at}unknown step type.` };
    }
    out.push(step);
  }
  const g = out.findIndex((s) => s.kind === 'goto');
  if (out.filter((s) => s.kind === 'goto').length !== 1) return { ok: false, error: 'A test opens the page exactly once.' };
  if (out.slice(0, g).some((s) => s.kind !== 'fixme') || out.slice(g + 1).some((s) => s.kind === 'fixme' || s.kind === 'goto')) return { ok: false, error: 'The page is opened first; "needs" notes come before it.' };
  return { ok: true, steps: out };
}

// ---- files ------------------------------------------------------------------------------------------

/** Locate and read one editable file: an existing regular non-symlink file directly under tests/ (never generated/). */
function openTestFile(root, feature, name) {
  const at = locate(root, feature);
  if (!at.ok) return at;
  if (typeof name !== 'string' || !NAME_RE.test(name) || name.length - '.spec.ts'.length > MAX_BASE) return refuse('bad-name', 'That is not the name of one of your tests.');
  const abs = path.join(at.testsDir, name);
  if (path.dirname(abs) !== at.testsDir) return refuse('bad-name', 'That is not the name of one of your tests.');
  let st = null;
  try { st = fs.lstatSync(abs); } catch { /* absent */ }
  if (!st) {
    const inGenerated = readRegular(path.join(at.genDir, name));
    if (inGenerated !== null) return refuse('locked', `"${name}" is a generated test and is locked. Clone it (Clone to edit) and edit your copy.`);
    return refuse('not-found', `No test "${name}" in ${at.testsRel}.`);
  }
  if (st.isSymbolicLink() || !st.isFile()) return refuse('unsafe-path', `${at.testsRel}/${name} is not a regular file.`);
  const text = readRegular(abs);
  if (text === null) return refuse('unsafe-path', `${at.testsRel}/${name} could not be read (too large or not a regular file).`);
  if (text.startsWith(`${GENERATED_MARKER}\n`)) return refuse('locked', `"${name}" carries the generator's lock marker and cannot be edited.`);
  return { ok: true, at, abs, text, rel: `${at.testsRel}/${name}` };
}

/**
 * One test as a step document. -> { ok:true, name, path, hash, kind, editable, reason?, title?, steps?, machine?, lineage? }
 * `hash` is the sha256 of the file: echo it back with an edit. `editable:false` carries the reason in words.
 */
export function readStepDocument(root, { feature, name } = {}) {
  const f = openTestFile(root, feature, name);
  if (!f.ok) return f;
  const base = { ok: true, name, path: f.rel, hash: sha(f.text), kind: f.text.startsWith(`${CLONE_MARKER}\n`) ? 'clone' : 'authored', lineage: f.text.startsWith(`${CLONE_MARKER}\n`) ? parseLineage(f.text) : null };
  const parsed = parseSpec(f.text);
  if (!parsed.ok) return { ...base, editable: false, reason: parsed.reason };
  return { ...base, editable: true, title: parsed.doc.title, steps: describeSteps(parsed.doc.steps), machine: machineInfo(root, feature, parsed.doc.machine) ?? { key: parsed.doc.machine, id: parsed.doc.machine, initial: null, events: [], states: [] } };
}

const canon = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
const same = (a, b) => canon(a) === canon(b);

/** Validate + render an edit against the file as it is now. -> { ok:true, before, after, doc } | refusal. Writes nothing. */
function plan(root, feature, name, baseHash, rawSteps) {
  const f = openTestFile(root, feature, name);
  if (!f.ok) return f;
  if (typeof baseHash !== 'string' || sha(f.text) !== baseHash) return refuse('stale', 'The test changed on disk since you opened it. Reopen it and redo the change; nothing was written.');
  const parsed = parseSpec(f.text);
  if (!parsed.ok) return refuse('not-editable', `This test cannot be edited as steps: ${parsed.reason}`);
  const machine = machineInfo(root, feature, parsed.doc.machine);
  const v = validateSteps(rawSteps, parsed.doc, machine);
  if (!v.ok) return refuse('invalid', v.error);
  // A start URL that was missing and is now set drops the "no route" TODO (the note and its fixme).
  const orig = parsed.doc.steps.find((s) => s.kind === 'goto');
  const now = v.steps.find((s) => s.kind === 'goto');
  const todo = orig.url === null && now.url !== null;
  const doc = {
    ...parsed.doc,
    pre: todo ? parsed.doc.pre.replace(/\/\/ TODO\(construct\)[^\n]*\n$/, '') : parsed.doc.pre,
    steps: todo ? v.steps.filter((s) => !(s.kind === 'fixme' && s.text.startsWith('TODO(construct)'))) : v.steps,
  };
  const after = renderDoc(doc);
  const back = parseSpec(after);
  if (!back.ok || !same(back.doc.steps, doc.steps) || back.doc.machine !== doc.machine || back.doc.title !== doc.title) {
    return refuse('unrenderable', 'That change cannot be written safely as a test, so nothing was written.');
  }
  return { ok: true, f, before: f.text, after, doc };
}

/** Preview an edit: the diff and the hash of the exact text that would be written. Writes nothing. */
export function previewStepEdit(root, { feature, name, baseHash, steps } = {}) {
  const p = plan(root, feature, name, baseHash, steps);
  if (!p.ok) return p;
  return { ok: true, name, path: p.f.rel, changed: p.after !== p.before, baseHash, resultSha: sha(p.after), diff: buildDiffView(p.before, p.after), steps: describeSteps(p.doc.steps) };
}

/** Write a previewed edit: needs the hash the user opened (`baseHash`) AND the hash of the diff they reviewed (`resultSha`). */
export function applyStepEdit(root, { feature, name, baseHash, resultSha, steps } = {}) {
  const p = plan(root, feature, name, baseHash, steps);
  if (!p.ok) return p;
  if (p.after === p.before) return refuse('no-change', 'Nothing changed, so nothing was written.');
  if (typeof resultSha !== 'string' || sha(p.after) !== resultSha) return refuse('not-reviewed', 'What would be written is not what you reviewed. Preview the change again; nothing was written.');
  const { at, abs } = p.f;
  const tmp = path.join(at.testsDir, `.${name}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  try {
    assertSafeDir(root, at.testsRel);
    fs.writeFileSync(tmp, p.after, { flag: 'wx', mode: 0o644 });
    // The file must still be exactly what the user reviewed right before it is replaced (closes all but a sub-millisecond race).
    const st = fs.lstatSync(abs);
    if (st.isSymbolicLink() || !st.isFile() || sha(fs.readFileSync(abs, 'utf8')) !== baseHash) {
      fs.unlinkSync(tmp);
      return refuse('stale', 'The test changed on disk while you were reviewing. Reopen it; nothing was written.');
    }
    fs.renameSync(tmp, abs);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* not created */ }
    return refuse('unsafe-path', e.message);
  }
  return { ok: true, name, path: p.f.rel, hash: sha(p.after), steps: describeSteps(p.doc.steps) };
}
