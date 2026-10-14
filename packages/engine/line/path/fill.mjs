// #921 path-first proof: the `fill` tool. {stubId, body} replaces that one stub's body (signature and imports locked),
// then runs the stub's verdict (check.mjs: static + purity + tsc + dry run + examples) and answers pass, or the first
// failure. Every attempt is one line in <project>/line/path/fills.jsonl (the measurement reads it). Also: the open stubs
// in bottom-up order, and one stub's card (signature, context, examples) for a model's prompt.
import fs from 'node:fs';
import path from 'node:path';
import { replaceBody, stubParts } from './stubs.mjs';
import { readPath, unitOf, bottomUp, checkStub, pageSnapshot, visualDiff, FILLS_FILE } from './check.mjs';
import { fixesStep } from '../lsp/spliceFixes.mjs';
import { smithCheckStep } from '../lsp/smithCheck.mjs';
import { nextOpenStub } from '../lsp/traceStep.mjs';
import { beamOnFail } from './beam/fillReplan.mjs';
import { completionsStep } from '../coder/completions.mjs';

/** The last page snapshot per point (the "before" of the next step's visual diff). */
export const SNAP_DIR = 'line/path/snapshots';

/**
 * Every fill attempt so far.
 * @param {string} root Project root.
 * @returns {any[]} The fills.jsonl entries, oldest first ([] when there are none).
 */
export function fillLog(root) {
  try { return fs.readFileSync(path.join(root, FILLS_FILE), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; }
}

/**
 * The stubs not yet passed (no passing fill since the path was installed), bottom-up.
 * @param {string} root Project root.
 * @param {any} [p] The path (read from the project when omitted).
 * @returns {any[]} The open stub units.
 */
export function openStubs(root, p = readPath(root)) {
  const passed = new Set();
  for (const f of fillLog(root)) { if (f.pass) passed.add(f.stubId); else passed.delete(f.stubId); }
  return bottomUp(p).filter((u) => !passed.has(u.id));
}

/**
 * One failure as plain lines for the model: the first failing example (input, expected, got) or the tsc error at its line.
 * @param {any} f The failure (or null).
 * @returns {string} The text ('' when there is no failure).
 */
export function failureText(f) {
  if (!f) return '';
  const lines = [`Failed at ${f.layer}${f.code && f.layer === 'static' ? ` (${f.code})` : ''}${f.sentence ? `: ${f.sentence}` : ''}`];
  if (f.layer === 'tsc' && f.code) lines.push(`At the line: ${f.code}`);
  if (f.completions?.items?.length) lines.push(`Pick the ${f.completions.kind === 'path' || f.completions.kind === 'import-source' ? 'import path' : 'name'} for ${f.completions.wrong} from: ${f.completions.items.slice(0, 12).join(', ')}`);
  if (f.example) {
    lines.push(`Example ${f.example}:`);
    if (f.input) lines.push(`  input: ${typeof f.input === 'string' ? f.input : JSON.stringify(f.input)}`);
    if (f.did) lines.push(`  at step ${f.step}: ${JSON.stringify(f.did)}`);
    lines.push(`  expected: ${typeof f.expected === 'string' ? f.expected : JSON.stringify(f.expected)}`);
    lines.push(`  got: ${typeof f.got === 'string' ? f.got : JSON.stringify(f.got)}`);
  }
  return lines.join('\n');
}

/**
 * One stub as the model reads it: id, file, layer, locked signature, context, the file's imports, its examples.
 * @param {string} root Project root.
 * @param {any} u The stub unit.
 * @returns {string} The card.
 */
export function stubCard(root, u) {
  const source = fs.readFileSync(path.join(root, u.file), 'utf8');
  const parts = stubParts(source, u.fn);
  const imports = source.split('\n').filter((l) => /^import\s/.test(l)).join('\n');
  const ex = (u.examples ?? []).map((e) => {
    if (u.check === 'dom') return `- ${e.id}: props ${e.show?.input ?? JSON.stringify(e.props)}; ${e.show?.expect ?? JSON.stringify(e.steps)}`;
    return `- ${e.id}: ${e.show?.input ?? JSON.stringify(e.input)} -> ${e.show?.expect ?? JSON.stringify(e.expect)}`;
  });
  return [`### ${u.id} (${u.layer}, ${u.file})`, `Signature (locked): ${parts?.signature ?? '(missing)'}`, u.context ? `Context: ${u.context}` : '',
    `The file imports (locked):\n${imports}`, 'Examples:', ...ex].filter(Boolean).join('\n');
}

/** tsc's `file:line:col TSxxxx message` sentence as {line, col, code}, or null. */
const tscPoint = (f) => { const m = /:(\d+):(\d+) (TS\d+) /.exec(String(f?.sentence ?? '')); return m ? { line: Number(m[1]), col: Number(m[2]), code: m[3] } : null; };

/**
 * Fill one stub. #945, each under its lsp.* switch (lsp/profile.mjs; `lsp` overrides it per call): the Line LSP's
 * fixes run on the spliced file before tsc (on), a tsc failure in the stub's file carries the closed choice of names
 * or import paths at that point (shadow), a passing fill is checked against the stub's Smith test plan (`smith`,
 * shadow), the next stub is the nextSteps block's (on), and a stub failing 3 fills in a row re-plans its point through
 * the Trace beam (`beam`, shadow: path/beam/fillReplan.mjs).
 * @param {{root: string, stubId: string, body: string, lsp?: Record<string, unknown>|null}} args
 * @returns {Promise<{ok: boolean, code?: string, stubId: string, pass?: boolean, failure?: object, ms?: object, sentence: string, next?: string|null, nextStep?: object|null, fixes?: any[]}>}
 */
export async function fill({ root, stubId, body, lsp = null }) {
  const p = readPath(root);
  const u = unitOf(p, stubId);
  const log = (e) => fs.appendFileSync(path.join(root, FILLS_FILE), `${JSON.stringify({ at: new Date().toISOString(), stubId, ...e })}\n`);
  if (!u || u.kind !== 'stub') return { ok: false, code: 'UNKNOWN_STUB', stubId, sentence: `There is no stub ${stubId}; the open stubs are ${openStubs(root, p).map((x) => x.id).join(', ') || 'none'}.` };
  const file = path.join(root, u.file);
  const before = fs.readFileSync(file, 'utf8');
  const r = replaceBody(before, u.fn, body);
  const n = fillLog(root).filter((f) => f.stubId === stubId).length + 1;
  if (!r.ok) {
    const refused = /** @type {{ok: false, code: string, sentence: string}} */ (r);
    log({ n, pass: false, refused: refused.code, sentence: refused.sentence, body: String(body ?? '').slice(0, 4000) });
    return { ok: false, code: refused.code, stubId, sentence: refused.sentence };
  }
  const prev = [...fillLog(root)].reverse().find((f) => f.stubId === stubId && f.pass);
  const visual = p.points?.[u.point]?.visual ?? null;
  const snapFile = path.join(root, SNAP_DIR, `${u.point}.json`);
  let beforeSnap = null;
  if (visual) {
    try { beforeSnap = JSON.parse(fs.readFileSync(snapFile, 'utf8')); } catch { beforeSnap = (await pageSnapshot(root, visual)).snapshots ?? null; }
  }
  const fx = fixesStep(root, u.file, r.source, { fn: u.fn, lsp, id: stubId });
  fs.writeFileSync(file, fx.source);
  const v = await checkStub(root, p, stubId, { prevSource: prev?.source ?? null });
  if (!v.pass && v.failure?.layer === 'tsc' && tscPoint(v.failure)) {
    const c = completionsStep(root, u.file, fx.source, tscPoint(v.failure), { lsp, id: stubId });
    if (c.offer) v.failure.completions = c.offer;
  }
  if (v.pass) {
    const sm = await smithCheckStep(root, u, fx.source, { lsp });
    if (sm.failure) { v.pass = false; v.failure = sm.failure; }
  }
  if (v.pass && visual) {
    // the visual diff: the point's page before and after this step; the step must show the change its point predicts.
    // While other stubs of the point are open the page may not render yet: the verdict is "pending", not a failure.
    const t0 = performance.now();
    const after = await pageSnapshot(root, visual);
    v.ms.visual = Math.round(performance.now() - t0);
    const othersOpen = openStubs(root, p).some((x) => x.point === u.point && x.id !== stubId);
    if (after.snapshots) { fs.mkdirSync(path.dirname(snapFile), { recursive: true }); fs.writeFileSync(snapFile, JSON.stringify(after.snapshots)); }
    const err = after.error ?? after.snapshots?.[0]?.error ?? null;
    const d = err ? null : visualDiff(beforeSnap, after.snapshots, visual.expect);
    v.visual = err ? { outcome: othersOpen ? 'pending' : 'failed', reason: `the page does not render: ${err}` } : d.ok ? { outcome: 'expected-change', added: d.added.length, removed: d.removed.length } : { outcome: othersOpen ? 'pending' : 'failed', reason: `the expected change is missing: ${d.missing.join('; ')}`, added: d.added.slice(0, 8) };
    if (v.visual.outcome === 'failed') { v.pass = false; v.failure = { layer: 'visual', sentence: `${v.visual.reason}${v.visual.added?.length ? ` (the diff added: ${v.visual.added.join(', ')})` : ''}` }; }
  }
  const { schema: _schema, ...logged } = v.failure?.completions ?? {};
  const failureLog = v.failure ? { ...v.failure, ...(v.failure.completions ? { completions: logged } : {}) } : null;
  log({ n, pass: v.pass, ...(failureLog ? { failure: failureLog } : {}), ms: v.ms, ...(v.c ? { c: v.c } : {}), ...(v.visual ? { visual: v.visual } : {}), body: r.body, ...(fx.applied.length ? { fixes: fx.applied } : {}), ...(v.pass ? { source: fx.source } : {}) });
  const nx = nextOpenStub(root, openStubs(root, p), { lsp });
  const next = nx.id;
  // #949: a stub that failed 3 fills in a row re-plans its point through the beam (lsp.beam; shadow: logged only)
  const rp = v.pass ? null : beamOnFail(root, p, u, { lsp });
  return { ok: true, stubId, pass: v.pass, ...(v.failure ? { failure: v.failure } : {}), ms: v.ms, ...(fx.applied.length ? { fixes: fx.applied } : {}), ...(rp?.mode === 'on' ? { replan: rp.would } : {}),
    sentence: v.pass ? `${stubId} passes (stub check, tsc and its ${u.examples.length} examples).${next ? ` Next open stub: ${next}.` : ' Every stub passes.'}` : `${stubId} does not pass yet.\n${failureText(v.failure)}`, next, ...(nx.step ? { nextStep: nx.step } : {}) };
}
