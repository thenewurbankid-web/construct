// Flow view (#328): the read-only server half of the Browser pane's Files | Flow switch. A thin adapter
// over summarizeUnit's `sections.flow` (deterministic, no LLM, no new graph walk).
//
// Security, in one place:
//   - the feature name comes from the CLIENT. It is only ever COMPARED against the real feature list of
//     the current project root (listUnits); it is never joined into a path, never passed to the
//     filesystem, and an unlisted name is refused before summarizeUnit runs;
//   - the project is always the server's current one; nothing here reads a project path from a request;
//   - the response is the flow tree, whose paths are project-root-relative by construction;
//   - opening a row (`flowFilePaths`) accepts a path only if it is one of the files THIS server just drew
//     in that feature's flow, so the client can never name an arbitrary file to read.
// The summarize call is synchronous, so results are cached per project root + a cheap stat signature of
// the source tree: a repeat request costs one stat walk, not a summarize.
import fs from 'node:fs';
import path from 'node:path';
import { summarizeUnit, listUnits } from '../../../packages/engine/unitSummary.mjs';

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'coverage', '.construct']);
const SOURCE = /\.(tsx?|jsx?|mjs|cjs|ya?ml|json)$/;
const MAX_ENTRIES = 30000;

const fail = (status, error) => ({ status, body: { ok: false, error } });

/** Cheap change detector for the source tree: name length + mtime + size of every source-ish file. */
export function projectSignature(root) {
  let acc = 0;
  let count = 0;
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (count > MAX_ENTRIES) return;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(abs);
      } else if (e.isFile() && SOURCE.test(e.name)) {
        try {
          const st = fs.statSync(abs);
          count++;
          acc = (acc * 31 + Math.floor(st.mtimeMs) + st.size + e.name.length) % 2147483647;
        } catch {
          /* vanished mid-walk */
        }
      }
    }
  };
  walk(root);
  return `${count}:${acc}`;
}

const cache = new Map(); // root -> { sig, features: Set, flows: Map<name, body> }

function entryFor(root) {
  const sig = projectSignature(root);
  const hit = cache.get(root);
  if (hit && hit.sig === sig) return hit;
  const listed = listUnits(root, { kind: 'feature' });
  const names = listed.ok ? listed.units.map((u) => u.id) : [];
  const fresh = { sig, features: new Set(names), flows: new Map() };
  cache.set(root, fresh);
  return fresh;
}

/** Test hook: forget every cached flow. */
export const clearFlowCache = () => cache.clear();

/** null when `feature` is one of the current project's real features, else a refusal. */
function checkFeature(entry, feature) {
  if (typeof feature !== 'string' || !feature || feature.includes('\0') || !NAME.test(feature)) return fail(400, 'That is not a feature name.');
  if (!entry.features.has(feature)) return fail(404, `No feature named "${feature}" in this project.`);
  return null;
}

/** @returns {{status:number, body:object}} */
export function featureFlow(root, feature) {
  const entry = entryFor(root);
  const refused = checkFeature(entry, feature);
  if (refused) return refused;
  if (!entry.flows.has(feature)) {
    const result = summarizeUnit(root, `feature:${feature}`, { detail: 'standard', include: ['flow'] });
    const flow = result.ok ? result.sections?.flow : null;
    if (!flow) return fail(500, result.ok ? 'This feature has no flow section.' : result.error.message);
    entry.flows.set(feature, { ok: true, feature, ...flow });
  }
  return { status: 200, body: entry.flows.get(feature) };
}

/** Every file path the flow of `feature` draws (the allowlist for opening a row), or a refusal. */
export function flowFilePaths(root, feature) {
  const { status, body } = featureFlow(root, feature);
  if (status !== 200) return { refusal: { status, body } };
  const files = new Set();
  const visit = (n) => {
    files.add(n.file);
    (n.children || []).forEach(visit);
  };
  for (const r of body.routes) {
    files.add(r.file);
    for (const f of r.features) {
      for (const c of f.controllers) {
        files.add(c.file);
        [...(c.behaviour || []), ...(c.render || []), ...(c.other || [])].forEach(visit);
      }
    }
  }
  return { files };
}
