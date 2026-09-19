// Unit summaries for bots and humans: one deterministic, LLM-free, MCP-ready API that answers
// "what is this thing and is it healthy?" for any unit in the ecosystem (project, feature, layer,
// file, component, hook, service, domain, page, controller, workflow, export, route, package, rule,
// envelope, generator) without reading code.
//
// Pure functions: JSON in, JSON out, no console output, never throws (errors are structured
// `{ ok:false, error }` objects). Same input on the same tree -> byte-identical output.
// Contract: schemas/unit-summary.v1.json. Kinds are pluggable (see units/registry.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { createContext } from './units/facts.mjs';
import { defaultUnitRegistry } from './units/registry.mjs';

export const SCHEMA_VERSION = 1;
export const DETAILS = ['brief', 'standard', 'full'];
/** Token budgets per detail level (tokens ~= chars / 4). Brief is designed to fit ~500 tokens. */
export const TOKEN_BUDGETS = { brief: 500, standard: 2000, full: 8000 };
const estimateTokens = (s) => Math.ceil(s.length / 4);

const fail = (code, message, extra = {}) => ({ schemaVersion: SCHEMA_VERSION, ok: false, error: { code, message, ...extra } });
const refOf = (kind, id) => `${kind}:${id}`;

function parseRef(ref, registry) {
  const m = typeof ref === 'string' ? ref.match(/^([a-z]+):(.*)$/s) : null;
  return m && registry.get(m[1]) ? { kind: m[1], ref: m[2] } : { kind: undefined, ref };
}

function resolveIn(ctx, registry, rawRef, kindOpt) {
  if (typeof rawRef !== 'string' || !rawRef.trim()) return fail('INVALID_ARGUMENT', 'A unit reference is required (e.g. "login", "feature:login", "src/ast", "/login").');
  const parsed = parseRef(rawRef.trim(), registry);
  const kind = kindOpt || parsed.kind;
  if (kindOpt && parsed.kind && kindOpt !== parsed.kind) return fail('INVALID_ARGUMENT', `Reference prefix "${parsed.kind}:" conflicts with kind "${kindOpt}".`);
  const ref = parsed.ref;
  if (/(^|[\\/])\.\.([\\/#]|$)/.test(ref) || ref.includes('\0')) return fail('INVALID_ARGUMENT', 'A unit reference must stay inside the project (no ".." segments).');
  if (kind && !registry.get(kind)) return fail('UNKNOWN_KIND', `Unknown unit kind "${kind}".`, { validKinds: registry.names() });
  const consulted = kind ? [registry.get(kind)] : registry.kinds();
  let cands = consulted.flatMap((k) => k.resolve(ctx, ref, { explicit: !!kind }));
  const best = Math.min(...cands.map((c) => c.tier ?? 1));
  cands = cands.filter((c) => (c.tier ?? 1) === best);
  const seen = new Set();
  cands = cands.filter((c) => { const k = refOf(c.kind, c.id); return seen.has(k) ? false : (seen.add(k), true); });
  if (cands.length === 1) return { ok: true, unit: { kind: cands[0].kind, id: cands[0].id } };
  const shape = (c) => ({ kind: c.kind, id: c.id, ref: refOf(c.kind, c.id) });
  if (cands.length > 1) {
    return fail('UNIT_AMBIGUOUS', `"${ref}" matches ${cands.length} units; pass a kind-qualified ref such as "${refOf(cands[0].kind, cands[0].id)}".`, { candidates: cands.slice(0, 20).map(shape) });
  }
  const needle = ref.toLowerCase();
  const suggestions = consulted.flatMap((k) => k.list(ctx).filter((u) => u.id.toLowerCase().includes(needle) || (u.name || '').toLowerCase().includes(needle)).map((u) => shape({ kind: k.kind, id: u.id }))).slice(0, 8);
  return fail('UNIT_NOT_FOUND', `No ${kind || 'unit'} matches "${ref}".`, { candidates: suggestions, hint: 'Run `construct summarize --list` to see what exists.' });
}

function fitToBudget(result, maxTokens) {
  const omitted = {};
  const size = () => estimateTokens(JSON.stringify(result));
  const arrays = () => {
    const out = [];
    const visit = (node, p) => {
      if (Array.isArray(node)) { if (node.length > 1) out.push({ p, node }); node.forEach((x, i) => typeof x === 'object' && x && visit(x, `${p}[${i}]`)); }
      else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) visit(v, p ? `${p}.${k}` : k);
    };
    visit(result.sections, 'sections');
    return out;
  };
  for (let guard = 0; guard < 5000 && size() > maxTokens; guard++) {
    const a = arrays().sort((x, y) => JSON.stringify(y.node).length - JSON.stringify(x.node).length || x.p.localeCompare(y.p))[0];
    if (!a) break;
    a.node.pop();
    omitted[a.p] = (omitted[a.p] || 0) + 1;
  }
  return { omitted };
}

const finalize = (o) => JSON.parse(JSON.stringify(o)); // drops undefined; keeps key order deterministic

/**
 * Summarize any unit.
 * @param {string} root project (or Construct package) root
 * @param {string} ref  "kind:id", or a bare name/path/route/rule id ("login", "src/ast", "/login", "PAGE-006")
 * @param {{detail?: 'brief'|'standard'|'full', include?: string[], kind?: string, registry?: object}} [opts]
 *   include: keep only these `sections` keys (summary, health, links, next are always kept)
 * @returns {object} `{schemaVersion, ok:true, kind, id, ref, name, path, detail, summary, sections, health, links, next, budget}`
 *   or `{schemaVersion, ok:false, error:{code, message, candidates?, hint?}}`. Never throws.
 */
export function summarizeUnit(root, ref, opts = {}) {
  try {
    const { detail = 'standard', include, kind, registry = defaultUnitRegistry() } = opts;
    if (!DETAILS.includes(detail)) return fail('INVALID_ARGUMENT', `detail must be one of ${DETAILS.join(', ')}.`);
    if (include !== undefined && (!Array.isArray(include) || include.some((s) => typeof s !== 'string'))) return fail('INVALID_ARGUMENT', 'include must be an array of section names.');
    if (typeof root !== 'string' || !fs.existsSync(root)) return fail('ROOT_NOT_FOUND', `Project root not found: ${root}`);
    const ctx = createContext(path.resolve(root));
    const r = resolveIn(ctx, registry, ref, kind);
    if (!r.ok) return r;
    const k = registry.get(r.unit.kind);
    const s = k.summarize(ctx, r.unit.id, detail);
    if (!s) return fail('UNIT_NOT_FOUND', `${r.unit.kind} "${r.unit.id}" has nothing to summarize (empty or missing).`);
    let sections = s.sections;
    if (include) sections = Object.fromEntries(Object.entries(sections).filter(([key]) => include.includes(key)));
    const maxTokens = TOKEN_BUDGETS[detail];
    const out = {
      schemaVersion: SCHEMA_VERSION, ok: true, kind: r.unit.kind, id: r.unit.id, ref: refOf(r.unit.kind, r.unit.id),
      name: s.name, path: s.path, detail, summary: s.summary, sections, health: s.health,
      links: { ...s.links, ...(s.links?.children ? { children: s.links.children.slice(0, detail === 'brief' ? 3 : 40) } : {}) },
      next: (s.next || []).slice(0, detail === 'brief' ? 2 : 6),
    };
    const clean = finalize(out);
    const { omitted } = fitToBudget(clean, maxTokens - 60); // headroom for the budget block itself
    clean.budget = { maxTokens, estimatedTokens: 0, truncated: Object.keys(omitted).length > 0, ...(Object.keys(omitted).length ? { omitted } : {}) };
    clean.budget.estimatedTokens = estimateTokens(JSON.stringify(clean));
    if (clean.budget.estimatedTokens > maxTokens) clean.budget.exceeded = true;
    return clean;
  } catch (e) {
    return fail('INTERNAL_ERROR', String(e?.message || e));
  }
}

/** Resolve a reference to `{ok:true, unit:{kind,id}}` or a structured ambiguity/not-found error with candidates. */
export function resolveUnit(root, ref, { kind, registry = defaultUnitRegistry() } = {}) {
  try {
    if (typeof root !== 'string' || !fs.existsSync(root)) return fail('ROOT_NOT_FOUND', `Project root not found: ${root}`);
    const r = resolveIn(createContext(path.resolve(root)), registry, ref, kind);
    return r.ok ? { schemaVersion: SCHEMA_VERSION, ok: true, ...r.unit, ref: refOf(r.unit.kind, r.unit.id) } : r;
  } catch (e) {
    return fail('INTERNAL_ERROR', String(e?.message || e));
  }
}

/** List units. With `kind`: every unit of that kind. Without: an index of kinds (with counts) plus the
 * low-cardinality units (project, feature, layer, route, rule, envelope, generator, package). */
export function listUnits(root, { kind, registry = defaultUnitRegistry() } = {}) {
  try {
    if (typeof root !== 'string' || !fs.existsSync(root)) return fail('ROOT_NOT_FOUND', `Project root not found: ${root}`);
    const ctx = createContext(path.resolve(root));
    const one = (k) => k.list(ctx).map((u) => ({ kind: k.kind, id: u.id, name: u.name ?? u.id, ...(u.path ? { path: u.path } : {}), ref: refOf(k.kind, u.id) }));
    if (kind) {
      const k = registry.get(kind);
      if (!k) return fail('UNKNOWN_KIND', `Unknown unit kind "${kind}".`, { validKinds: registry.names() });
      const units = one(k);
      return { schemaVersion: SCHEMA_VERSION, ok: true, kind, count: units.length, units };
    }
    const NOISY = new Set(['file', 'component', 'hook', 'service', 'domain', 'page', 'controller', 'workflow', 'export']);
    const kinds = [];
    const units = [];
    for (const k of registry.kinds()) {
      const all = one(k);
      kinds.push({ kind: k.kind, description: k.description, count: all.length });
      if (!NOISY.has(k.kind)) units.push(...all);
    }
    return { schemaVersion: SCHEMA_VERSION, ok: true, kinds, count: units.length, units };
  } catch (e) {
    return fail('INTERNAL_ERROR', String(e?.message || e));
  }
}

/** Index of features with one-line health each. */
export function listFeatures(root, opts = {}) {
  const l = listUnits(root, { kind: 'feature', ...opts });
  if (!l.ok) return l;
  const features = l.units.map((u) => {
    const s = summarizeUnit(root, u.ref, { detail: 'brief', ...opts });
    return s.ok
      ? { name: u.id, path: u.path, ref: u.ref, summary: s.summary, health: s.health.status, completeness: s.health.completeness }
      : { name: u.id, path: u.path, ref: u.ref, error: s.error };
  });
  return { schemaVersion: SCHEMA_VERSION, ok: true, count: features.length, features };
}

/** Feature-first entry point: a feature name, or (route/path) anything else `summarizeUnit` understands. */
export function summarizeFeatureForAgents(root, featureOrRef, opts = {}) {
  const looksLikeRef = typeof featureOrRef === 'string' && (featureOrRef.startsWith('/') || featureOrRef.includes('/') || featureOrRef.includes(':'));
  return summarizeUnit(root, featureOrRef, looksLikeRef ? opts : { kind: 'feature', ...opts });
}

/** Machine-readable usage note for agents (also served by `construct summarize --usage`). */
export function unitApiManifest(registry = defaultUnitRegistry()) {
  return {
    schemaVersion: SCHEMA_VERSION,
    schema: 'schemas/unit-summary.v1.json',
    purpose: 'Deterministic, LLM-free structured summary of any unit (feature, file, hook, route, rule, package...) so you do not need to read source.',
    recommendedFlow: [
      'listUnits(root) or `construct summarize --list` -> discover units and refs',
      'summarizeUnit(root, ref, {detail:"brief"}) -> ~500 tokens; check health.status and next[]',
      'follow next[].ref or links.children[] with detail "standard"; use "full" only for the unit you are about to change',
      'use include:[...section names] to fetch only what you need',
    ],
    calls: {
      summarizeUnit: '(root, ref, {detail: brief|standard|full, include?: string[], kind?}) -> unit summary | {ok:false,error}',
      resolveUnit: '(root, ref, {kind?}) -> {ok,kind,id,ref} | error UNIT_AMBIGUOUS/UNIT_NOT_FOUND with candidates',
      listUnits: '(root, {kind?}) -> {kinds?, units[]}',
      listFeatures: '(root) -> {features[]}',
    },
    cli: ['construct summarize <ref> [--kind K] [--detail brief|standard|full] [--include a,b] [--format json|markdown] [--dir D]', 'construct summarize --list [--kind K]'],
    rest: ['GET /api/units?kind=', 'GET /api/units/summary?ref=&kind=&detail=&include=', 'GET /api/features', 'GET /api/features/:name/summary?detail='],
    refGrammar: 'kind:id, or a bare ref resolved by tier (exact path/name first). Examples: feature:login, hook:useLogin, features/login/hooks/useLogin.tsx, features/login/domain/Login.tsx#loginUser, /login, PAGE-006, src/ast',
    errorCodes: ['INVALID_ARGUMENT', 'UNKNOWN_KIND', 'ROOT_NOT_FOUND', 'UNIT_NOT_FOUND', 'UNIT_AMBIGUOUS', 'INTERNAL_ERROR'],
    tokenBudgets: TOKEN_BUDGETS,
    kinds: registry.kinds().map((k) => ({ kind: k.kind, description: k.description })),
  };
}

// ---- markdown rendering (generic over any kind) -----------------------------------------------
function md(value, depth = 0) {
  const pad = '  '.repeat(depth);
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v !== 'object' || v === null)) return `${pad}- ${value.length ? value.map((v) => `\`${v}\``).join(', ') : '_none_'}\n`;
    return value.map((v) => (typeof v === 'object' ? `${pad}-\n${md(v, depth + 1)}` : `${pad}- ${v}\n`)).join('');
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).map(([k, v]) => (v && typeof v === 'object' ? `${pad}- **${k}**:\n${md(v, depth + 1)}` : `${pad}- **${k}**: ${v}\n`)).join('');
  }
  return `${pad}- ${value}\n`;
}

/** Render any summary/list/error result as Markdown (for humans). */
export function renderUnitMarkdown(result) {
  if (!result.ok) return `# Error: ${result.error.code}\n\n${result.error.message}\n${result.error.candidates?.length ? `\nCandidates:\n${result.error.candidates.map((c) => `- \`${c.ref}\``).join('\n')}\n` : ''}${result.error.hint ? `\n${result.error.hint}\n` : ''}`;
  if (result.units) return `# Units${result.kind ? ` (${result.kind})` : ''}\n\n${result.units.map((u) => `- \`${u.ref}\`${u.path ? ` — ${u.path}` : ''}`).join('\n')}\n`;
  if (result.features) return `# Features\n\n${result.features.map((f) => `- \`${f.ref}\` [${f.health}] ${f.summary || ''}`).join('\n')}\n`;
  const lines = [`# ${result.kind}: ${result.name}`, '', result.summary, '', `Health: **${result.health.status}**${result.health.completeness !== undefined ? ` (completeness ${result.health.completeness})` : ''}`, ''];
  for (const f of result.health.findings || []) lines.push(`- ${f.severity}: ${f.message}`);
  for (const [k, v] of Object.entries(result.sections)) lines.push('', `## ${k}`, '', md(v).trimEnd());
  if (result.next?.length) lines.push('', '## Next', '', ...result.next.map((n) => `- \`${n.cli}\` — ${n.why}`));
  lines.push('', `_schemaVersion ${result.schemaVersion}, ~${result.budget.estimatedTokens}/${result.budget.maxTokens} tokens${result.budget.truncated ? ', truncated' : ''}_`);
  return lines.join('\n') + '\n';
}
