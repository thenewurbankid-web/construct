// #943 -- the Line LSP's rules layer: Construct's own rule engine and Trace's step order as small-model tools.
// Pure and read-only, compact JSON, every list capped like the TS layer (index.mjs capList).
//
//   ruleDiagnostics(root, file)   construct validate's enforcers (the project's profile: Line or strict-nextjs) on one
//                                 file, in process (registry.mjs aggregateValidation, as cli.mjs validate runs them)
//   ruleFixes(root, file)         each violation's typed fixes (packages/engine/line/fixes.mjs withViolationFixes, ca2)
//   nextSteps(root, node)         the Trace steps allowed at a path node, in Line order (complete_stub, reuse by stable
//                                 id, add_to_scope, create, create_module), from stubProblems + moduleScope, plus an
//                                 Ollama `format` enum of exactly those options
//
// A stable id is `<feature>/<kind>/<name>` (e.g. `book/domains/formatPages`); a module is `module:<feature>/<kind>`.
import fs from 'node:fs';
import path from 'node:path';
import { aggregateValidation } from '@line/construct-core/registry';
import { enforcersForRoot } from '@line/construct-core/profiles';
import { withViolationFixes } from '../line/fixes.mjs';
import { stubProblems } from '../line/path/stubs.mjs';
import { moduleScope } from '../line/scope/moduleScope.mjs';
import { capList } from './index.mjs';

const relOf = (root, file) => (path.isAbsolute(file) ? path.relative(root, file) : file).split(path.sep).join('/');
const guard = (fn) => { try { return fn(); } catch (e) { return { ok: false, reason: String(e?.message || e).split('\n')[0].slice(0, 200) }; } };

function violationsOf(root, rel) {
  const r = aggregateValidation(root, enforcersForRoot(root), { files: [rel] });
  return r.violations.filter((v) => v.file === rel || v.file === path.join(root, rel));
}

/** One line per violation of `file`: `<file>:<line> <RULE> <message>`. */
export function ruleDiagnostics(root, file) {
  return guard(() => {
    const t0 = Date.now();
    const rel = relOf(path.resolve(root), file);
    const vs = violationsOf(path.resolve(root), rel);
    const lines = vs.map((v) => `${rel}:${v.line ?? 1} ${v.rule} ${String(v.message ?? '').replace(/\s+/g, ' ').slice(0, 160)}`);
    const { kept, dropped } = capList(lines, (s) => s);
    return { ok: true, file: rel, count: vs.length, rules: [...new Set(vs.map((v) => v.rule))], lines: kept, ...(dropped ? { more: dropped } : {}), ms: Date.now() - t0 };
  });
}

/** The typed fix(es) of each violation where one exists: { rule, line, fixes: [{id, sentence, tool}] }; advice-only fixes have tool null. */
export function ruleFixes(root, file) {
  return guard(() => {
    const t0 = Date.now();
    const r = path.resolve(root);
    const rel = relOf(r, file);
    const withFx = withViolationFixes(r, violationsOf(r, rel));
    const items = withFx.filter((v) => v.fixes?.length).map((v) => ({
      rule: v.rule, line: v.line ?? 1, key: v.key,
      fixes: v.fixes.slice(0, 3).map((f) => ({ id: f.id, sentence: String(f.sentence).slice(0, 160), tool: f.step?.tool ?? null })),
    }));
    const { kept, dropped } = capList(items);
    return { ok: true, file: rel, violations: withFx.length, withFixes: items.length, items: kept, ...(dropped ? { more: dropped } : {}), ms: Date.now() - t0 };
  });
}

export const STEPS = Object.freeze(['complete_stub', 'reuse', 'add_to_scope', 'create', 'create_module']);
const LOGIC = ['domains', 'services', 'usecases', 'expressions', 'hooks', 'controllers', 'providers', 'contracts'];
const featuresOf = (root) => { try { return fs.readdirSync(path.join(root, 'features'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort(); } catch { return []; } };

/**
 * The project's Line facts by stable id: each logic function (with its stub check) and each logic module, and what
 * each feature's index exports. Read from moduleScope + stubProblems on disk.
 */
export function lineFacts(root) {
  const fns = new Map(); const modules = new Set(); const exportsBy = {};
  for (const f of featuresOf(root)) {
    const s = moduleScope(root, f);
    exportsBy[f] = s.exports.map((e) => e.name);
    for (const [kind, items] of Object.entries(s.declares)) {
      if (!LOGIC.includes(kind)) continue;
      modules.add(`module:${f}/${kind}`);
      for (const it of items) {
        let problems;
        try { problems = stubProblems(fs.readFileSync(path.join(root, it.file), 'utf8'), it.name).map((p) => p.code); } catch { problems = ['NO_STUB']; }
        fns.set(`${f}/${kind}/${it.name}`, { id: `${f}/${kind}/${it.name}`, feature: f, kind, name: it.name, file: it.file, problems });
      }
    }
  }
  return { fns, modules, exportsBy };
}

/**
 * The Trace steps allowed at one path node, in Line's order (stub first, then reuse by stable id, then another
 * feature's export into scope, then create in the home module, then create the module). Each option's precondition
 * is a fact on disk; an option whose precondition fails is not offered, so the enum only holds legal moves.
 * @param {string} root Project root (a Line project: features/<f>/...).
 * @param {{need: string, from: string}} node `need` is the stable id the node must produce; `from` the asking feature.
 * @returns {{ok: true, options: {step: string, target: string, reason_id: string}[], schema: object, facts: string[]} | {ok: false, reason: string}}
 */
export function nextSteps(root, node, { facts = null } = {}) {
  return guard(() => {
    const t0 = Date.now();
    const r = path.resolve(root);
    const [feature, kind, name] = String(node.need).split('/');
    if (!feature || !kind || !name) return { ok: false, reason: `need must be a stable id <feature>/<kind>/<name>, got ${node.need}` };
    const F = facts ?? lineFacts(r);
    const fn = F.fns.get(node.need);
    const mod = `module:${feature}/${kind}`;
    const options = [];
    if (fn && fn.problems.length) options.push({ step: 'complete_stub', target: node.need, reason_id: 'STUB_OPEN', why: fn.problems.join(',') });
    if (fn && !fn.problems.length && feature === node.from) options.push({ step: 'reuse', target: node.need, reason_id: 'STABLE_ID_FINISHED' });
    if (fn && !fn.problems.length && feature !== node.from && (F.exportsBy[feature] ?? []).includes(name)) options.push({ step: 'add_to_scope', target: node.need, reason_id: 'EXPORTED_BY_OTHER_FEATURE' });
    if (!fn && F.modules.has(mod)) options.push({ step: 'create', target: node.need, reason_id: 'HOME_MODULE_EXISTS' });
    if (!fn && !F.modules.has(mod)) options.push({ step: 'create_module', target: mod, reason_id: 'NO_MODULE' });
    const keys = options.map((o) => `${o.step} ${o.target}`);
    return {
      ok: true, need: node.need, from: node.from, options,
      schema: { type: 'object', properties: { option: { type: 'string', enum: keys } }, required: ['option'] },
      ms: Date.now() - t0,
    };
  });
}
