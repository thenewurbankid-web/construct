// #306 -- is a CLONE still in step with the flow it was cloned from? Deterministic, read-only, no LLM.
//
// A clone records its lineage in its header (`machine-hash`, `scenario-hash`, copied from the generated file it came
// from, testClone.mjs). The CURRENT plan (planFeatureTests: exactly what `construct generate tests` would write, the
// same scenario enumeration; nothing is computed a second time) says what those hashes are now. Comparing them:
//
//   current           both hashes match                                   nothing to say
//   machine-changed   only the machine hash differs                       the flow changed ELSEWHERE; this scenario's steps are identical (a quiet note)
//   scenario-changed  the scenario hash differs                           the route this test walks changed: STALE, with the step diff
//   scenario-removed  the scenario the clone came from no longer exists   STALE, nothing left to compare with
//   unknown           no usable lineage (hand-edited header)              no claim is made either way
//
// The diff compares the clone's FLOW steps (an event happening, the flow reaching a state) with the steps the generator
// would write today, both read by the step parser (testSteps.parseSpecRaw). Things QA adds (checks, notes, the address,
// fixmes) are not flow steps and are never reported. A clone is NEVER rewritten here: this module writes nothing; QA
// decides. Limit, stated plainly: the clone is compared as it is NOW, so a flow step QA changed on purpose shows up as a
// difference too (the original generated text is not kept anywhere to compare against).
import path from 'node:path';
import { CLONE_MARKER, listFeatureTests, locate, parseLineage, readRegular } from './testClone.mjs';
import { planFeatureTests } from './testGenerator.mjs';
import { describeSteps, parseSpecRaw } from './testSteps.mjs';

const NAME_RE = /^[a-z0-9][a-z0-9-]*\.spec\.ts$/;
const isFlow = (s) => s.kind === 'event' || s.kind === 'state';
const keyOf = (s) => (s.kind === 'event' ? `event:${s.event}` : `state:${s.state}`);
const refuse = (code, error) => ({ ok: false, code, error });

/** The flow steps of a spec's text as [{kind, key, sentence}], or null when it cannot be read as steps. */
export function flowStepsOf(text) {
  const raw = parseSpecRaw(text);
  if (!raw.ok) return null;
  return describeSteps(raw.doc.steps).filter(isFlow).map((s) => ({ kind: s.kind, key: keyOf(s), sentence: s.sentence }));
}

/**
 * Plain-language differences between the flow steps of a clone (`old`) and of the current generated test (`now`).
 * -> [{ kind: 'added'|'removed'|'changed', text, before?, after?, at }]  (`at` = 1-based flow-step number where it applies)
 */
export function diffFlow(old, now) {
  const a = old.map((s) => s.key);
  const b = now.map((s) => s.key);
  const L = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) for (let j = b.length - 1; j >= 0; j -= 1) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const changes = [];
  let gone = [];
  let came = [];
  const flush = () => {
    while (gone.length && came.length) {
      const g = gone.find((x) => x.kind === came[0].kind);
      if (!g) break;
      gone.splice(gone.indexOf(g), 1);
      const c = came.shift();
      changes.push({ kind: 'changed', at: c.at, before: g.sentence, after: c.sentence, text: `Step ${c.at} changed: it was ${g.sentence}, it is now ${c.sentence}.` });
    }
    for (const g of gone) changes.push({ kind: 'removed', at: g.at, before: g.sentence, text: `A step is no longer in the flow: ${g.sentence}.` });
    for (const c of came) changes.push({ kind: 'added', at: c.at, after: c.sentence, text: `A new step is in the flow (step ${c.at}): ${c.sentence}.` });
    gone = [];
    came = [];
  };
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      flush();
      i += 1;
      j += 1;
    } else if (j >= b.length || (i < a.length && L[i + 1][j] >= L[i][j + 1])) {
      gone.push({ ...old[i], at: i + 1 });
      i += 1;
    } else {
      came.push({ ...now[j], at: j + 1 });
      j += 1;
    }
  }
  flush();
  return changes.sort((x, y) => x.at - y.at || (x.kind < y.kind ? -1 : 1));
}

const SUMMARY = {
  current: 'Up to date: the flow this test was cloned from has not changed.',
  'machine-changed': 'The flow changed elsewhere. The steps of this scenario are the same as when you cloned it.',
  'scenario-changed': 'The flow this test was cloned from has changed.',
  'scenario-removed': 'The scenario this test was cloned from is no longer in the flow.',
  unknown: 'This clone does not record where it came from, so Construct cannot tell whether the flow changed.',
};
const NEXT = {
  'scenario-changed': 'Review the differences, then update your test by hand (Edit steps) or leave it. Nothing was changed for you.',
  'scenario-removed': 'Decide whether this test still matters. Nothing was changed or deleted for you.',
};

/**
 * Freshness of ONE clone against the current plan.
 * @param {string} text the clone's text
 * @param {{files:object[]}|null} plan planFeatureTests result (null when the flow could not be planned)
 * @returns {{state, stale, summary, next, changes, comparable, from:{file,scenario}|null, now:{title,route}|null}}
 */
export function assessClone(text, plan) {
  const lin = parseLineage(text);
  const base = (state, extra = {}) => ({ state, stale: state === 'scenario-changed' || state === 'scenario-removed', summary: SUMMARY[state], next: NEXT[state] ?? null, changes: [], comparable: false, from: lin.clonedFrom, now: null, ...extra });
  const hashOk = (h) => typeof h === 'string' && /^sha256:[0-9a-f]{64}$/.test(h);
  if (!lin.clonedFrom || !hashOk(lin.machineHash) || !hashOk(lin.scenarioHash) || !plan) return base('unknown');
  const file = path.posix.basename(lin.clonedFrom.file);
  const cur = plan.files.find((f) => f.name === file);
  if (!cur) return base('scenario-removed');
  const now = { title: cur.title, route: cur.scenarioRoute };
  if (lin.scenarioHash === `sha256:${cur.sHash}`) return base(lin.machineHash === `sha256:${cur.mHash}` ? 'current' : 'machine-changed', { now });
  const old = flowStepsOf(text);
  const fresh = flowStepsOf(cur.content);
  if (!old || !fresh) return base('scenario-changed', { now });
  return base('scenario-changed', { now, comparable: true, changes: diffFlow(old, fresh) });
}

/** A feature's tests (testClone.listFeatureTests) with each clone's freshness and each coverage row's `staleClones`. Read-only. */
export function listFeatureTestsFresh(root, feature) {
  let plan = null;
  try { plan = planFeatureTests(root, feature); } catch { plan = null; }
  const r = listFeatureTests(root, feature, plan ? { plan } : {});
  if (!r.ok) return r;
  const at = locate(root, feature);
  for (const y of r.yours) {
    if (y.kind !== 'clone') continue;
    const f = assessClone(readRegular(path.join(at.testsDir, y.name)) ?? '', plan);
    y.freshness = { state: f.state, stale: f.stale, summary: f.summary, changes: f.changes.length };
  }
  for (const row of r.coverage) row.staleClones = r.yours.filter((y) => row.cloned.includes(y.name) && y.freshness?.stale).map((y) => y.name);
  return r;
}

/** One clone against the flow as it is now, with the full difference list. `name` is a file NAME, validated here. Read-only. */
export function compareClone(root, feature, { name } = {}) {
  const at = locate(root, feature);
  if (!at.ok) return at;
  if (typeof name !== 'string' || !NAME_RE.test(name)) return refuse('bad-name', 'That is not the name of a test file.');
  const text = readRegular(path.join(at.testsDir, name));
  if (text === null) return refuse('not-found', `No such test "${name}" in ${at.testsRel}.`);
  if (!text.startsWith(`${CLONE_MARKER}\n`)) return refuse('not-a-clone', `"${name}" is not a clone of a generated test, so there is nothing to compare it with.`);
  let plan = null;
  try { plan = planFeatureTests(root, feature); } catch { plan = null; }
  return { ok: true, name, path: `${at.testsRel}/${name}`, ...assessClone(text, plan) };
}
