// Expressions (System 1 groundwork) -- the facts snapshot an expression is evaluated against (contract.mjs LineFacts),
// built statically from the project: readLineProject (library, features, findings) plus the library and feature files
// (bytes and sha256, the hash spot code editing uses), the structure hashes (structure.mjs) and, while a step is
// checked, what the step planned and what the writer did. Fixed size: files and findings are capped (FACTS_LIMITS) and
// `truncated` counts what was left out.
//
// Lazy: `plan` and `findingsNew` are known up front; the rest is read once, the first time an expression (or the
// summary) needs it, so the default checks cost nothing more than they did before expressions.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { FACTS_LIMITS } from './contract.mjs';
import { readLineProject } from './model.mjs';
import { structureOf, hash16 } from './structure.mjs';

const SKIP = new Set(['node_modules', '.git', '.next']);

/** Library and feature files: root-relative posix path -> {bytes, hash}, at most `limit`, sorted. */
export function fileFacts(root, dirs, limit = FACTS_LIMITS.files) {
  const found = [];
  const walk = (rel) => {
    let entries;
    try { entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { return; }
    for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (SKIP.has(e.name)) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r);
      else if (e.isFile()) found.push(r);
    }
  };
  for (const d of dirs) if (d) walk(d);
  const files = {};
  for (const r of found.slice(0, limit)) {
    const buf = fs.readFileSync(path.join(root, r));
    files[r] = { bytes: buf.length, hash: crypto.createHash('sha256').update(buf.toString('utf8')).digest('hex') };
  }
  return { files, truncated: Math.max(0, found.length - limit) };
}

/** The facts' view of readLineProject. */
export function projectFacts(project) {
  const library = {};
  for (const l of project.library ?? []) library[l.id] = { kind: l.kind, name: l.name, file: l.file, level: l.level ?? null, usedBy: (l.usedBy ?? []).length };
  const features = {};
  for (const f of project.features ?? []) {
    features[f.name] = {
      spec: Boolean(f.spec),
      items: (f.items ?? []).map((i) => ({ id: i.id, kind: i.kind, name: i.name, file: i.file, base: i.base?.libraryId ?? null, status: String(i.status ?? 'ok'), findings: (i.findings ?? []).length })),
    };
  }
  const all = (project.findings ?? []).map((x) => ({ key: String(x.key ?? `${x.rule}|${x.file}|${x.line ?? 0}`), rule: x.rule, severity: x.severity, file: x.file, fixIds: (x.fixes ?? []).map((fx) => fx.id) }));
  return { library, features, findings: all.slice(0, FACTS_LIMITS.findings), truncatedFindings: Math.max(0, all.length - FACTS_LIMITS.findings) };
}

/** New error findings as the facts keep them. */
export const newFindingFacts = (findings) => (findings ?? []).filter((f) => f.severity === 'error').map((f) => ({ key: String(f.key ?? `${f.rule}|${f.file}|${f.line ?? 0}`), rule: f.rule, severity: f.severity, file: f.file }));

/**
 * The facts snapshot of `root`.
 * @param {string} root
 * @param {{ops?: {readLineProject: (root: string) => any}, plan?: import('./contract.mjs').LineFacts['plan'],
 *   findingsNew?: import('./contract.mjs').LineFacts['findingsNew'], project?: any}} [o] `project`: a readLineProject
 *   result already in hand.
 * @returns {import('./contract.mjs').LineFacts & {project: () => any}}
 */
export function buildFacts(root, { ops, plan = null, findingsNew = [], project } = {}) {
  const read = ops?.readLineProject ?? readLineProject;
  let p = project ?? null; let pf = null; let ff = null; let st = null;
  const proj = () => (p ??= read(root));
  const pfacts = () => (pf ??= projectFacts(proj()));
  const files = () => (ff ??= fileFacts(root, [proj().layout?.library ?? 'library', proj().layout?.features ?? 'features']));
  const facts = { plan, findingsNew };
  Object.defineProperties(facts, {
    files: { enumerable: true, get: () => files().files },
    library: { enumerable: true, get: () => pfacts().library },
    features: { enumerable: true, get: () => pfacts().features },
    findings: { enumerable: true, get: () => pfacts().findings },
    structure: { enumerable: true, get: () => (st ??= structureOf(proj())) },
    truncated: { enumerable: true, get: () => ({ files: files().truncated, findings: pfacts().truncatedFindings }) },
    project: { enumerable: false, value: proj },
  });
  return /** @type {any} */ (facts);
}

/** The facts as plain JSON (reads everything once). */
export function summarizeFacts(facts) {
  const { files, library, features, findings, findingsNew, plan, structure, truncated } = facts;
  return { files, library, features, findings, findingsNew, plan, structure, truncated };
}

/** "sha256:<16 hex>" of the facts summary. */
export const factsHash = (facts) => hash16(summarizeFacts(facts));
