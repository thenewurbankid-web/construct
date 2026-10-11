// Train Line facts: the snapshot of a world that slots point into and checks run over (the facts shape of the
// expression contract: {files, library, features, findings, findingsNew, plan}, plus `contents` for file checks and
// `fragments` for the code pieces a slot may name). Read-only; ordering is stable so a slot's ref ("feature#0") always
// names the same thing in the same world.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readLineProject } from '../model.mjs';
import { listFragments } from '../fragments.mjs';

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const KIND_ORDER = ['components', 'pages', 'workflows', 'fixtures'];
const kindThenName = (a, b) => (KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)) || byName(a.name, b.name);

/**
 * The facts of a Line project on disk.
 * @param {string} root
 * @returns {any}
 */
export function factsOf(root) {
  const p = readLineProject(root);
  /** @type {Record<string, string>} */
  const files = {};
  /** @type {Record<string, string>} */
  const contents = {};
  const walk = (rel) => {
    const abs = path.join(root, rel);
    for (const e of fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => byName(a.name, b.name))) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r);
      else if (e.isFile()) { const c = fs.readFileSync(path.join(root, r), 'utf8'); files[r] = sha(c); contents[r] = c; }
    }
  };
  for (const top of [p.layout.library, p.layout.features]) if (fs.existsSync(path.join(root, top))) walk(top);
  const library = p.library.map((l) => ({ id: l.id, kind: l.kind, name: l.name, file: l.file, level: l.level ?? null })).sort(kindThenName);
  const features = p.features.map((f) => ({
    name: f.name,
    items: f.items.map((i) => ({ id: i.id, kind: i.kind, name: i.name, file: i.file, base: i.base.libraryId })).sort(kindThenName),
  })).sort((a, b) => byName(a.name, b.name));
  const findings = p.findings.map((f) => ({ rule: f.rule, file: f.file, line: f.line, key: f.key ?? `${f.rule}|${f.file}|${f.line}`, sentence: f.sentence, fixes: (f.fixes ?? []).map((x) => ({ id: x.id, rank: x.rank, sentence: x.sentence, step: x.step })) }))
    .sort((a, b) => byName(a.key, b.key));
  /** @type {Record<string, {id: string, kind: string, label: string}[]>} */
  const fragments = {};
  for (const f of features) for (const i of f.items) {
    if (i.kind !== 'pages') continue;
    try { fragments[i.file] = listFragments(root, i.file).fragments.map((x) => ({ id: x.id, kind: x.kind, label: x.label })); } catch { fragments[i.file] = []; }
  }
  return { files, contents, library, features, findings, findingsNew: [], plan: [], fragments };
}

/** The hash a case records: what the slots were bound to (files and the Line view), not the plan. */
export function factsHash(facts) {
  return sha(JSON.stringify({ files: facts.files, library: facts.library.map((l) => l.id), features: facts.features.map((f) => [f.name, f.items.map((i) => [i.id, i.base])]) }));
}

/** The findings of `after` that `before` did not have (by rule and file). */
export function newFindings(before, after) {
  const had = new Set(before.findings.map((f) => `${f.rule}|${f.file}`));
  return after.findings.filter((f) => !had.has(`${f.rule}|${f.file}`));
}
