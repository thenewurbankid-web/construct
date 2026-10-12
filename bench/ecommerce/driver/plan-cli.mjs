#!/usr/bin/env node
// The ONLY way a Line-arm builder changes its project: Line's plan API (planService.mjs over the one tool registry)
// for one project folder, in Auto mode. Every call is recorded (calls.jsonl); every output is JSON plus one sentence.
//
//   plan-cli.mjs tools                               the plan tools a builder may add, each with its JSON Schema
//   plan-cli.mjs status                              the session plan: each step's state and sentence
//   plan-cli.mjs add <tool> '<json-args>' --why "…"  add one step; a write is approved by Auto (ct1, see below)
//   plan-cli.mjs add --fix <ref> [--why "…"]        add a typed fix the last refused add offered (f1 = recommended)
//   plan-cli.mjs run-next                            run exactly one ready step; returns its checks and typed fixes
//   plan-cli.mjs findings                            Line's view: features, items and validate findings with keys
//   plan-cli.mjs validate                            construct validate --profile line: counts and the findings
//   plan-cli.mjs read <path>                         one project file with its contentHash (for line.setCode)
//   plan-cli.mjs ls [dir]                            the entries of one project folder
//   plan-cli.mjs rules <tool> [file]                 #888: the 2-4 rules a step of that tool and layer must keep
//
// Project and log: --project <dir> (or BENCH_PROJECT), --log <file> (or BENCH_LOG; default
// bench/ecommerce/runs/<project folder name>/calls.jsonl), --builder <id> (or BENCH_BUILDER).
//
// Auto (owner's choice for the bench projects only): Cockpit's "Let Auto approve in this session" (ct1) clicks Approve
// on every step that Construct planned clean. Here the same: a step that joined the plan is approved by the session's
// person channel ('ui', as ct1's click is), and the approval is recorded in calls.jsonl as {approvedBy: "auto"}. A
// refusal is never approved: it never joins the plan (add) or ends "needs-fix"/"needs-you" (run-next) and counts
// against the builder. Nothing here writes a project file: the plan runner lands each step through Construct's writer.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLinePlanService } from '../../../packages/engine/line/planService.mjs';
import { lineToolSpecs } from '../../../packages/engine/line/planTools.mjs';
import { readLineProject } from '../../../packages/engine/line/model.mjs';
import { aggregateValidation } from '../../../packages/core/registry.mjs';
import { enforcersForRoot } from '../../../packages/core/profiles/index.mjs';
import { hashOf } from '../../../packages/engine/pagesEditor.mjs';
import { rulesCard, layerOf } from '../../../packages/engine/line/hints.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
/** Tools a builder may add (Import's tools are for bringing an existing app in, not for building one). */
export const BUILDER_TOOLS = Object.freeze(lineToolSpecs().filter((t) => !t.name.startsWith('line.import.')).map((t) => t.name));
const SKIP = new Set(['node_modules', '.next', '.git']);
const MAX_READ = 64 * 1024;

/** One plain sentence (or, for a refusal with choices, plain lines: spaces collapse inside a line, indents stay). */
const sentence = (s) => {
  const t = String(s ?? '').trim().split('\n').map((l) => l.replace(/(\S)[ \t]+/g, '$1 ').trimEnd()).filter(Boolean).join('\n');
  return /[.?!}\]]$/.test(t) ? t : `${t}.`;
};

/** A project-relative path that stays inside the project, or null. */
function inside(root, rel) {
  const p = String(rel ?? '.').replace(/^\.\/?/, '') || '.';
  if (path.isAbsolute(p) || p.split('/').some((s) => s === '..')) return null;
  const abs = path.resolve(root, p);
  return abs === root || abs.startsWith(root + path.sep) ? abs : null;
}

/**
 * One plan-cli session over a project folder.
 * @param {{project: string, log?: string, builder?: string}} o
 */
export function createPlanCli({ project, log, builder = 'unknown' }) {
  const root = fs.realpathSync(path.resolve(project));
  const logFile = log ?? path.join(here, '..', 'runs', path.basename(root), 'calls.jsonl');
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  // R1: the fixes a refused add offered, kept next to calls.jsonl (not in the project), so `add --fix f1` in the next
  // one-shot process picks from them.
  const offersFile = path.join(path.dirname(logFile), 'offered-fixes.json');
  const offers = {
    get: () => { try { return JSON.parse(fs.readFileSync(offersFile, 'utf8')).fixes; } catch { return null; } },
    set: (fixes) => { fs.writeFileSync(offersFile, `${JSON.stringify({ fixes })}\n`); },
  };
  // #886: the refusal counts per code and target (the context cap grows on a repeat), kept the same way.
  const hintFile = path.join(path.dirname(logFile), 'hint-state.json');
  const hintState = {
    get: () => { try { return JSON.parse(fs.readFileSync(hintFile, 'utf8')); } catch { return null; } },
    set: (v) => { fs.writeFileSync(hintFile, `${JSON.stringify(v)}\n`); },
  };
  const svc = createLinePlanService({ root, offers, hintState });
  // #888: a rules card is shown with the first add of each tool and layer (and on request: rules <tool> [file]).
  const cardsFile = path.join(path.dirname(logFile), 'cards-shown.json');
  const firstCard = (tool, args) => {
    const card = rulesCard(tool, args);
    if (!card.rules.length) return null;
    const key = `${tool}|${layerOf(tool, args) ?? '-'}`;
    let shown = [];
    try { shown = JSON.parse(fs.readFileSync(cardsFile, 'utf8')); } catch { shown = []; }
    if (shown.includes(key)) return null;
    try { fs.writeFileSync(cardsFile, `${JSON.stringify([...shown, key])}\n`); } catch { /* best effort */ }
    return card;
  };
  const record = (e) => fs.appendFileSync(logFile, `${JSON.stringify({ at: new Date().toISOString(), builder, ...e })}\n`);
  const brief = (s) => ({ id: s.id, n: s.n, tool: s.tool, state: s.state, sentence: s.sentence });

  const commands = {
    async tools() {
      const tools = lineToolSpecs().filter((t) => BUILDER_TOOLS.includes(t.name)).map((t) => ({ name: t.name, kind: t.kind, describe: t.describe, args: t.args }));
      return { ok: true, tools, sentence: `There are ${tools.length} plan tools; add one with: add <tool> '<json-args>' --why "<one sentence>".` };
    },
    async status() {
      const v = await svc.view();
      const steps = v.steps.map(brief);
      const counts = steps.reduce((c, s) => ({ ...c, [s.state]: (c[s.state] ?? 0) + 1 }), {});
      const open = steps.find((s) => s.state === 'needs-fix' || s.state === 'needs-you');
      const card = /** @type {any} */ (v).next?.card ?? null;
      return { ok: true, planId: v.planId, counts, steps, ...(card ? { card } : {}), sentence: [open ? `Step ${open.n} needs a fix first: ${open.sentence}` : `The plan has ${steps.length} steps.`, card?.text].filter(Boolean).join('\n') };
    },
    async add(tool, json, why, fix) {
      let args;
      if (fix) args = {};
      else { try { args = json ? JSON.parse(json) : {}; } catch (e) { return { ok: false, code: 'BAD_JSON', sentence: `The arguments are not JSON: ${/** @type {Error} */ (e).message}` }; } }
      const r = /** @type {any} */ (await svc.addStep(fix ? { fix, why } : { tool, args, why }, 'agent'));
      if (!r.ok) {
        // #885: the plan service shapes every refusal (hints.mjs): what was wrong, the rule, the choices with their refs
        // (f1 is the recommended one; `add --fix f1`, plan_add {"fix": "f1"}) or a correct call. Writing the step out
        // (add <tool> '<args>') still works.
        const fixes = Array.isArray(r.fixes) ? r.fixes.map((f, i) => ({ ref: f.ref, id: f.id, sentence: f.sentence, step: f.step, ...(i === 0 ? { recommended: true } : {}), ...(f.why ? { why: f.why } : {}), ...(f.effect ? { effect: f.effect } : {}), ...(f.context?.length ? { context: f.context } : {}) })) : [];
        const card = !fix && tool && BUILDER_TOOLS.includes(tool) ? firstCard(tool, args) : null;
        return { ok: false, code: r.code, sentence: [r.text ?? r.sentence, card?.text].filter(Boolean).join('\n'), ...(r.detail ? { detail: r.detail } : {}), ...(fixes.length ? { fixes } : {}), ...(r.hintContext ? { hintContext: r.hintContext } : {}), ...(card ? { card } : {}) };
      }
      const step = r.steps.find((s) => s.id === r.stepId);
      const card = step ? firstCard(step.tool, step.args) : null;
      const withCard = (o) => (card ? { ...o, sentence: `${o.sentence}\n${card.text}`, card } : o);
      if (step?.state === 'waiting') {
        const a = /** @type {any} */ (await svc.approve(r.stepId, 'ui'));
        if (!a.ok) return { ok: false, code: a.code, sentence: `The step joined the plan, but Auto could not approve it: ${a.sentence}`, stepId: r.stepId };
        record({ kind: 'approval', stepId: r.stepId, tool: step.tool, ...(fix ? { fix } : {}), approvedBy: 'auto', mechanism: 'ct1 Let Auto approve in this session' });
        return withCard({ ok: true, stepId: r.stepId, state: 'ready', approvedBy: 'auto', sentence: `Step ${step.n} joined the plan and Auto approved it; run-next lands it.` });
      }
      return withCard({ ok: true, stepId: r.stepId, state: step?.state ?? null, sentence: `Step ${step?.n} joined the plan: ${step?.sentence ?? ''}` });
    },
    async 'run-next'() {
      const before = await svc.view();
      const open = new Set(before.steps.filter((s) => s.state === 'ready' || s.state === 'waiting').map((s) => s.id));
      const r = /** @type {any} */ (await svc.runNext('agent'));
      if (!r.ok) return { ok: false, code: r.code, sentence: r.text ?? r.sentence, ...(Array.isArray(r.fixes) && r.fixes.length ? { fixes: r.fixes.map((f, i) => ({ ref: f.ref, id: f.id, sentence: f.sentence, step: f.step, ...(i === 0 ? { recommended: true } : {}), why: f.why, effect: f.effect, ...(f.context ? { context: f.context } : {}) })) } : {}), ...(r.hintContext ? { hintContext: r.hintContext } : {}) };
      const ran = r.steps.find((s) => open.has(s.id) && s.state !== 'ready' && s.state !== 'waiting');
      if (!ran) return { ok: true, sentence: sentence(r.message ?? 'Nothing ran.') };
      const res = ran.result ?? {};
      const options = (res.options ?? []).map((o) => ({ id: o.id, sentence: o.sentence, ...(o.step ? { step: o.step } : {}), ...(o.recommended ? { recommended: true } : {}) }));
      const findings = (res.apply?.findings ?? []).slice(0, 8).map((f) => ({ rule: f.rule, severity: f.severity, file: f.file, line: f.line, sentence: f.sentence }));
      return {
        ok: true, stepId: ran.id, n: ran.n, tool: ran.tool, state: ran.state, landed: ran.state === 'done' && res.needsYou !== true,
        files: res.apply?.files ?? [], checks: res.checks ?? [], findings, options, ...(r.recheck ? { recheck: r.recheck } : {}),
        // #885: a step that needs a fix offers its choices like a refused add (r.needs: refs f1.., {"fix": "f1"}).
        ...(r.needs?.stepId === ran.id ? { fixes: r.needs.fixes.map((f, i) => ({ ref: f.ref, id: f.id, sentence: f.sentence, step: f.step, ...(i === 0 ? { recommended: true } : {}), why: f.why, effect: f.effect, ...(f.context ? { context: f.context } : {}) })), hintContext: r.needs.hintContext } : {}),
        sentence: r.needs?.stepId === ran.id ? r.needs.text : sentence(ran.sentence),
      };
    },
    async findings() {
      const p = readLineProject(root);
      const features = p.features.map((f) => ({ name: f.name, spec: f.spec, items: f.items.map((i) => ({ id: i.id, file: i.file, base: i.base?.libraryId ?? null })) }));
      const findings = p.findings.slice(0, 40).map((f) => ({ key: f.key, rule: f.rule, severity: f.severity, file: f.file, sentence: f.sentence, ...(f.fixes ? { fixes: f.fixes } : {}) }));
      return { ok: true, library: p.library.map((l) => l.id), features, findings, sentence: `${p.library.length} library items, ${features.length} features, ${p.findings.length} findings.` };
    },
    async validate() {
      const v = aggregateValidation(root, enforcersForRoot(root)).violations;
      const errors = v.filter((x) => x.severity === 'error').length;
      const warnings = v.filter((x) => x.severity === 'warning').length;
      return { ok: true, errors, warnings, findings: v.slice(0, 40).map((x) => ({ rule: x.rule, severity: x.severity, file: x.file, line: x.line, message: x.message })), sentence: `Validate (profile line): ${errors} errors, ${warnings} warnings.` };
    },
    async read(rel) {
      const abs = inside(root, rel);
      if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) return { ok: false, code: 'NOT_FOUND', sentence: `There is no file ${rel} in the project.` };
      const content = fs.readFileSync(abs, 'utf8');
      if (content.length > MAX_READ) return { ok: false, code: 'TOO_BIG', sentence: `${rel} is over 64 KB.` };
      return { ok: true, path: path.relative(root, abs), contentHash: hashOf(content), content, sentence: `Read ${path.relative(root, abs)} (${content.split('\n').length} lines); pass contentHash to line.setCode to replace it.` };
    },
    async rules(tool, file) {
      if (!BUILDER_TOOLS.includes(String(tool))) return { ok: false, code: 'UNKNOWN_TOOL', sentence: `There is no plan tool ${tool ?? ''}; use one of ${BUILDER_TOOLS.filter((t) => t.startsWith('line.')).slice(0, 12).join(', ')}, ...` };
      const card = rulesCard(String(tool), file ? { file, page: file } : {});
      return { ok: true, card, sentence: card.text || `Line has no rules card for ${tool}.` };
    },
    async ls(rel = '.') {
      const abs = inside(root, rel);
      if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) return { ok: false, code: 'NOT_FOUND', sentence: `There is no folder ${rel} in the project.` };
      const entries = fs.readdirSync(abs, { withFileTypes: true }).filter((e) => !SKIP.has(e.name)).map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).sort();
      return { ok: true, path: path.relative(root, abs) || '.', entries, sentence: `${entries.length} entries.` };
    },
  };

  /**
   * Run one command; never throws (a crash is a JSON refusal). Every call is recorded.
   * @param {string} cmd @param {string[]} rest positional args @param {{why?: string, fix?: string}} [opts]
   * @returns {Promise<any>}
   */
  async function run(cmd, rest = [], opts = {}) {
    const t0 = Date.now();
    let out;
    try {
      if (!Object.hasOwn(commands, cmd)) out = { ok: false, code: 'UNKNOWN_COMMAND', sentence: `There is no command ${cmd}; use one of ${Object.keys(commands).join(', ')}.` };
      else if (cmd === 'add') out = await commands.add(rest[0], rest[1], opts.why, opts.fix);
      else out = await commands[cmd](...rest);
    } catch (e) {
      out = { ok: false, code: 'CRASH', sentence: `plan-cli failed: ${/** @type {Error} */ (e).message}` };
    }
    out.sentence = sentence(out.sentence);
    const summary = { ok: out.ok, code: out.code ?? null, sentence: out.sentence, stepId: out.stepId ?? null, state: out.state ?? null, landed: out.landed ?? null, tool: out.tool ?? (cmd === 'add' ? rest[0] : null), rules: (out.findings ?? []).filter((f) => f.severity === 'error').map((f) => f.rule),
      // What the builder was offered, so calls.jsonl (and Mission Control) show the choices next to what it sent.
      // #886: and why, what each does, the context lines and every candidate line with its static score (jev's data).
      ...(Array.isArray(out.fixes) && out.fixes.length ? { fixes: out.fixes.map((f) => ({ ref: f.ref, id: f.id, sentence: f.sentence, step: f.step, recommended: f.recommended === true, ...(f.why ? { why: f.why } : {}), ...(f.effect ? { effect: f.effect } : {}), ...(f.context ? { context: f.context } : {}) })) } : {}),
      ...(Array.isArray(out.options) && out.options.some((o) => o.step) ? { options: out.options } : {}),
      ...(out.hintContext ? { context: out.hintContext } : {}),
      ...(out.card ? { card: { tool: out.card.tool, layer: out.card.layer, rules: out.card.rules.map((x) => x.id) } } : {}),
      // Exactly what the model was shown (the text it reads; the JSON fields around it are in the tool result too).
      ...(out.ok === false || out.fixes || out.card ? { shown: out.sentence } : {}) };
    record({ kind: 'call', cmd, args: cmd === 'add' ? { tool: rest[0] ?? null, args: safeJson(rest[1]), why: opts.why ?? null, ...(opts.fix ? { fix: opts.fix } : {}) } : rest, ms: Date.now() - t0, result: summary });
    // The candidate lines and their scores are for the log (and jev), not for the builder.
    delete out.hintContext;
    return out;
  }
  return { run, root, logFile };
}

const safeJson = (s) => { try { return JSON.parse(s); } catch { return s ?? null; } };

/** argv -> {cmd, rest, why, project, log, builder}. */
export function parseArgv(argv) {
  const o = { cmd: '', rest: /** @type {string[]} */ ([]), why: undefined, fix: undefined, project: process.env.BENCH_PROJECT, log: process.env.BENCH_LOG, builder: process.env.BENCH_BUILDER };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--why') o.why = argv[++i];
    else if (a === '--fix') o.fix = argv[++i];
    else if (a === '--project') o.project = argv[++i];
    else if (a === '--log') o.log = argv[++i];
    else if (a === '--builder') o.builder = argv[++i];
    else if (!o.cmd) o.cmd = a;
    else o.rest.push(a);
  }
  return o;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const o = parseArgv(process.argv.slice(2));
  if (!o.project || !o.cmd) {
    console.log(JSON.stringify({ ok: false, sentence: 'Usage: plan-cli.mjs --project <dir> <tools|status|add|run-next|findings|validate|read|ls|rules> [...] (or set BENCH_PROJECT).' }));
    process.exit(2);
  }
  const cli = createPlanCli({ project: o.project, log: o.log, builder: o.builder });
  const out = await cli.run(o.cmd, o.rest, { why: o.why, fix: o.fix });
  console.log(JSON.stringify(out, null, 1));
  process.exit(out.ok ? 0 : 1);
}
