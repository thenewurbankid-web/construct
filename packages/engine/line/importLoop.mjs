// Line Import v2 (docs/line/import-v2/CONTRACT.md, step 5 "Loop") -- the import loop the Import agent (importAgent.mjs)
// runs, pure so Cockpit's mock mode runs it in the browser:
//
//   map           read the input (a folder, or a route's RouteClosure), build the logic map of the unmodified app and keep
//                 it as the baseline (plus each file's source, for the path-mapped behaviour check)
//   characterize  write the characterization tests and run them in the app's own runner: every test must pass on the
//                 unmodified app before anything moves
//   after a step  (each import plan step a person approved): rebuild the map, diff it against the baseline, run the tests,
//                 check the moved files' behaviour; go on only when every check passes, else stop with ONE sentence plus
//                 typed fixes and ask. Each step leaves one ImportLoopState (kept in the import plan file, and appended
//                 to the plan records, slotted, through `ops.record`)
//   verify        the same checks once more, plus unit coverage: every unit has a block and a test, or an owner waiver
//
// Each check is a Line expression (conditions.mjs IMPORT_LOOP_EXPRS, evaluated by expr.mjs) over the measured facts, so its
// outcome is machine-checkable and its sentence and typed fixes say what to do. Waivers are the owner's only: a person
// (by "ui") can waive a unit; an agent's waiver is refused.
//
// The ops (`LoopOps`) are injected: importLoopDisk.mjs on a real project, importLoopStandIns.mjs createMockLogic in memory.
import { evaluate } from './expr.mjs';
import { IMPORT_LOOP_EXPRS } from './conditions.mjs';
import { mapSummary, missingSentence } from './importLoopStandIns.mjs';

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
 * The block a file belongs to once imported, from its place in the Line folder (`library/<kind>/<Name>` or
 * `features/<f>/<kind>/<Name>`), or null when it is not in a block yet. A stand-in for iv2-fit's FitProposal.
 * @param {string} folder
 * @param {string} file
 * @returns {string|null}
 */
export function blockOfFile(folder, file) {
  const prefix = `${folder}/`;
  if (!String(file).startsWith(prefix)) return null;
  const rel = file.slice(prefix.length).replace(/\.[^./]+$/, '');
  return /^(library\/[^/]+\/.+|features\/[^/]+\/[^/]+\/.+)$/.test(rel) ? rel : null;
}

/**
 * The empty logic record of an import plan file (contract.mjs ImportLogic).
 * @param {string|null|undefined} route The route that seeds the map, or none (the folder alone).
 * @returns {any}
 */
export function newLogic(route) {
  return { route: route ?? null, closure: null, map: null, tests: [], baselineTests: null, waivers: [], loop: [], last: null };
}

const waivedSet = (logic) => new Set((logic?.waivers ?? []).map((w) => w.fingerprint));

/**
 * Measure where the import stands: the map now, its diff against the baseline, the tests, the moved files' behaviour and
 * the unit coverage. Reads only.
 * @param {any} ops LoopOps
 * @param {{root: string, folder: string, logic: any}} ctx
 * @returns {Promise<any>}
 */
export async function measure(ops, { root, folder, logic }) {
  const baseline = await ops.load('logic-map');
  const map = await ops.buildMap(root, folder, logic.closure);
  const diff = baseline ? await ops.compare(baseline, map) : { kept: [], moved: [], missing: [], changed: [], added: map.units };
  const tests = await ops.runTests(root, folder, logic.tests ?? []);
  const behaviour = ops.behaviour ? await ops.behaviour(root, folder, diff) : [];
  const passing = new Set(tests.state === 'fail' ? (logic.tests ?? []).filter((t) => !(tests.failures ?? []).some((f) => f.file === t.file)).flatMap((t) => t.unitFingerprints) : (logic.tests ?? []).flatMap((t) => t.unitFingerprints));
  const blocks = ops.blocks ? await ops.blocks(root, folder, map) : Object.fromEntries(map.units.map((u) => [u.fingerprint, blockOfFile(folder, u.file)]));
  const waived = waivedSet(logic);
  const units = map.units.map((u) => ({ fingerprint: u.fingerprint, id: u.id, kind: u.kind, fn: u.fn, file: u.file, block: blocks[u.fingerprint] ?? null, tested: passing.has(u.fingerprint), waived: waived.has(u.fingerprint) }));
  return { map, diff, tests, behaviour, units };
}

/** The block a missing unit should go back into: where the other units of its old file went, else its old file. */
function homeOf(diff, u, folder) {
  const to = diff.moved.find((m) => m.from.file === u.file)?.to.file;
  return blockOfFile(folder, to ?? '') ?? to ?? u.file;
}

/**
 * The loop's checks on one measurement, each a Line expression over the facts it measured, with one sentence and its
 * typed fixes. `at: 'step'` leaves coverage out (blocks fill in as the steps land); `at: 'verify'` includes it.
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
        ? `${plural(lost.length, 'logic unit')} went missing${turned.length ? ` and ${turned.length} changed` : ''}; the first: ${lower(missingSentence(firstLost))}`
        : `${plural(turned.length, 'logic unit')} changed; the first: ${lower(turned[0].sentence)}`;
      const fixes = [
        ...lost.slice(0, LOOP_LIMITS.fixes).map((u) => ({ id: 'put-back', fingerprint: u.fingerprint, block: homeOf(m.diff, u, folder), sentence: end(`Put the ${u.kind} "${String(u.detail).replace(/\s+/g, ' ').slice(0, 60)}" of ${u.fn} back into ${homeOf(m.diff, u, folder)}`) })),
        ...turned.slice(0, LOOP_LIMITS.fixes).map((c) => ({ id: 'put-back', fingerprint: c.before.fingerprint, block: blockOfFile(folder, c.after.file) ?? c.after.file, sentence: end(`Put the old ${c.before.kind} "${String(c.before.detail).replace(/\s+/g, ' ').slice(0, 60)}" of ${c.before.fn} back`) })),
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
        fixes: [...bad.slice(0, LOOP_LIMITS.fixes).map((b) => ({ id: 'put-back', file: b.to, block: blockOfFile(folder, b.to) ?? b.to, sentence: end(`Put the old logic of ${b.from} back into ${b.to}`) })), { id: 'waive', ownerOnly: true, fingerprints: bad.map((b) => `file:${b.to}`), sentence: end(`Accept the new behaviour of ${bad.length === 1 ? bad[0].to : `these ${bad.length} files`} (owner only)`) }],
      });
    }
  }
  // 4. Unit coverage (verify only): every unit has a block and a test, or the owner waived it.
  if (at === 'verify') {
    const r = run('coverage', { units: m.units.map((u) => ({ fingerprint: u.fingerprint, block: u.block, tested: u.tested, waived: u.waived })) });
    const open = m.units.filter((u) => !u.waived && !(u.block && u.tested));
    const c = coverageOf(m, logic);
    if (r.ok) checks.push({ id: 'coverage', state: 'pass', sentence: end(`Every logic unit has a block and a test${c.waived ? `, or the owner waived it (${c.waived})` : ''}`), expr: IMPORT_LOOP_EXPRS.coverage, fixes: [] });
    else {
      const first = open[0];
      const why = !first.block && !first.tested ? 'no block and no test' : !first.block ? 'no block' : 'no test';
      checks.push({
        id: 'coverage', state: 'fail', sentence: end(`${open.length} of ${plural(m.units.length, 'logic unit')} still need${open.length === 1 ? 's' : ''} a block or a test; the first: the ${first.kind} in ${first.fn} (${first.file}) has ${why}`),
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
 * @returns {{covered: number, uncovered: number, waived: number, total: number}}
 */
export function coverageOf(m, logic) {
  const waived = waivedSet(logic);
  const covered = m.units.filter((u) => u.block && u.tested).length;
  const w = m.units.filter((u) => !(u.block && u.tested) && waived.has(u.fingerprint)).length;
  return { covered, uncovered: m.units.length - covered - w, waived: w, total: m.units.length };
}

/**
 * The ImportLoopState of one step (CONTRACT.md): the maps by reference (units, counts, hash: fixed size), the diff as
 * counts plus the first missing units, the tests, the coverage, and `ok` or `stopped` with the one sentence and fixes.
 * @param {{step: any, n: number, at: string, before: any, m: any, checks: any[], logic: any}} o
 * @returns {any}
 */
export function loopState({ step, n, at, before, m, checks, logic }) {
  const failing = checks.filter((c) => c.state === 'fail');
  const after = mapSummary(m.map);
  return {
    step: step.id, n, at, tool: step.tool,
    mapBefore: before, mapAfter: after,
    diff: {
      kept: m.diff.kept.length, moved: m.diff.moved.length, added: m.diff.added.length, changed: m.diff.changed.length,
      missing: m.diff.missing.slice(0, LOOP_LIMITS.units).map((u) => ({ fingerprint: u.fingerprint, id: u.id, kind: u.kind, fn: u.fn, file: u.file, detail: String(u.detail).slice(0, 140), sentence: missingSentence(u), block: homeOf(m.diff, u, step.args?.folder ?? ''), waived: waivedSet(logic).has(u.fingerprint) })),
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
 * The one question the loop asks when a step (or verify) stops: fix it and check again (recommended), or waive it when
 * every failing check can be waived (owner only).
 * @param {string} id The question id (`loop:<stepId>` or `verify`).
 * @param {any[]} failing The failing checks.
 * @param {string} sentence
 * @returns {{id: string, sentence: string, options: {id: string, sentence: string}[], recommended: string}}
 */
export function loopQuestion(id, failing, sentence) {
  // One put-back per block: a lost unit and its file's changed behaviour are the same piece of work.
  const putBack = [];
  for (const f of failing.flatMap((c) => c.fixes).filter((x) => x.id === 'put-back')) if (!putBack.some((p) => (p.block ?? p.sentence) === (f.block ?? f.sentence))) putBack.push(f);
  const recheck = putBack.length === 1 ? end(`${putBack[0].sentence.replace(/[.?!]$/, '')}, then check again`) : putBack.length ? end(`Put the ${putBack.length} lost pieces back (listed under Details), then check again`) : end(failing.flatMap((c) => c.fixes).find((f) => f.id === 'recheck')?.sentence ?? 'Check again');
  const waivable = failing.length > 0 && failing.every((c) => c.fixes.some((f) => f.id === 'waive'));
  const options = [{ id: 'recheck', sentence: recheck }];
  if (waivable) {
    const waives = failing.flatMap((c) => c.fixes.filter((f) => f.id === 'waive'));
    const n = waives.flatMap((f) => f.fingerprints).length;
    options.push({ id: 'waive', sentence: waives.length === 1 ? waives[0].sentence : end(`Waive all ${n}: you accept these changes (owner only)`) });
  }
  return { id, sentence: end(sentence), options, recommended: 'recheck' };
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
 * The plain-English view of the loop for Cockpit and MCP: the map count, the coverage, the per-step diffs and
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
    units: total,
    counts: logic.map?.counts ?? {},
    kept,
    keptSentence: logic.map ? `${kept} of ${plural(total, 'logic unit')} kept.` : 'The logic map is not built yet.',
    missing: last?.missing ?? [],
    coverage: last?.coverage ?? null,
    tests: last?.tests ?? logic.baselineTests ?? null,
    testCount: (logic.tests ?? []).length,
    waivers: logic.waivers ?? [],
    steps: (logic.loop ?? []).map((s) => ({ step: s.step, n: s.n, status: s.status, sentence: s.sentence, kept: s.diff.kept + s.diff.moved, moved: s.diff.moved, missing: s.diff.missingCount, added: s.diff.added, changed: s.diff.changed, tests: s.tests })),
    sentence: !logic.map ? 'The logic map is not built yet.' : end(`${logic.route ? `Route ${logic.route}: ` : ''}${plural(total, 'logic unit')} in ${plural(logic.closure?.files?.length ?? 0, 'file')}; ${kept} of ${total} kept${last?.coverage ? `; ${last.coverage.covered} covered by a block and a test` : ''}`),
  };
}
