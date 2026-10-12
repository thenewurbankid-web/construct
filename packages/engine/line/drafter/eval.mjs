// Eval harness for the System 1 drafter. Takes ANY corpus of {project dir, request, gold routes, gold labels} in the
// delexicalized form (eval/corpus.json documents it; a generated corpus of imaginary projects plugs in the same way),
// lexicalizes each request from the project's facts, drafts, and scores:
//   normalized   share of requests fully normalized without a question
//   labels       classifier label recall: intent id exact, gold layers within the labelled layers, target right
//   recall       route recall: every gold route found (steps match, order-insensitive, '*' = any)
//   precision    shown routes (not refused or dropped) that are gold routes
//   preferred    the recommended route is the gold preferred one
//   noRepair     the recommended route passed Construct's checks (expressions + structure hash) with no repair
//   defer        the drafter deferred (model / question) exactly when the gold says it should
//   safeDefer    when its recommendation is not the gold one, the drafter deferred (it knows when it does not know)
//   hashMiss     verified routes whose structure hash did not match the prediction
// Reported overall, per split (the dev project vs held-out whole projects), held-out paraphrases, and per family.
//   node packages/engine/line/drafter/eval.mjs [corpus.json] [--json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLineProject } from '../model.mjs';
import { factsSummary } from '../facts.mjs';
import { splitWords, bind } from './domainMap.mjs';
import { draft, boundRoute } from './index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_CORPUS = path.join(HERE, 'eval/corpus.json');
export const REPO_ROOT = path.resolve(HERE, '../../../..');

const byName = (a, b) => String(a.name ?? a.id).localeCompare(String(b.name ?? b.id));

/**
 * Resolve one structural selector against a project's facts summary (no names are stored in a corpus).
 * @param {string} sel  feature#i | library:<kind>#i | item:feature#i/<kind>#j | prop:<item selector>#k | fragprop:<item selector>#k | finding:<RULE> | lit:<text>
 * @param {ReturnType<typeof factsSummary>} s
 * @returns {any}
 */
export function resolveSelector(sel, s) {
  const m = /^(\w+):(.*)$/.exec(sel) ?? [null, sel.split('#')[0], sel];
  const [, kind, rest] = m;
  const idx = (x) => Number(String(x).split('#').pop());
  if (sel.startsWith('feature#')) return s.features.map((f) => f.name).sort()[idx(sel)];
  if (kind === 'lit') return rest;
  if (kind === 'library') { const [k, i] = rest.split('#'); const l = s.library.filter((x) => x.kind === k).sort((a, b) => a.id.localeCompare(b.id))[Number(i)]; return l && { id: l.id, name: l.name, kind: l.kind, file: l.file }; }
  if (kind === 'item') {
    const [fsel, ks] = rest.split('/');
    const f = resolveSelector(fsel, s);
    const [k, j] = ks.split('#');
    const it = s.features.find((x) => x.name === f)?.items.filter((i) => i.kind === k).sort(byName)[Number(j)];
    return it && { id: it.id, name: it.name, kind: it.kind, feature: f, file: it.file, base: it.base };
  }
  if (kind === 'prop' || kind === 'fragprop') {
    const cut = rest.lastIndexOf('#');
    const item = resolveSelector(rest.slice(0, cut), s);
    const names = kind === 'prop'
      ? [...new Set((s.pages.find((p) => p.item === item?.id)?.parts ?? []).flatMap((x) => x.props.map((p) => p.name)))].sort()
      : [...new Set(s.fragments.filter((g) => g.item === item?.id).map((g) => g.id.split(':').pop()))].sort();
    const n = names[Number(rest.slice(cut + 1))];
    return n && { id: n, name: n };
  }
  if (kind === 'finding') { const x = s.findings.find((f) => f.rule === rest); return x && { id: x.key, ...Object.fromEntries(x.fixes.map((y, i) => [`fix${i + 1}`, y.id])) }; }
  throw new Error(`Unknown selector ${sel}`);
}

/**
 * Turn a corpus request into the words a person would type on this project.
 * @param {string} request  e.g. "set the <prop:A1> of the <page:P1~words> to <value:V1>"
 * @param {Record<string, any>} b  slot -> resolved value
 * @returns {string}
 */
export function lexicalize(request, b) {
  return request.replace(/<([a-z-]+):([A-Z]\d+)(~words)?>/g, (m, kind, s, words) => {
    const v = b[s];
    if (v === undefined) throw new Error(`Slot ${s} has no fill`);
    const name = typeof v === 'object' ? v.name : String(v);
    if (kind === 'value') return `"${name}"`;
    if (kind === 'code') return `\`${name}\``;
    return words ? splitWords(name).join(' ') : name;
  });
}

/**
 * Whether predicted steps (bound) match gold steps (bound; '*' or an unfilled slot = any value), in any order.
 * @param {{tool: string, args: Record<string, unknown>}[]} gold
 * @param {{tool: string, args: Record<string, unknown>}[]} got
 * @returns {boolean}
 */
export function stepsMatch(gold, got) {
  if (gold.length !== got.length) return false;
  const used = new Set();
  return gold.every((g) => {
    const i = got.findIndex((x, k) => !used.has(k) && x.tool === g.tool && Object.keys(g.args).length === Object.keys(x.args).length && Object.entries(g.args).every(([k, v]) => v === '*' || (typeof v === 'string' && /^<[A-Z]\d+(\.\w+)?>$/.test(v)) || x.args[k] === v));
    if (i < 0) return false;
    used.add(i);
    return true;
  });
}

/**
 * Score one case.
 * @param {any} c  A corpus case.
 * @param {string} root  The project root.
 * @param {{verify?: boolean}} [o]
 * @returns {any}
 */
export function scoreCase(c, root, o = {}) {
  const s = factsSummary(root, readLineProject(root));
  const fill = Object.fromEntries(Object.entries(c.fill).map(([k, sel]) => [k, resolveSelector(sel, s)]));
  const text = lexicalize(c.request, fill);
  const d = draft(root, text, { verify: o.verify !== false, records: [] });
  const g = c.gold;
  const goldRoutes = g.routes.map((r) => bind(r, fill));
  const shown = d.routes.filter((r) => r.status !== 'refused');
  const bound = d.routes.map((r) => ({ r, steps: boundRoute(d, r.id).steps }));
  const found = goldRoutes.map((gr) => bound.find((x) => stepsMatch(gr, x.steps)) ?? null);
  const shownGold = shown.filter((r) => goldRoutes.some((gr) => stepsMatch(gr, boundRoute(d, r.id).steps)));
  const layerSet = new Set(d.labels.layers.filter((l) => l.confidence >= 0.2).map((l) => l.layer));
  const targetOk = g.target === null ? true : d.labels.target !== null && JSON.stringify(bind(`<${d.labels.target}>`, d.bindings)) === JSON.stringify(bind(`<${g.target}>`, fill));
  const rec = d.recommended ? d.routes.find((r) => r.id === d.recommended) : null;
  const recSteps = rec ? boundRoute(d, rec.id).steps : null;
  // im1: offered and gold routes as slotted signatures (tool chains), for the rule factory's absent / picked split.
  const goldSig = (gr) => gr.map((s) => s.tool).join(' + ');
  const sigOf = (steps) => { const gr = goldRoutes.find((x) => stepsMatch(x, steps)); return gr ? goldSig(gr) : `${steps.map((s) => s.tool).join(' + ') || 'nothing'} (other)`; };
  return {
    gold: goldRoutes.map((gr, i) => ({ sig: goldSig(gr), step: gr[0]?.tool ?? 'none', outcome: 'change', preferred: g.preferred === i, found: Boolean(found[i]) })),
    offered: [...new Set(bound.map((x) => sigOf(x.steps)))],
    chosen: recSteps ? sigOf(recSteps) : null,
    id: c.id, project: c.project, family: c.family, heldOut: !!c.heldOut, request: c.request,
    normalized: d.questions.length === 0,
    intentOk: d.labels.intent.id === g.intent,
    layersOk: g.layers.every((l) => layerSet.has(l)),
    targetOk,
    recall: goldRoutes.length ? found.filter(Boolean).length / goldRoutes.length : d.routes.length === 0 ? 1 : 0,
    precision: shown.length ? shownGold.length / shown.length : 1,
    preferredOk: g.preferred === null ? rec === null || goldRoutes.some((gr) => stepsMatch(gr, /** @type {any} */ (recSteps))) : !!recSteps && stepsMatch(goldRoutes[g.preferred], recSteps),
    noRepair: rec?.status === 'ok',
    deferOk: (d.defer.to !== null) === g.defer,
    deferred: d.defer.to,
    hashMiss: d.routes.filter((r) => r.status === 'wrong-shape').length,
    routes: d.routes.map((r) => `${r.id}:${r.status}`),
    missing: found.map((x, i) => (x ? null : i)).filter((x) => x !== null),
  };
}

const AGG = ['normalized', 'intentOk', 'layersOk', 'targetOk', 'recall', 'precision', 'preferredOk', 'noRepair', 'deferOk'];
/** Mean of each metric over results. */
function aggregate(rs) {
  const out = { n: rs.length };
  for (const k of AGG) out[k] = rs.length ? Math.round((rs.reduce((a, r) => a + Number(r[k]), 0) / rs.length) * 1000) / 1000 : null;
  out.labels = rs.length ? Math.round((rs.filter((r) => r.intentOk && r.layersOk && r.targetOk).length / rs.length) * 1000) / 1000 : null;
  out.deferRate = rs.length ? Math.round((rs.filter((r) => r.deferred !== null).length / rs.length) * 1000) / 1000 : null;
  const wrong = rs.filter((r) => !r.preferredOk);
  out.safeDefer = wrong.length ? Math.round((wrong.filter((r) => r.deferred !== null).length / wrong.length) * 1000) / 1000 : null;
  out.hashMiss = rs.reduce((a, r) => a + r.hashMiss, 0);
  return out;
}

/**
 * Run a corpus. Projects are resolved relative to `repoRoot`.
 * @param {any} corpus
 * @param {{repoRoot?: string, verify?: boolean, only?: (c: any) => boolean}} [o]
 * @returns {{results: any[], overall: any, bySplit: Record<string, any>, heldOutRequests: any, byFamily: Record<string, any>, byFamilySplit: Record<string, any>}}
 */
export function runEval(corpus, o = {}) {
  const repoRoot = o.repoRoot ?? REPO_ROOT;
  const cases = corpus.cases.filter(o.only ?? (() => true));
  const results = cases.map((c) => {
    const p = corpus.projects[c.project];
    return { ...scoreCase(c, path.resolve(repoRoot, p.dir), o), split: p.split };
  });
  const group = (key) => Object.fromEntries([...new Set(results.map(key))].sort().map((k) => [k, aggregate(results.filter((r) => key(r) === k))]));
  return {
    results,
    overall: aggregate(results),
    bySplit: group((r) => r.split),
    heldOutRequests: aggregate(results.filter((r) => r.heldOut)),
    byFamily: group((r) => r.family),
    byFamilySplit: group((r) => `${r.family} / ${r.split}`),
  };
}

const pct = (x) => (x === null ? '-' : `${Math.round(x * 100)}%`);
/**
 * The report as a Markdown table.
 * @param {ReturnType<typeof runEval>} rep
 * @returns {string}
 */
export function formatReport(rep) {
  const head = '| group | n | normalized | labels (intent / layers / target) | route recall | precision | preferred | checks pass, no repair | defer right | defer rate | deferred when wrong | hash misses |\n|---|---|---|---|---|---|---|---|---|---|---|---|';
  const row = (name, a) => `| ${name} | ${a.n} | ${pct(a.normalized)} | ${pct(a.labels)} (${pct(a.intentOk)} / ${pct(a.layersOk)} / ${pct(a.targetOk)}) | ${pct(a.recall)} | ${pct(a.precision)} | ${pct(a.preferredOk)} | ${pct(a.noRepair)} | ${pct(a.deferOk)} | ${pct(a.deferRate)} | ${pct(a.safeDefer)} | ${a.hashMiss} |`;
  return [head, row('all', rep.overall), ...Object.entries(rep.bySplit).map(([k, a]) => row(`split: ${k}`, a)), row('held-out paraphrases', rep.heldOutRequests), ...Object.entries(rep.byFamily).map(([k, a]) => row(k, a))].join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const file = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? DEFAULT_CORPUS;
  const rep = runEval(JSON.parse(fs.readFileSync(file, 'utf8')));
  if (process.argv.includes('--json')) console.log(JSON.stringify(rep, null, 2));
  else {
    console.log(formatReport(rep));
    console.log('\nMisses:');
    for (const r of rep.results) {
      const bad = ['normalized', 'intentOk', 'layersOk', 'targetOk', 'preferredOk', 'deferOk'].filter((k) => !r[k]);
      if (bad.length || r.recall < 1 || r.precision < 1) console.log(`  ${r.id} [${r.split}${r.heldOut ? ', held-out' : ''}] ${r.request}: ${bad.join(', ')}${r.recall < 1 ? ` recall ${pct(r.recall)} (missing gold ${r.missing})` : ''}${r.precision < 1 ? ` precision ${pct(r.precision)}` : ''} -> ${r.routes.join(' ')}`);
    }
  }
}
