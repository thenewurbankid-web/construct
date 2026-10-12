// Line Import v2 (docs/line/import-v2/CONTRACT.md, step 5 "Loop") -- the import loop the Import agent (importAgent.mjs)
// runs, pure so Cockpit's mock mode runs it in the browser:
//
//   map           read the input (a folder, or a route's RouteClosure), build the logic map of the unmodified app and keep
//                 it as the baseline (plus each file's source, for the path-mapped behaviour check)
//   characterize  write the characterization tests and run them in the app's own runner: every test must pass on the
//                 unmodified app before anything moves
//   classify(fit) every unit of the map goes to ONE Line block (iv2-fit fitLogic -> FitProposal), with the extract steps
//                 (planFitSteps) that land each block
//   after a step  (each import plan step a person approved): rebuild the map, diff it against the baseline, run the tests,
//                 check the moved files' behaviour; go on only when every check passes, else stop with ONE sentence plus
//                 typed fixes and ask. Each step leaves one ImportLoopState (kept in the import plan file, and appended
//                 to the plan records, slotted, through `ops.record`: records/import-loop.jsonl)
//   verify        the same checks once more, plus unit coverage: every unit has a block (from the FitProposal) and a test,
//                 or an owner waiver
//
// Each check is a Line expression (conditions.mjs IMPORT_LOOP_EXPRS, evaluated by expr.mjs) over the measured facts, so its
// outcome is machine-checkable and its sentence and typed fixes say what to do. A lost unit's "put it back" fix carries the
// extract step of its block (line.import.extract*, from the FitProposal) as a typed plan step. Waivers are the owner's
// only: a person (by "ui") can waive a unit; an agent's waiver is refused.
//
// The ops (`LoopOps`) are injected: importLoopDisk.mjs on a real project (the real logic map, characterizer, fit and
// route reader), importLoopMock.mjs createMockLogic in memory (Cockpit's mock mode).
import { evaluate } from './expr.mjs';
import { IMPORT_LOOP_EXPRS } from './conditions.mjs';
import { LOGIC_UNIT_WORDS, routeLabel } from './importV2/contract.mjs';
import { missingSentence } from './importV2/compare.mjs';

/** How many missing units, fixes and failures a record lists (the rest is a count): records stay fixed-size. */
export const LOOP_LIMITS = Object.freeze({ units: 20, fixes: 12, states: 200 });

/** The checks the loop runs, in order, with their plain names. `gate` checks stop a step; coverage gates only at verify. */
export const LOOP_CHECKS = Object.freeze([
  { id: 'char-tests', label: 'Characterization tests' },
  { id: 'logic-map', label: 'Logic kept' },
  { id: 'behaviour', label: 'Same behaviour' },
  { id: 'coverage', label: 'Unit coverage' },
]);

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const end = (s) => { const t = String(s ?? '').trim().replace(/\s+/g, ' '); return /[.?!]$/.test(t) ? t : `${t}.`; };
const lower = (s) => String(s).charAt(0).toLowerCase() + String(s).slice(1);

/**
 * A stable 16-hex hash of a text (two 32-bit FNV-1a passes with different seeds). Pure, for the map summary only; a
 * unit's fingerprint is logicMap.mjs's.
 * @param {string} text
 * @returns {string}
 */
export function stableHash(text) {
  const s = String(text);
  const pass = (seed) => {
    let h = seed >>> 0;
    for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, '0');
  };
  return `${pass(0x811c9dc5)}${pass(0x050c5d1f ^ s.length)}`;
}

/**
 * The fixed-size reference to a map that a loop record keeps (contract MapSummary): how many units, per kind, and a hash
 * of the fingerprints.
 * @param {any} map A LogicMap.
 * @returns {import('./importV2/contract.mjs').MapSummary}
 */
export function mapSummary(map) {
  const units = Array.isArray(map?.units) ? map.units : [];
  /** @type {Record<string, number>} */
  const counts = {};
  for (const u of units) counts[u.kind] = (counts[u.kind] ?? 0) + 1;
  return { units: units.length, counts, hash: stableHash(units.map((u) => u.fingerprint).sort().join(',')) };
}

/**
 * The empty logic record of an import plan file (contract ImportLogic).
 * @param {string|null|undefined} route The route that seeds the map, or none (the folder alone).
 * @returns {any}
 */
export function newLogic(route, feature) {
  return { route: route ?? null, ...(feature ? { feature } : {}), closure: null, map: null, fit: null, tests: [], baselineTests: null, waivers: [], loop: [], last: null };
}

const waivedSet = (logic) => new Set((logic?.waivers ?? []).map((w) => w.fingerprint));
const keyOf = (u) => u.fingerprint ?? u.id;

/**
 * Each unit's block from the FitProposal (`kind:name`), by fingerprint; units the proposal left unassigned have none.
 * @param {any} fit The saved fit: {proposal, steps}.
 * @returns {Map<string, string>}
 */
export function blocksOf(fit) {
  const out = new Map();
  for (const b of fit?.proposal?.blocks ?? []) for (const u of b.units) out.set(u, `${b.kind}:${b.name}`);
  return out;
}

/** The import steps that move a file AND rename its component (a name clash at plan time: `exportName` -> `name`). */
const MOVE_TOOLS = new Set(['line.import.toLibrary', 'line.import.toFeature']);

/**
 * The per-file rename tables the completed import steps imply (#875): each done step that moved a file and renamed its
 * export (`exportName` differs from `name`) renames that identifier in that file only, keyed by the file's
 * app-relative path before the move (the baseline map's `file`). Another file that still uses the old name is left
 * alone, so a project-wide table would be wrong. Importers keep their own local name (import.mjs withRename), so only
 * the moved file needs a table. Pure.
 * @param {string} folder The import folder, app-relative.
 * @param {{run?: string, tool: string, args?: any}[] | null | undefined} steps The import plan file's steps.
 * @returns {Record<string, Record<string, string>>}
 */
export function stepRenames(folder, steps) {
  /** @type {Record<string, Record<string, string>>} */
  const out = {};
  const base = String(folder ?? '').replace(/\/+$/, '');
  for (const s of steps ?? []) {
    const a = s?.args ?? {};
    if (s?.run !== 'done' || !MOVE_TOOLS.has(s.tool) || typeof a.from !== 'string') continue;
    if (s.tool === 'line.import.toFeature' && a.mode !== 'move') continue;
    if (!a.exportName || !a.name || a.exportName === a.name) continue;
    const file = base && base !== '.' ? `${base}/${a.from}` : a.from;
    out[file] = { ...(out[file] ?? {}), [a.exportName]: a.name };
  }
  return out;
}

/**
 * Measure where the import stands: the map now, its diff against the baseline, the tests, the moved files' behaviour,
 * each unit's block (from the FitProposal) and the unit coverage. Reads only.
 * @param {any} ops LoopOps
 * @param {{root: string, folder: string, logic: any, full?: boolean, steps?: any[]}} ctx `full`: run every characterization
 *   test (verify), not only those whose inputs changed since they last passed. `steps`: the import plan file's steps; a
 *   done step that moved and renamed a file gives that file's rename table to the compare (stepRenames).
 * @returns {Promise<any>}
 */
export async function measure(ops, { root, folder, logic, full = false, steps = [] }) {
  const baseline = await ops.load('logic-map');
  const map = await ops.buildMap(root, folder, logic.closure);
  const fileRenames = stepRenames(folder, steps);
  const diff = baseline
    ? await (Object.keys(fileRenames).length ? ops.compare(baseline, map, { fileRenames }) : ops.compare(baseline, map))
    : { kept: [], moved: [], missing: [], changed: [], added: map.units };
  const tests = await ops.runTests(root, folder, logic.tests ?? [], { full });
  const behaviour = ops.behaviour ? await ops.behaviour(root, folder, diff) : [];
  // Every import still resolves after the step (null: the ops cannot tell; the check then says so).
  const imports = ops.imports ? await ops.imports(root, folder) : null;
  const passing = new Set(tests.state === 'fail' ? (logic.tests ?? []).filter((t) => !(tests.failures ?? []).some((f) => f.file === t.file)).flatMap((t) => t.unitFingerprints) : (logic.tests ?? []).flatMap((t) => t.unitFingerprints));
  const fit = await ops.load('fit');
  const blocks = blocksOf(fit);
  const waived = waivedSet(logic);
  // The units to keep are the app's: logic the import itself adds (Line's thin feature items) is not measured.
  const added = baseline ? new Set(diff.added) : new Set();
  const units = map.units.filter((u) => !added.has(u)).map((u) => ({ fingerprint: u.fingerprint, id: u.id, kind: u.kind, fn: u.fn, file: u.file, block: blocks.get(keyOf(u)) ?? null, tested: passing.has(u.fingerprint), waived: waived.has(u.fingerprint) }));
  return { map, diff, tests, behaviour, imports, units, fit, blocks };
}

/** The folder-relative form of an app-relative path, or null when it is outside the folder. */
const inFolder = (folder, file) => (String(file).startsWith(`${folder}/`) ? String(file).slice(folder.length + 1) : null);

/**
 * The typed fix that puts a lost or changed unit back into its block: the extract step (line.import.extract*,
 * splitPage) of the unit's FitProposal block, its `from` moved to where the rest of the unit's old file went. Null when
 * the block has no extract step (a page, a component or a fixture: Import's moves land those).
 * @param {any} m What `measure` returned.
 * @param {any} u The lost unit (before side).
 * @param {string} folder
 * @returns {{tool: string, args: Record<string, any>, sentence: string} | null}
 */
export function putBackStep(m, u, folder) {
  const block = m.blocks?.get(keyOf(u));
  const step = block ? (m.fit?.steps ?? []).find((s) => s.blocks.includes(block)) : null;
  if (!step) return null;
  const now = m.diff.moved.find((x) => x.from.file === u.file)?.to.file;
  const from = now ? inFolder(folder, now) : null;
  return { tool: step.tool, args: { ...step.args, ...(from ? { from } : {}) }, sentence: step.sentence };
}

/** The block a missing unit should go back into: its FitProposal block, else where the other units of its old file went. */
function homeOf(m, u) {
  const block = m.blocks?.get(keyOf(u));
  if (block) return block;
  return m.diff.moved.find((x) => x.from.file === u.file)?.to.file ?? u.file;
}

/**
 * The loop's checks on one measurement, each a Line expression over the facts it measured, with one sentence and its
 * typed fixes. `at: 'step'` leaves coverage out (it is the import's end state); `at: 'verify'` includes it.
 * @param {any} m What `measure` returned.
 * @param {any} logic The plan file's logic record (its waivers).
 * @param {{at: 'step'|'verify', folder: string}} o
 * @returns {{id: string, state: 'pass'|'fail'|'skipped', sentence: string, detail?: string, expr: any, fixes: any[]}[]}
 */
export function loopChecks(m, logic, { at, folder }) {
  const waived = waivedSet(logic);
  /** @type {any[]} */
  const checks = [];
  const run = (id, facts) => evaluate(facts, IMPORT_LOOP_EXPRS[id]);
  // 1. Characterization tests, in the app's own runner.
  {
    const t = m.tests;
    const r = run('char-tests', { tests: { state: t.state, failed: t.failed, total: t.total } });
    const first = t.failures?.[0];
    checks.push(t.state === 'skipped'
      ? { id: 'char-tests', state: 'skipped', sentence: end(t.sentence || 'There are no characterization tests yet, so behaviour is checked by the logic map only'), expr: IMPORT_LOOP_EXPRS['char-tests'], fixes: [] }
      : r.ok
        ? { id: 'char-tests', state: 'pass', sentence: end(t.total === 1 ? 'The characterization test passes' : `The ${t.total} characterization tests pass`), expr: IMPORT_LOOP_EXPRS['char-tests'], fixes: [] }
        : { id: 'char-tests', state: 'fail', sentence: end(`${t.failed} of ${plural(t.total, 'characterization test')} fail${first ? `; the first: ${first.title}` : ''}`), detail: [...r.failed.map((f) => f.sentence), ...(t.detail ? [t.detail] : [])].join('\n'), expr: IMPORT_LOOP_EXPRS['char-tests'], fixes: [{ id: 'recheck', sentence: 'Fix the code so the tests pass again, then check again.' }] });
  }
  // 2. The logic map: nothing missing, nothing changed, unless the owner waived it.
  {
    const missing = m.diff.missing.map((u) => ({ fingerprint: u.fingerprint, waived: waived.has(u.fingerprint) }));
    const changed = m.diff.changed.map((c) => ({ fingerprint: c.before.fingerprint, waived: waived.has(c.before.fingerprint) }));
    const r = run('logic-map', { missing, changed });
    const lost = m.diff.missing.filter((u) => !waived.has(u.fingerprint));
    const turned = m.diff.changed.filter((c) => !waived.has(c.before.fingerprint));
    const total = m.diff.kept.length + m.diff.moved.length + m.diff.missing.length + m.diff.changed.length;
    if (r.ok) {
      const accepted = missing.length + changed.length;
      checks.push({ id: 'logic-map', state: 'pass', sentence: end(`${m.diff.kept.length + m.diff.moved.length} of ${plural(total, 'logic unit')} kept (${m.diff.moved.length} moved)${accepted ? `; the owner waived ${accepted}` : ''}`), expr: IMPORT_LOOP_EXPRS['logic-map'], fixes: [] });
    } else {
      const firstLost = lost[0];
      const sentence = firstLost
        ? `${plural(lost.length, 'logic unit')} went missing${turned.length ? ` and ${turned.length} changed` : ''}; the first: ${lower(firstLost.sentence ?? missingSentence(firstLost))}`
        : `${plural(turned.length, 'logic unit')} changed; the first: ${lower(turned[0].sentence)}`;
      const putBack = (u, what) => {
        const step = putBackStep(m, u, folder);
        return { id: 'put-back', fingerprint: u.fingerprint, block: homeOf(m, u), ...(step ? { step: { tool: step.tool, args: step.args } } : {}), sentence: end(step ? `Put the ${what} back: ${lower(step.sentence)}` : `Put the ${what} back into ${homeOf(m, u)}`) };
      };
      const fixes = [
        ...lost.slice(0, LOOP_LIMITS.fixes).map((u) => putBack(u, `${LOGIC_UNIT_WORDS[u.kind] ?? u.kind} "${String(u.detail).replace(/\s+/g, ' ').slice(0, 60)}" of ${u.fn}`)),
        ...turned.slice(0, LOOP_LIMITS.fixes).map((c) => putBack(c.before, `old ${LOGIC_UNIT_WORDS[c.before.kind] ?? c.before.kind} "${String(c.before.detail).replace(/\s+/g, ' ').slice(0, 60)}" of ${c.before.fn}`)),
        { id: 'waive', ownerOnly: true, fingerprints: [...lost, ...turned.map((c) => c.before)].map((u) => u.fingerprint), sentence: end(lost.length + turned.length === 1 ? `Waive it: you accept that this logic is ${lost.length ? 'gone' : 'changed'} (owner only)` : `Waive these ${lost.length + turned.length}: you accept that this logic is ${turned.length ? 'gone or changed' : 'gone'} (owner only)`) },
      ];
      checks.push({ id: 'logic-map', state: 'fail', sentence: end(sentence), detail: [...lost.slice(0, LOOP_LIMITS.units).map((u) => `missing ${u.id} ${u.fingerprint}`), ...turned.slice(0, LOOP_LIMITS.units).map((c) => `changed ${c.before.id} -> ${c.after.id}`), ...r.failed.map((f) => f.sentence)].join('\n'), expr: IMPORT_LOOP_EXPRS['logic-map'], fixes });
    }
  }
  // 3. Same behaviour: every moved or changed file, old path against new path (imports normalized; pure exports by fast-check).
  {
    const files = (m.behaviour ?? []).map((b) => ({ from: b.from, to: b.to, verdict: b.verdict, waived: waived.has(`file:${b.to}`) }));
    const r = run('behaviour', { files });
    const bad = (m.behaviour ?? []).filter((b) => b.verdict === 'changed' && !waived.has(`file:${b.to}`));
    if (!files.length) checks.push({ id: 'behaviour', state: 'skipped', sentence: 'No file has moved or changed yet, so there is no behaviour to compare.', expr: IMPORT_LOOP_EXPRS.behaviour, fixes: [] });
    else if (r.ok) checks.push({ id: 'behaviour', state: 'pass', sentence: end(`${plural(files.length, 'moved or changed file')} ${files.length === 1 ? 'behaves' : 'behave'} as before${files.some((f) => f.verdict === 'cant-tell') ? ' (some could not be compared; the tests and the map cover them)' : ''}`), detail: files.map((f) => `${f.from} -> ${f.to}: ${f.verdict}`).join('\n'), expr: IMPORT_LOOP_EXPRS.behaviour, fixes: [] });
    else {
      checks.push({
        id: 'behaviour', state: 'fail', sentence: end(`${bad[0].to} behaves differently from ${bad[0].from}${bad.length > 1 ? `, and ${bad.length - 1} more file${bad.length === 2 ? '' : 's'} too` : ''}`),
        detail: [...bad.map((b) => `${b.from} -> ${b.to}: ${b.verdict}${b.detail ? ` (${b.detail})` : ''}`), ...r.failed.map((f) => f.sentence)].join('\n'), expr: IMPORT_LOOP_EXPRS.behaviour,
        fixes: [...bad.slice(0, LOOP_LIMITS.fixes).map((b) => ({ id: 'put-back', file: b.to, block: b.to, sentence: end(`Put the old logic of ${b.from} back into ${b.to}`) })), { id: 'waive', ownerOnly: true, fingerprints: bad.map((b) => `file:${b.to}`), sentence: end(`Accept the new behaviour of ${bad.length === 1 ? bad[0].to : `these ${bad.length} files`} (owner only)`) }],
      });
    }
  }
  // 4. Every import still resolves: a move that leaves its importers pointing at a file that is gone is caught here even
  // when the logic map reads "all kept" (found on max-ai-ui /opportunity: 9 importers of a deleted file).
  {
    const list = m.imports;
    if (!Array.isArray(list)) checks.push({ id: 'imports', state: 'skipped', sentence: 'Line has no record of the app\'s imports before the import, so it did not check that every import still resolves.', expr: IMPORT_LOOP_EXPRS.imports, fixes: [] });
    else {
      const r = run('imports', { broken: list.map((b) => ({ file: b.file, spec: b.spec, line: b.line })) });
      if (r.ok) checks.push({ id: 'imports', state: 'pass', sentence: 'Every import still resolves to a file.', expr: IMPORT_LOOP_EXPRS.imports, fixes: [] });
      else {
        const first = list[0];
        checks.push({
          id: 'imports', state: 'fail', sentence: end(`${plural(list.length, 'import')} name${list.length === 1 ? 's' : ''} a file that is not there; the first: ${first.file} (line ${first.line}) imports ${first.spec}`),
          detail: list.slice(0, LOOP_LIMITS.units).map((b) => `${b.file}:${b.line} ${b.spec}`).join('\n'), expr: IMPORT_LOOP_EXPRS.imports,
          fixes: [{ id: 'recheck', sentence: 'Point these imports at where the files are now (or put the files back), then check again.' }],
        });
      }
    }
  }
  // 5. Unit coverage (verify only): every unit has a block (the FitProposal placed it) and a test, or the owner waived it.
  if (at === 'verify') {
    const r = run('coverage', { units: m.units.map((u) => ({ fingerprint: u.fingerprint, block: u.block, tested: u.tested, waived: u.waived })) });
    const open = m.units.filter((u) => !u.waived && !(u.block && u.tested));
    const c = coverageOf(m, logic);
    if (r.ok) checks.push({ id: 'coverage', state: 'pass', sentence: end(`Every logic unit has a block and a test${c.waived ? `, or the owner waived it (${c.waived})` : ''}`), expr: IMPORT_LOOP_EXPRS.coverage, fixes: [] });
    else {
      const first = open[0];
      const why = !first.block && !first.tested ? 'no block and no test' : !first.block ? 'no block (the fit left it for a person to place)' : 'no test';
      checks.push({
        id: 'coverage', state: 'fail', sentence: end(`${open.length} of ${plural(m.units.length, 'logic unit')} still need${open.length === 1 ? 's' : ''} a block or a test; the first: the ${LOGIC_UNIT_WORDS[first.kind] ?? first.kind}${first.fn === '<module>' ? '' : ` in ${first.fn}`} (${first.file}) has ${why}`),
        detail: open.slice(0, LOOP_LIMITS.units).map((u) => `${u.id} block=${u.block ?? 'none'} test=${u.tested ? 'yes' : 'no'}`).join('\n'), expr: IMPORT_LOOP_EXPRS.coverage,
        fixes: [{ id: 'recheck', sentence: 'Add the missing tests or blocks, then check again.' }, { id: 'waive', ownerOnly: true, fingerprints: open.map((u) => u.fingerprint), sentence: end(`Waive the ${plural(open.length, 'unit')} without a block or a test (owner only)`) }],
      });
    }
  }
  return checks;
}

/**
 * UnitCoverage as counts: covered (a block and a test), uncovered, waived (by the owner).
 * @param {any} m
 * @param {any} logic
 * @returns {import('./importV2/contract.mjs').UnitCoverageCounts}
 */
export function coverageOf(m, logic) {
  const waived = waivedSet(logic);
  const covered = m.units.filter((u) => u.block && u.tested).length;
  const w = m.units.filter((u) => !(u.block && u.tested) && waived.has(u.fingerprint)).length;
  return { covered, uncovered: m.units.length - covered - w, waived: w, total: m.units.length };
}

/**
 * The ImportLoopState of one step (contract ImportLoopState): the maps by reference (units, counts, hash: fixed size),
 * the diff as counts plus the first missing units, the tests, the coverage, and `ok` or `stopped` with the one sentence
 * and the typed fixes.
 * @param {{step: any, n: number, at: string, before: any, m: any, checks: any[], logic: any}} o
 * @returns {import('./importV2/contract.mjs').ImportLoopState}
 */
export function loopState({ step, n, at, before, m, checks, logic }) {
  const failing = checks.filter((c) => c.state === 'fail');
  const after = mapSummary(m.map);
  return {
    step: step.id, n, at, tool: step.tool,
    mapBefore: before, mapAfter: after,
    diff: {
      kept: m.diff.kept.length, moved: m.diff.moved.length, added: m.diff.added.length, changed: m.diff.changed.length,
      missing: m.diff.missing.slice(0, LOOP_LIMITS.units).map((u) => ({ fingerprint: u.fingerprint, id: u.id, kind: u.kind, fn: u.fn, file: u.file, detail: String(u.detail).slice(0, 140), sentence: u.sentence ?? missingSentence(u), block: homeOf(m, u), waived: waivedSet(logic).has(u.fingerprint) })),
      missingCount: m.diff.missing.length,
    },
    tests: { passed: m.tests.passed, failed: m.tests.failed, total: m.tests.total, state: m.tests.state },
    coverage: coverageOf(m, logic),
    behaviour: (m.behaviour ?? []).slice(0, LOOP_LIMITS.units).map((b) => ({ from: b.from, to: b.to, verdict: b.verdict })),
    checks: checks.map((c) => ({ id: c.id, state: c.state, sentence: c.sentence })),
    status: failing.length ? 'stopped' : 'ok',
    sentence: failing.length ? failing[0].sentence : end(`After "${String(step.sentence).replace(/[.?!]$/, '')}", every check passes: ${lower(checks.find((c) => c.id === 'logic-map')?.sentence ?? 'nothing was lost.')}`),
    fixes: failing.flatMap((c) => c.fixes).slice(0, LOOP_LIMITS.fixes + 1),
  };
}

/**
 * The one question the loop asks when a step (or verify) stops: run the extract step that puts a lost unit back into its
 * block (a typed fix, one option per block), fix it by hand and check again, undo the whole import (when it was saved
 * before the first step), or waive it when every failing check can be waived (owner only).
 * @param {string} id The question id (`loop:<stepId>` or `verify`).
 * @param {any[]} failing The failing checks.
 * @param {string} sentence
 * @param {{undo?: string}} [o] `undo`: the sentence of the undo option (only when the folder was saved).
 * @returns {{id: string, sentence: string, options: {id: string, sentence: string, step?: any}[], recommended: string}}
 */
export function loopQuestion(id, failing, sentence, o = {}) {
  // One put-back per block: a lost unit and its file's changed behaviour are the same piece of work.
  const putBack = [];
  for (const f of failing.flatMap((c) => c.fixes).filter((x) => x.id === 'put-back')) if (!putBack.some((p) => (p.block ?? p.sentence) === (f.block ?? f.sentence))) putBack.push(f);
  const typed = putBack.filter((p) => p.step);
  const byHand = putBack.filter((p) => !p.step);
  const recheck = byHand.length === 1 ? end(`${byHand[0].sentence.replace(/[.?!]$/, '')}, then check again`) : byHand.length ? end(`Put the ${byHand.length} lost pieces back by hand (listed under Details), then check again`) : end(failing.flatMap((c) => c.fixes).find((f) => f.id === 'recheck')?.sentence ?? 'Check again');
  const options = [
    ...typed.slice(0, LOOP_LIMITS.fixes).map((p, i) => ({ id: `fix:${i + 1}`, sentence: p.sentence, step: p.step })),
    { id: 'recheck', sentence: recheck },
  ];
  if (o.undo) options.push({ id: 'undo', sentence: end(o.undo) });
  const waivable = failing.length > 0 && failing.every((c) => c.fixes.some((f) => f.id === 'waive'));
  if (waivable) {
    const waives = failing.flatMap((c) => c.fixes.filter((f) => f.id === 'waive'));
    const n = waives.flatMap((f) => f.fingerprints).length;
    options.push({ id: 'waive', sentence: waives.length === 1 ? waives[0].sentence : end(`Waive all ${n}: you accept these changes (owner only)`) });
  }
  return { id, sentence: end(sentence), options, recommended: options[0].id };
}

/**
 * Add the owner's waivers for everything the failing checks offer to waive. Only a person waives: `by` other than "ui"
 * is refused (an agent can never waive a unit).
 * @param {any} logic The plan file's logic record (changed in place).
 * @param {any[]} failing
 * @param {string} by
 * @param {string} at ISO time
 * @returns {{ok: true, count: number} | {ok: false, code: string, sentence: string}}
 */
export function addWaivers(logic, failing, by, at) {
  if (by !== 'ui') return { ok: false, code: 'OWNER_ONLY', sentence: 'Only a person can waive a logic unit; an agent never can. Ask the owner to decide in Cockpit.' };
  const have = waivedSet(logic);
  let count = 0;
  for (const fix of failing.flatMap((c) => c.fixes).filter((f) => f.id === 'waive')) {
    for (const fp of fix.fingerprints) {
      if (have.has(fp)) continue;
      logic.waivers.push({ fingerprint: fp, by: 'owner', why: end(fix.sentence.replace(/ \(owner only\)/, '')), at });
      have.add(fp); count += 1;
    }
  }
  return { ok: true, count };
}

/**
 * The fit as the plan file keeps it (contract ImportLogic.fit): counts and one sentence; the full proposal is FIT_FILE.
 * @param {any} proposal A FitProposal.
 * @param {number} steps How many extract steps land it.
 * @returns {{feature: string, blocks: number, unassigned: number, steps: number, sentence: string}}
 */
export function fitSummary(proposal, steps) {
  const byKind = {};
  for (const b of proposal.blocks) byKind[b.kind] = (byKind[b.kind] ?? 0) + 1;
  const kinds = Object.entries(byKind).map(([k, n]) => plural(n, k)).join(', ');
  return {
    feature: proposal.feature, blocks: proposal.blocks.length, unassigned: proposal.unassigned.length, steps,
    sentence: end(`The logic fits ${plural(proposal.blocks.length, 'block')} of feature ${proposal.feature}${kinds ? ` (${kinds})` : ''}${proposal.unassigned.length ? `; ${plural(proposal.unassigned.length, 'unit')} no rule placed, for a person to decide` : ''}`),
  };
}

/** The logic-kind folder each extract tool lands in. */
const EXTRACT_KIND = Object.freeze({ 'line.import.extractService': 'services', 'line.import.extractDomain': 'domains', 'line.import.extractUsecase': 'usecases' });

/** The extension of a path (`.tsx`), or ''. */
const extOf = (rel) => { const base = String(rel).split('/').pop() ?? ''; const i = base.lastIndexOf('.'); return i > 0 ? base.slice(i) : ''; };

/**
 * The FitProposal's extract steps as import plan steps that run AFTER Import's own moves: each step's `from` follows
 * its file to where a `line.import.toLibrary` step moved it (`library/<kind>/<name>`), and a block whose code now sits
 * in the library lands in the library (the library never depends on a feature). Pure.
 * @param {{steps?: any[]} | null} fit The saved fit ({proposal, steps}).
 * @param {{tool: string, args: any}[]} planSteps Import's plan steps (folder-relative args).
 * @returns {{id: string, tool: string, args: any, sentence: string}[]}
 */
export function fitPlanSteps(fit, planSteps) {
  /** @type {Map<string, string>} */
  const moved = new Map();
  for (const s of planSteps) {
    if (typeof s.args?.from !== 'string') continue;
    if (s.tool === 'line.import.toLibrary') moved.set(s.args.from, `library/${s.args.kind}/${s.args.name}${extOf(s.args.from)}`);
    // a service or domain Import moves into a feature as it is (follow-up c)
    else if (s.tool === 'line.import.toFeature' && s.args.mode === 'move' && !s.args.base) moved.set(s.args.from, `features/${s.args.feature}/${s.args.kind}/${s.args.name}${extOf(s.args.from)}`);
  }
  // A block Import already landed whole (its file moved into the same logic kind) needs no extract step.
  const landed = (s) => { const to = moved.get(s.args.from); const kind = EXTRACT_KIND[s.tool]; return Boolean(to && kind && to.split('/').at(-2) === kind); };
  return (fit?.steps ?? []).filter((s) => !landed(s)).map((s, i) => {
    const to = moved.get(s.args.from);
    const args = to ? (({ feature: _f, ...rest }) => ({ ...rest, from: to }))(s.args) : { ...s.args };
    const sentence = to ? s.sentence.replace(/ of feature [\w-]+/g, ' in the library').replace(/ of ([\w.[\]-]+\.[cm]?[jt]sx?) /, ` of ${to.split('/').pop()} `) : s.sentence;
    return { id: `import-fit-${i + 1}-${s.args.name}`, tool: s.tool, args, sentence: end(sentence) };
  });
}

/**
 * The one sentence naming a route's shared files (RouteClosure.shared).
 * @param {number} n
 * @returns {string}
 */
export const sharedSentence = (n) => (n === 1 ? '1 shared file stays where it is; other routes use it.' : `${n} shared files stay where they are; other routes use them.`);

/**
 * The plain-English view of the loop for Cockpit and MCP: the map count, the fit, the coverage, the per-step diffs and
 * "N of M logic units kept", with technical detail for a Details disclosure.
 * @param {any} logic
 * @returns {any}
 */
export function logicView(logic) {
  if (!logic) return null;
  const last = logic.last;
  const total = logic.map?.units ?? 0;
  const kept = last ? last.kept : total;
  return {
    route: logic.route ?? null,
    files: logic.closure?.files?.length ?? 0,
    shared: logic.closure?.shared?.length ?? 0,
    sharedSentence: logic.closure?.shared?.length ? sharedSentence(logic.closure.shared.length) : null,
    units: total,
    counts: logic.map?.counts ?? {},
    kept,
    keptSentence: logic.map ? `${kept} of ${plural(total, 'logic unit')} kept.` : 'The logic map is not built yet.',
    fit: logic.fit ?? null,
    missing: last?.missing ?? [],
    coverage: last?.coverage ?? null,
    tests: last?.tests ?? logic.baselineTests ?? null,
    testCount: (logic.tests ?? []).length,
    waivers: logic.waivers ?? [],
    steps: (logic.loop ?? []).map((s) => ({ step: s.step, n: s.n, status: s.status, sentence: s.sentence, kept: s.diff.kept + s.diff.moved, moved: s.diff.moved, missing: s.diff.missingCount, added: s.diff.added, changed: s.diff.changed, tests: s.tests })),
    sentence: !logic.map ? 'The logic map is not built yet.' : end(`${logic.route ? `Route${Array.isArray(logic.route) && logic.route.length > 1 ? 's' : ''} ${routeLabel(logic.route)}: ` : ''}${plural(total, 'logic unit')} in ${plural(logic.closure?.files?.length ?? 0, 'file')}; ${kept} of ${total} kept${last?.coverage ? `; ${last.coverage.covered} covered by a block and a test` : ''}`) + (logic.closure?.shared?.length ? ` ${sharedSentence(logic.closure.shared.length)}` : ''),
  };
}
