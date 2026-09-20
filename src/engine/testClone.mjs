// #300/#301 -- listing a feature's tests and cloning a LOCKED generated test so QA can edit it.
//
// Layout (owner decisions on #284, see testGenerator.mjs):
//   features/<f>/tests/generated/<machine>--<slug>.spec.ts   locked: only the generator writes here
//   features/<f>/tests/<name>.spec.ts                        clones and authored tests: theirs
//
// JSON in, JSON out, deterministic, no LLM, no `ui/` imports. Expected refusals are RETURNED as
// { ok:false, code, error } (never thrown) so a caller can show them; only programmer errors throw.
//
// Security (the caller may pass client-supplied names; nothing here trusts them):
//   - the feature must be a real feature directory (projectPaths, the generator's own check);
//   - the source must match the generator's file-name pattern AND be an existing regular file, not a
//     symlink, in that feature's generated/ directory, carrying the generator's marker;
//   - the clone name must match ^[a-z0-9][a-z0-9-]*$, so it cannot contain a separator, `..`, NUL,
//     a newline or an absolute path; the destination is derived HERE, never accepted;
//   - the tests/ and generated/ directory chains are checked for symlinks / escaping the project
//     (assertSafeDir, shared with the generator) before anything is read or written;
//   - the clone is created with O_EXCL (`wx`): an existing file, even a dangling symlink, is never
//     overwritten; a free name is suggested instead; nothing is ever written under generated/.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../config.mjs';
import { matchFrozen } from '../frozen.mjs';
import { GENERATED_MARKER, assertLockDeclared, assertSafeDir, comment, planFeatureTests, projectPaths } from './testGenerator.mjs';

/** First line of every clone: what tells a clone (yours, never regenerated) from a generated file. */
export const CLONE_MARKER = '// @construct-clone v1 - YOURS: nothing regenerates this file (#300)';
export const CLONE_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
const MAX_NAME = 80;
const SOURCE_RE = /^[a-z0-9][a-z0-9-]*--[a-z0-9][a-z0-9-]*\.spec\.ts$/;
const YOURS_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.spec\.ts$/;
const MAX_BYTES = 1_000_000;

const refuse = (code, error, extra = {}) => ({ ok: false, code, error, ...extra });

/** The lineage a generated file (and, through the same lines, its clone) carries in its header. */
export function parseLineage(text) {
  const line = (key) => new RegExp(`^// ${key}: (.*)$`, 'm').exec(text)?.[1] ?? null;
  const json = (v) => { try { return JSON.parse(v); } catch { return null; } };
  const scenario = line('scenario');
  const sm = scenario && /^("(?:[^"\\]|\\.)*") - ("(?:[^"\\]|\\.)*")$/.exec(scenario);
  const machine = line('machine');
  const mm = machine && /^("(?:[^"\\]|\\.)*") \(("(?:[^"\\]|\\.)*")\), key ("(?:[^"\\]|\\.)*")$/.exec(machine);
  const from = line('cloned from');
  const fm = from && /^(\S+) \(scenario "?([^"]*)"?\)$/.exec(from);
  return {
    feature: json(line('feature') ?? 'null'),
    machine: mm ? json(mm[1]) : null,
    machineFile: mm ? json(mm[2]) : null,
    machineKey: mm ? json(mm[3]) : null,
    scenario: sm ? json(sm[1]) : null,
    title: sm ? json(sm[2]) : null,
    route: line('route'),
    machineHash: line('machine-hash'),
    scenarioHash: line('scenario-hash'),
    clonedFrom: fm ? { file: fm[1], scenario: fm[2] } : null,
  };
}

/** Read one regular, non-symlink file no bigger than MAX_BYTES; null when it is anything else. */
export function readRegular(abs) {
  try {
    const st = fs.lstatSync(abs);
    if (st.isSymbolicLink() || !st.isFile() || st.size > MAX_BYTES) return null;
    return fs.readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
}

export function locate(root, feature) {
  let p;
  try { p = projectPaths(root, feature); } catch (e) { return refuse('no-feature', e.message); }
  const testsRel = p.genRel.replace(/\/generated$/, '');
  try {
    assertSafeDir(root, p.genRel); // also proves tests/ is not a symlink: it is a prefix of generated/
    assertSafeDir(root, testsRel);
  } catch (e) { return refuse('unsafe-path', e.message); }
  return { ok: true, genRel: p.genRel, genDir: p.genDir, testsRel, testsDir: path.join(root, testsRel) };
}

function listDir(dir, pattern) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names.filter((n) => pattern.test(n)).sort().map((name) => ({ name, text: readRegular(path.join(dir, name)) })).filter((f) => f.text !== null);
}

/**
 * A feature's tests and the scenario coverage table. Read-only.
 * -> { ok, feature, lock:{declared,message}, generated[], yours[], coverage[], scenarios, skipped, truncated }
 * coverage row: { n, id (file-name slug), title, branch, route, generated, file, locked, cloned:[names], lastResult:'none' }
 */
export function listFeatureTests(root, feature) {
  const at = locate(root, feature);
  if (!at.ok) return at;
  let lock = { declared: true, message: null };
  try { assertLockDeclared(root, at.genDir); } catch (e) { lock = { declared: false, message: e.message }; }

  const generated = listDir(at.genDir, SOURCE_RE).filter((f) => f.text.startsWith(`${GENERATED_MARKER}\n`)).map((f) => ({ name: f.name, path: `${at.genRel}/${f.name}`, lineage: parseLineage(f.text), area: 'generated', locked: true }));
  const yours = listDir(at.testsDir, YOURS_RE).map((f) => {
    const lineage = parseLineage(f.text);
    const clone = f.text.startsWith(`${CLONE_MARKER}\n`);
    return { name: f.name, path: `${at.testsRel}/${f.name}`, lineage: clone ? lineage : null, clonedFrom: clone ? lineage.clonedFrom : null, kind: clone ? 'clone' : 'authored', area: 'yours', locked: false };
  });

  let plan = null;
  let coverageError = null;
  try { plan = planFeatureTests(root, feature); } catch (e) { coverageError = e.message; }
  const onDisk = new Map(generated.map((g) => [g.name, g]));
  const inFlowOrder = [...(plan?.files ?? [])].sort((a, b) => a.seq - b.seq); // enumeration order: the happy path first
  const coverage = inFlowOrder.map((f, i) => {
    const disk = onDisk.get(f.name);
    return {
      n: i + 1, id: f.name.replace(/\.spec\.ts$/, ''), machine: f.machine, title: f.title, branch: f.branch, route: f.scenarioRoute, text: f.text, needs: f.needs,
      generated: !!disk, file: disk ? disk.name : null, locked: !!disk,
      // out of date: the file on disk was written from a different source revision than the machine has now
      outOfDate: !!disk && (disk.lineage.scenarioHash !== `sha256:${f.sHash}` || disk.lineage.machineHash !== `sha256:${f.mHash}`),
      cloned: yours.filter((y) => y.clonedFrom?.file.endsWith(`/${f.name}`)).map((y) => y.name),
      lastResult: 'none',
    };
  });
  const rank = new Map(coverage.map((c) => [c.file, c.n]));
  generated.sort((a, b) => (rank.get(a.name) ?? Infinity) - (rank.get(b.name) ?? Infinity) || (a.name < b.name ? -1 : 1)); // flow order, happy path first
  return { ok: true, feature, lock, generated, yours, coverage, scenarios: coverage.length, skipped: plan?.skipped ?? [], truncated: !!plan?.truncated, coverageError };
}

/** The text of one listed test for "Just show me the code". Read-only; `area` is 'generated' or 'yours'. */
export function readFeatureTest(root, feature, { area, name } = {}) {
  const at = locate(root, feature);
  if (!at.ok) return at;
  if (area !== 'generated' && area !== 'yours') return refuse('bad-area', 'area must be "generated" or "yours".');
  const ok = area === 'generated' ? typeof name === 'string' && SOURCE_RE.test(name) : typeof name === 'string' && YOURS_RE.test(name);
  if (!ok) return refuse('bad-name', 'That is not the name of a test file.');
  const text = readRegular(path.join(area === 'generated' ? at.genDir : at.testsDir, name));
  if (text === null) return refuse('not-found', `No such test "${name}" in ${area === 'generated' ? at.genRel : at.testsRel}.`);
  if (area === 'generated' && !text.startsWith(`${GENERATED_MARKER}\n`)) return refuse('not-found', `No such generated test "${name}".`);
  return { ok: true, area, name, path: `${area === 'generated' ? at.genRel : at.testsRel}/${name}`, text, locked: area === 'generated' };
}

/** The first `<base>`, `<base>-2`, `<base>-3`... that is not taken in tests/. */
function freeName(testsDir, base) {
  for (let n = 1; n < 1000; n += 1) {
    const cand = n === 1 ? base : `${base.slice(0, MAX_NAME - String(n).length - 1)}-${n}`;
    try { fs.lstatSync(path.join(testsDir, `${cand}.spec.ts`)); } catch { return cand; }
  }
  return null;
}

/**
 * Copy one generated spec to features/<feature>/tests/<name>.spec.ts, keeping its lineage header and
 * adding a "cloned from" line. The result is `header lines + a blank line + the source, byte for byte`.
 * @param {string} root project root (server-derived)
 * @param {{feature:string, source:string, name?:string}} req `source` is a file NAME in generated/, not a path
 * @returns {{ok:true, path, name, source, lineage} | {ok:false, code, error, suggested?}}
 */
export function cloneGeneratedTest(root, { feature, source, name } = {}) {
  const at = locate(root, feature);
  if (!at.ok) return at;
  if (typeof source !== 'string' || !SOURCE_RE.test(source)) return refuse('bad-source', 'source must be the file name of a generated test.');
  const srcText = readRegular(path.join(at.genDir, source));
  if (srcText === null) return refuse('not-generated', `"${source}" is not a generated test of "${feature}".`);
  if (!srcText.startsWith(`${GENERATED_MARKER}\n`)) return refuse('not-generated', `"${source}" is not a generated test (it has no generator marker).`);

  const base = name === undefined ? `${source.replace(/\.spec\.ts$/, '')}-clone` : name;
  if (typeof base !== 'string' || base.length > MAX_NAME || !CLONE_NAME_RE.test(base)) {
    return refuse('bad-name', `A test name may use lowercase letters, digits and "-" only (start with a letter or digit, at most ${MAX_NAME} characters).`);
  }
  const dest = path.join(at.testsDir, `${base}.spec.ts`);
  const destRel = `${at.testsRel}/${base}.spec.ts`;
  if (path.dirname(dest) !== at.testsDir || matchFrozen(root, dest, loadConfig(root).frozen || [])) {
    return refuse('frozen', `${destRel} is a locked path; a clone must live in ${at.testsRel}/ outside generated/.`);
  }
  const taken = () => refuse('exists', `${destRel} already exists; a clone never overwrites.`, { suggested: freeName(at.testsDir, base) });
  try { fs.lstatSync(dest); return taken(); } catch { /* free */ }

  const lineage = parseLineage(srcText);
  const header = [
    CLONE_MARKER,
    `// cloned from: ${comment(`${at.genRel}/${source}`)} (scenario ${JSON.stringify(comment(lineage.scenario ?? ''))})`,
    `// lineage: machine-hash ${comment(lineage.machineHash ?? 'unknown')}, scenario-hash ${comment(lineage.scenarioHash ?? 'unknown')} (copied from the original; used to tell you if the flow it came from changes)`,
    '// The notice on the next lines belongs to the generated original. This copy is yours to edit.',
    '',
  ].join('\n');
  try {
    fs.mkdirSync(at.testsDir, { recursive: true });
    assertSafeDir(root, at.testsRel); // re-check after mkdir
    fs.writeFileSync(dest, `${header}\n${srcText}`, { flag: 'wx', mode: 0o644 });
  } catch (e) {
    if (e?.code === 'EEXIST') return taken();
    return refuse('unsafe-path', e.message);
  }
  return { ok: true, path: destRel, name: `${base}.spec.ts`, source: `${at.genRel}/${source}`, lineage: { scenario: lineage.scenario, machineHash: lineage.machineHash, scenarioHash: lineage.scenarioHash } };
}
