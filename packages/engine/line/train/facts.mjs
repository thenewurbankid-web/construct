// Train Line's world view: the facts a case's slots point into, read through Line's one facts module (../facts.mjs:
// factsSummary for the Line view, fileFacts for the file hashes). Ordering is stable, so a slot's ref ("feature#0",
// "library:components#1") always names the same thing in the same world. Checks are evaluated elsewhere, on
// ../facts.mjs buildFacts by ../expr.mjs (verify.mjs); this view never holds file contents.
import crypto from 'node:crypto';
import { readLineProject } from '../model.mjs';
import { factsSummary, fileFacts } from '../facts.mjs';

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const KIND_ORDER = ['components', 'pages', 'workflows', 'fixtures'];
const kindThenName = (a, b) => (KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)) || byName(a.name, b.name);

/**
 * The world view of a Line project on disk: files (path -> sha256), library, features, findings with their typed
 * fixes, and each page's code pieces.
 * @param {string} root
 * @returns {any}
 */
export function factsOf(root) {
  const p = readLineProject(root);
  const s = factsSummary(root, p);
  /** @type {Record<string, string>} */
  const files = Object.fromEntries(Object.entries(fileFacts(root, [p.layout.library, p.layout.features]).files).map(([f, v]) => [f, v.hash]));
  const library = s.library.map((l) => ({ id: l.id, kind: l.kind, name: l.name, file: l.file, level: l.level })).sort(kindThenName);
  const features = s.features.map((f) => ({
    name: f.name,
    items: f.items.map((i) => ({ id: i.id, kind: i.kind, name: i.name, file: i.file, base: i.base })).sort(kindThenName),
  })).sort((a, b) => byName(a.name, b.name));
  const findings = s.findings.map((f) => ({ rule: f.rule, file: f.file, line: f.line, key: f.key, sentence: f.sentence, fixes: f.fixes.map((x) => ({ id: x.id, rank: x.rank, sentence: x.sentence, step: x.step })) }))
    .sort((a, b) => byName(a.key, b.key));
  /** @type {Record<string, {id: string, kind: string, label: string}[]>} */
  const fragments = {};
  for (const f of features) for (const i of f.items) if (i.kind === 'pages') fragments[i.file] = s.fragments.filter((g) => g.file === i.file).map((g) => ({ id: g.id, kind: g.kind, label: g.label }));
  return { files, library, features, findings, fragments };
}

/**
 * The hash a case records: what the slots were bound to (files and the Line view).
 * @param {any} facts
 * @returns {string}
 */
export function factsHash(facts) {
  return sha(JSON.stringify({ files: facts.files, library: facts.library.map((l) => l.id), features: facts.features.map((f) => [f.name, f.items.map((i) => [i.id, i.base])]) }));
}
