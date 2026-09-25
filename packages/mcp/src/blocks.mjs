// The eight tools as plain functions over Construct's existing blocks (#649). Each takes `(ctx, input)` and returns a fixed-size,
// path-free object, or throws a `ToolError`. None writes: no file, no plan applied, no command run. `ctx` is what the server was
// started with, `{ root, allowPlugins, clientName() }`. The core modules are imported inside each function so that starting the
// server (and answering `tools/list`) loads none of them.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ToolError, LIMITS } from './limits.mjs';
import { assertContained, assertFeatureName, planEscapes } from './guard.mjs';

/** The sentence every plan preview ends with: a tool never applies what it plans. */
export const APPLY_NOTE = "Nothing was written. Apply a plan through the Cockpit's per-diff approval, or with `construct` and an explicit approve step.";

const cut = (text, max) => {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
};

const kebab = (name) => String(name).replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

const firstMessage = (errors, fallback) => cut(errors?.[0]?.message ?? fallback, LIMITS.lineChars);

/** The project's configuration, or a typed refusal when its architecture.yml cannot be read. */
async function readConfig(root) {
  const { loadConfig } = await import('@line/construct-core/config');
  try {
    return loadConfig(root);
  } catch (e) {
    throw new ToolError('CONFIG_UNREADABLE', `This project's architecture.yml could not be read: ${cut(String(e?.message ?? e).split('\n')[0], LIMITS.lineChars)}`);
  }
}

/** A closed question as a client sees it: the chooser summary, with where it came from. */
const asQuestion = (source, q) => ({
  id: q.id,
  source,
  question: cut(q.question, 160),
  options: (q.options ?? []).slice(0, 5).map((o) => ({ id: o.id, label: cut(o.label, 60), enabled: o.enabled !== false, why: cut(o.why, 120) })),
  chosen: q.chosen ?? null,
  ...(q.suggestion ? { suggestion: { option: q.suggestion.option, reason: cut(q.suggestion.reason, 120) } } : {}),
  ...(q.default ? { default: q.default } : {}),
});

const parseSentence = async (text) => {
  const { parseRequirement } = await import('@line/construct-core/requirement-card');
  const parsed = parseRequirement(text);
  if (!parsed.card) throw new ToolError('PARSE_FAILED', firstMessage(parsed.errors, 'The requirement could not be read.'));
  return parsed.card;
};

// ------------------------------------------------------------------------------------------------------ requirement_parse

/**
 * `requirement_parse`: a sentence becomes a requirement card (`parseRequirement`). The card is returned as its fixed-size summary
 * (nouns, verbs, checks, read-back lines) and every word the lexicon does not know as a closed question of 2 to 5 options.
 *
 * @param {object} ctx The server's startup configuration (unused: this tool reads no file).
 * @param {{ text: string }} input The requirement, at most `LIMITS.textChars` characters.
 * @returns {Promise<object>} `{ ok, card, questions, complete, next }`.
 * @throws {ToolError} `PARSE_FAILED` when the text cannot be read as a requirement.
 *
 * @example
 * await requirementParse(ctx, { text: 'A user wants to see a list of products' }); // => { ok: true, card: { counts: { nouns: 2, verbs: 1 } }, questions: [], complete: true }
 */
export async function requirementParse(ctx, { text }) {
  const { openQuestion, cardSummary } = await import('@line/construct-core/requirement-card');
  const card = await parseSentence(text);
  const questions = card.open.slice(0, LIMITS.questions).map((item) => asQuestion('card', openQuestion(card, item)));
  return {
    ok: true,
    card: cardSummary(card),
    questions,
    complete: card.open.length === 0,
    next: card.open.length ? 'Answer the questions (ids o1, o2, ...) in the answers of placement_place, with the same text.' : 'Call placement_place with the same text.',
  };
}

// -------------------------------------------------------------------------------------------------------- placement_place

const stepPreview = (step) => ({
  id: step.id,
  flow: step.flow,
  title: cut(step.title, 120),
  ...(step.dependsOn?.length ? { dependsOn: step.dependsOn.slice(0, 12) } : {}),
  files: (step.touches?.files ?? []).slice(0, LIMITS.previewFiles).map((f) => ({ path: f.path, change: f.change })),
});

const capKeyed = (record, max = LIMITS.previewFiles) => Object.fromEntries(Object.entries(record ?? {}).slice(0, LIMITS.keyed).map(([k, v]) => [k, v.slice(0, max)]));

/**
 * `placement_place`: the sentence and the answers given so far go through `parseRequirement`, `placeCard` and, when nothing is
 * left open, `planFromBlocks`. The result is what the Cockpit's requirement screen shows: the blocks, the closed questions and
 * offers still open, and a preview of the plan with the files each step would touch, its proof and its wiring. A word the
 * lexicon does not know is a question first and nothing is placed until it is answered. The answers are recorded as `by: 'llm'`
 * with the MCP client's name in the returned `decisions`; nothing is written to the decision traces. The plan is never applied.
 *
 * @param {{ root: string, clientName: () => string | undefined }} ctx The server's startup configuration.
 * @param {{ text: string, answers?: { id: string, option: string }[] }} input The requirement and the answers (`o1`... for words, `q-shape`, `q-dependency`, `q-route`, `q-source`, `q-env`, `q-verify`, `q-steps`, `q-states`, `q-access`, `q-state`, `q-handler`, `q-v1`... for placement).
 * @returns {Promise<object>} `{ ok, stage, complete, card, blocks, questions, offers, decisions, plan, files, proof, wiring, env, guards, stores, stores, verify, warnings, notes, apply }`.
 * @throws {ToolError} `PARSE_FAILED`, `ANSWER_REFUSED`, `PLACEMENT_REFUSED`, `PLAN_REFUSED`, `CONFIG_UNREADABLE` or `PATH_OUTSIDE_ROOT`.
 *
 * @example
 * await placementPlace(ctx, { text: 'A user wants to see a list of products' }); // => { ok: true, stage: 'planned', plan: { steps: [...] }, ... }
 */
export async function placementPlace(ctx, { text, answers = [] }) {
  const { resolveOpen, openQuestion, cardSummary } = await import('@line/construct-core/requirement-card');
  const { placeCard, planFromBlocks, blockLines } = await import('@line/construct-core/placement');
  let card = await parseSentence(text);
  const attribution = { by: 'llm', ...(ctx.clientName?.() ? { provider: ctx.clientName() } : {}) };

  const placementAnswers = {};
  const wiringAnswers = {};
  for (const a of answers) {
    if (/^o\d{1,3}$/.test(a.id)) {
      const r = resolveOpen(card, { [a.id]: a.option });
      if (!r.ok) throw new ToolError('ANSWER_REFUSED', firstMessage(r.errors, 'That answer was not accepted.'));
      card = r.card;
    } else if (/^q-(?:dependency|route|source|env|verify|steps|states|access|state|handler)(?:-[a-z0-9-]+)?$/.test(a.id)) wiringAnswers[a.id] = { option: a.option, ...attribution };
    else placementAnswers[a.id] = { option: a.option, ...attribution };
  }

  const base = { ok: true, card: cardSummary(card) };
  if (card.open.length) {
    const questions = card.open.slice(0, LIMITS.questions).map((item) => asQuestion('card', openQuestion(card, item)));
    return { ...base, stage: 'card-questions', complete: false, questions, offers: [], blocks: [], plan: null, apply: APPLY_NOTE };
  }

  assertContained(ctx.root);
  const config = await readConfig(ctx.root);
  const placement = placeCard(card, { layers: config.layers, framework: config.project?.framework, answers: placementAnswers });
  if (!placement.ok) throw new ToolError('PLACEMENT_REFUSED', firstMessage(placement.errors, 'The requirement could not be placed.'), { errors: placement.errors.slice(0, 5).map((e) => ({ code: e.code, message: cut(e.message, LIMITS.lineChars) })) });
  const questions = placement.open.slice(0, LIMITS.questions).map((q) => asQuestion('placement', q));
  const offers = (placement.offers ?? []).slice(0, LIMITS.questions).map((q) => asQuestion('placement', q));
  const out = {
    ...base,
    stage: placement.complete ? 'planned' : 'placement-questions',
    complete: placement.complete,
    blocks: blockLines(placement).slice(0, 8).map((l) => cut(l.line, 140)),
    questions,
    offers,
    decisions: placement.decisions.slice(0, LIMITS.questions),
    plan: null,
    warnings: [],
    notes: placement.notes.slice(0, 3).map((n) => cut(n, 240)),
    apply: APPLY_NOTE,
  };
  if (!placement.complete) return out;

  const screen = placement.blocks.flatMap((b) => b.layers).find((l) => l.layer === 'page' || l.layer === 'controller')?.name ?? 'Requirement';
  const feature = kebab(screen);
  const planned = planFromBlocks(placement.blocks, { feature, root: ctx.root, title: `Requirement: ${text.trim().slice(0, 80)}`, decisions: placement.decisions, answers: wiringAnswers, card });
  if (!planned.ok) throw new ToolError('PLAN_REFUSED', firstMessage(planned.errors, 'The blocks could not be compiled to a plan.'), { errors: planned.errors.slice(0, 5).map((e) => ({ code: e.code, message: cut(e.message, LIMITS.lineChars) })) });
  const wiringOffers = (planned.offers ?? []).filter((q) => !offers.some((o) => o.id === q.id)).map((q) => asQuestion('placement', q));
  const featuresRoot = config.features?.root ?? 'features';
  return {
    ...out,
    offers: [...offers, ...wiringOffers].slice(0, LIMITS.questions),
    decisions: planned.decisions.slice(0, LIMITS.questions),
    plan: { feature, stepCount: planned.plan.steps.length, steps: planned.plan.steps.slice(0, LIMITS.previewSteps).map(stepPreview), truncated: planned.plan.steps.length > LIMITS.previewSteps },
    files: capKeyed(planned.files),
    proof: planned.proof ?? null,
    wiring: planned.wiring
      ? { dependency: planned.wiring.dependency, sync: planned.wiring.sync, routes: planned.wiring.routes.slice(0, 5).map((r) => ({ name: r.name, route: r.route, step: r.step, file: r.file })) }
      : null,
    env: (planned.env ?? []).slice(0, 5).map((e) => ({ variable: e.variable, scope: e.scope, question: e.question, step: e.step })),
    guards: (planned.guards ?? []).slice(0, 5).map((g) => ({ name: g.name, access: g.access, roles: g.roles, question: g.question, step: g.step })),
    stores: (planned.stores ?? []).slice(0, 5).map((st) => ({ name: st.name, shape: st.shape, question: st.question, step: st.step })),
    verify: planned.verify ?? null,
    warnings: [...(fs.existsSync(path.join(ctx.root, featuresRoot, feature)) ? [`The feature "${feature}" already exists in this project, so the "Create feature ${feature}" step would be refused.`] : []), ...(planned.warnings ?? []).slice(0, 3).map((w) => cut(w, 240))],
    notes: [...out.notes, ...(planned.notes ?? []).slice(0, 3).map((n) => cut(n, 240))].slice(0, 5),
  };
}

// ---------------------------------------------------------------------------------------------------------- plan_validate

/**
 * `plan_validate`: `validatePlan` on a plan an LLM (or a person) wrote, with a preview of what each step touches. Pure: the plan is
 * checked, never run. A plan that names a path outside the project (an absolute path or a `..` in a step's files or path arguments)
 * is refused before it is checked.
 *
 * @param {object} ctx The server's startup configuration (unused: the plan is checked as data).
 * @param {{ plan: object }} input The plan, at most `LIMITS.planBytes` as JSON.
 * @returns {Promise<object>} `{ ok, valid, errorCount, errors, stepCount, steps, truncated, apply }`.
 * @throws {ToolError} `INVALID_INPUT` for a plan that is too large, `PATH_OUTSIDE_ROOT` for a path that leaves the project.
 *
 * @example
 * await planValidate(ctx, { plan: { version: 1, ticket: { source: 'text', title: 'x' }, steps: [] } }); // => { ok: true, valid: false, errorCount: 1, ... }
 */
export async function planValidate(ctx, { plan }) {
  const { validatePlan } = await import('@line/construct-core/plan');
  let size;
  try {
    size = JSON.stringify(plan).length;
  } catch {
    throw new ToolError('INVALID_INPUT', 'The plan is not JSON.');
  }
  if (size > LIMITS.planBytes) throw new ToolError('INVALID_INPUT', `The plan is larger than ${LIMITS.planBytes} bytes.`);
  if (Array.isArray(plan?.steps) && plan.steps.length > LIMITS.planSteps) throw new ToolError('INVALID_INPUT', `The plan has more than ${LIMITS.planSteps} steps.`);
  if (planEscapes(plan) !== null) throw new ToolError('PATH_OUTSIDE_ROOT', 'A step names a path outside the project root (an absolute path, "~" or "..") and was refused before anything was checked.');
  const result = validatePlan(plan);
  const steps = Array.isArray(plan?.steps) ? plan.steps.filter((s) => s && typeof s === 'object') : [];
  return {
    ok: true,
    valid: result.valid,
    errorCount: result.errors.length,
    errors: result.errors.slice(0, 20).map((e) => ({ code: e.code, path: cut(e.path, 80), message: cut(e.message, LIMITS.lineChars) })),
    stepCount: steps.length,
    steps: result.valid ? steps.slice(0, LIMITS.previewSteps).map(stepPreview) : [],
    truncated: result.errors.length > 20 || steps.length > LIMITS.previewSteps,
    apply: APPLY_NOTE,
  };
}

// ---------------------------------------------------------------------------------------------------------------- decide

/**
 * `decide`: the project's decision provider suggests which option to take, the same rules as `construct decide`. Give either a
 * question summary (`{ id, question, options: [{ id, label, enabled, why }] }`, at most 5 options) or a requirement sentence
 * (every open question and offer of it is answered with a suggestion). The `rules` provider answers unless the project's
 * architecture.yml names a plugin AND the server runs with `CONSTRUCT_DECISION_PLUGINS=on`; a plugin that is refused or fails is
 * replaced by the rules provider and the notes say so. A suggestion is never applied and never recorded.
 *
 * @param {{ root: string, allowPlugins: boolean }} ctx The server's startup configuration.
 * @param {{ summary?: object, text?: string }} input Exactly one of a question summary and a requirement sentence.
 * @returns {Promise<object>} `{ ok, provider, requested, fellBackFrom, notes, suggestion }` for a summary, `{ ..., questions }` for a sentence.
 * @throws {ToolError} `INVALID_INPUT` (both or neither given), `INVALID_SUMMARY`, `PARSE_FAILED`, `CONFIG_UNREADABLE`, `PATH_OUTSIDE_ROOT`.
 *
 * @example
 * await decide(ctx, { text: 'A user wants to see a list of products' }); // => { ok: true, provider: { name: 'rules', version: '1' }, questions: [{ id: 'q-shape', suggestion: { option: 'list' } }] }
 */
export async function decide(ctx, { summary, text }) {
  if ((summary === undefined) === (text === undefined)) throw new ToolError('INVALID_INPUT', 'Give exactly one of "summary" (a question summary) and "text" (a requirement sentence).');
  assertContained(ctx.root);
  const { openDecision, suggestForQuestions } = await import('@line/construct-core/decision-project');
  const { providerInput } = await import('@line/construct-core/decision-provider');
  const decision = await openDecision(ctx.root, { allowPlugins: ctx.allowPlugins === true });
  const head = () => ({ ok: true, provider: decision.provider, requested: decision.requested, fellBackFrom: decision.fellBackFrom, notes: decision.notes.slice(0, 5) });

  if (summary !== undefined) {
    if (JSON.stringify(summary).length > LIMITS.summaryBytes || providerInput(summary) === null) throw new ToolError('INVALID_SUMMARY', 'The summary must be { id, question, options: [{ id, label, enabled, why }] } with 1 to 5 options, at most 16 KiB, and no secret in it.');
    const s = await decision.suggest(summary);
    return { ...head(), suggestion: s ? { option: s.option, reason: cut(s.reason, 200), runnerUp: s.runnerUp, ...(s.score === undefined ? {} : { score: s.score }) } : null };
  }

  const { openQuestion } = await import('@line/construct-core/requirement-card');
  const { placeCard } = await import('@line/construct-core/placement');
  const card = await parseSentence(text);
  let questions;
  let note = null;
  if (card.open.length) {
    questions = card.open.map((item) => ({ ...openQuestion(card, item), source: 'card' }));
    note = 'A word of the sentence is not known yet: answer these questions first, nothing is placed until then.';
  } else {
    const config = await readConfig(ctx.root);
    const placement = placeCard(card, { layers: config.layers, framework: config.project?.framework });
    questions = [...placement.open, ...(placement.offers ?? [])].map((q) => ({ ...q, source: 'placement' }));
  }
  const suggestions = await suggestForQuestions(decision, questions.slice(0, LIMITS.questions));
  return {
    ...head(),
    ...(note ? { note } : {}),
    questions: questions.slice(0, LIMITS.questions).map((q) => ({
      id: q.id,
      source: q.source,
      question: cut(q.question, 160),
      options: q.options.filter((o) => o.enabled !== false).slice(0, 5).map((o) => ({ id: o.id, label: cut(o.label, 60) })),
      suggestion: suggestions[q.id] ? { option: suggestions[q.id].option, reason: cut(suggestions[q.id].reason, 200), runnerUp: suggestions[q.id].runnerUp, provider: suggestions[q.id].provider } : null,
    })),
  };
}

// -------------------------------------------------------------------------------------------------------------- summarize

/**
 * `summarize`: `construct summarize` for one feature or the whole project, bounded: per feature its lines of code, its public API
 * and how many files each layer holds, and the compact plain-text paragraph an agent pastes instead of reading files.
 *
 * @param {{ root: string }} ctx The server's startup configuration.
 * @param {{ feature?: string, backend?: boolean }} input A feature name (never a path); omit it for the whole project. `backend: true` summarizes the project's Node.js / Express backend instead (see `summarizeBackendTool`).
 * @returns {Promise<object>} `{ ok, scope, featureCount, features, summary, truncated }`, or the backend summary when `backend` is true.
 * @throws {ToolError} `PATH_OUTSIDE_ROOT` (a path, or a link that leaves the project), `INVALID_INPUT`, `NOT_FOUND`, `CONFIG_UNREADABLE`.
 *
 * @example
 * await summarize(ctx, { feature: 'billing' }); // => { ok: true, scope: 'feature', features: [{ feature: 'billing', loc: 240, layers: { domain: 2 } }] }
 */
export async function summarize(ctx, { feature, backend } = {}) {
  if (backend === true) return summarizeBackendTool(ctx, feature);
  if (feature !== undefined) assertFeatureName(feature);
  assertContained(ctx.root);
  const config = await readConfig(ctx.root);
  if (feature !== undefined && !fs.existsSync(path.join(ctx.root, config.features?.root ?? 'features', feature))) throw new ToolError('NOT_FOUND', `This project has no feature named "${feature}".`);
  const { summarizeProject, summarizeCompact } = await import('@line/construct-core/summarize');
  let all;
  try {
    all = JSON.parse(summarizeProject(ctx.root, { feature, format: 'json' }));
  } catch {
    throw new ToolError('TOOL_FAILED', 'The project could not be summarized.');
  }
  const text = summarizeCompact(ctx.root, { feature });
  return {
    ok: true,
    scope: feature === undefined ? 'project' : 'feature',
    featureCount: all.length,
    features: all.slice(0, LIMITS.features).map((f) => ({
      feature: f.feature,
      loc: f.loc,
      publicApi: (f.publicApi ?? []).slice(0, 20),
      layers: Object.fromEntries(Object.entries(f.layers ?? {}).slice(0, LIMITS.keyed).map(([layer, files]) => [layer, files.length])),
    })),
    summary: text.length > LIMITS.summaryChars ? `${text.slice(0, LIMITS.summaryChars - 1)}…` : text,
    truncated: all.length > LIMITS.features || text.length > LIMITS.summaryChars,
  };
}

/**
 * `summarize` with `backend: true`: `construct summarize --backend` for the project, bounded. The directory is never an argument:
 * it is `backend.dir` in the project's architecture.yml, else the project root, and never leaves the root. Returns the route
 * table (method, full path, handler name, middleware, `file:line`), the framework, role and effect counts, the environment
 * variable names (never values), import cycles and whatever could not be detected. Read-only.
 *
 * @param {{ root: string }} ctx The server's startup configuration.
 * @param {string|undefined} feature Must be omitted: a feature summary and a backend summary are different calls.
 * @returns {Promise<object>} `{ ok, scope: 'backend', dir, framework, counts, roles, effects, routes, env, cycles, unclassified, notDetected, truncated }`.
 * @throws {ToolError} `INVALID_INPUT` (a feature was also given), `PATH_OUTSIDE_ROOT`, `CONFIG_UNREADABLE` (a bad `backend:` section or directory).
 *
 * @example
 * await summarizeBackendTool(ctx); // => { ok: true, scope: 'backend', framework: 'express', counts: { routes: 12 }, routes: [{ method: 'GET', path: '/api/notes', handler: 'listNotes', file: 'server/notesApi.mjs', line: 8 }] }
 */
async function summarizeBackendTool(ctx, feature) {
  if (feature !== undefined) throw new ToolError('INVALID_INPUT', 'Give either a feature or backend: true, not both.');
  assertContained(ctx.root);
  const { summarizeBackend, resolveBackendDir } = await import('@line/construct-core/backend-summary');
  let s;
  try {
    s = summarizeBackend(resolveBackendDir(ctx.root), { root: ctx.root });
  } catch (e) {
    throw new ToolError('CONFIG_UNREADABLE', `The backend could not be summarized: ${cut(String(e?.message ?? e).split('\n')[0].replaceAll(ctx.root, '.'), LIMITS.lineChars)}`);
  }
  const n = LIMITS.backendItems;
  const handlerOf = (h) => (h.inline ? (h.wrapper ? `${h.wrapper}(...)` : h.name ?? '(inline)') : `${h.name}`);
  const others = s.files.list.filter((f) => f.role === 'other');
  return {
    ok: true,
    scope: 'backend',
    dir: s.dir,
    framework: s.detection.framework,
    counts: s.counts,
    roles: s.files.roles,
    effects: s.effects.counts,
    routes: s.routes.slice(0, LIMITS.backendRoutes).map((r) => ({
      method: r.method, path: cut(r.path, 120), handler: cut(handlerOf(r.handler), 60), ...(r.middleware.length ? { middleware: r.middleware.slice(0, 4).map((m) => cut(m, 40)) } : {}),
      ...(r.inherited.length ? { inherited: r.inherited.length } : {}), file: r.file, line: r.line,
    })),
    env: s.env.slice(0, n).map((e) => e.name),
    cycles: s.imports.cycles.slice(0, n).map((c) => c.path),
    unclassified: others.slice(0, n).map((f) => f.path),
    notDetected: s.detection.notDetected.slice(0, n).map((d) => ({ what: d.what, file: d.file, line: d.line, detail: cut(d.detail, 120) })),
    truncated: s.routes.length > LIMITS.backendRoutes || s.env.length > n || s.imports.cycles.length > n || others.length > n || s.detection.notDetected.length > n || Object.keys(s.truncated).length > 0,
  };
}

// -------------------------------------------------------------------------------------------------------------- validate

/**
 * `validate`: `construct validate` for the project: whether it passes, the counts (by severity and by rule) and the first
 * `limit` findings with their rule id, file, line, message and the suggested fix.
 *
 * @param {{ root: string }} ctx The server's startup configuration.
 * @param {{ limit?: number }} input How many findings to list (1 to `LIMITS.findings`, default `LIMITS.defaultFindings`).
 * @returns {Promise<object>} `{ ok, passed, counts: { total, error, warning, byRule }, findings, truncated }`.
 * @throws {ToolError} `PATH_OUTSIDE_ROOT` (a link that leaves the project), `PROJECT_TOO_LARGE`.
 *
 * @example
 * await validate(ctx, { limit: 3 }); // => { ok: true, passed: false, counts: { total: 1, error: 1, warning: 0, byRule: { 'IMPORT-001': 1 } }, findings: [{ rule: 'IMPORT-001', file: 'src/App.tsx', ... }] }
 */
export async function validate(ctx, { limit = LIMITS.defaultFindings } = {}) {
  assertContained(ctx.root);
  const { aggregateValidation, DEFAULT_ENFORCERS } = await import('@line/construct-core/validate');
  let result;
  try {
    result = aggregateValidation(ctx.root, DEFAULT_ENFORCERS);
  } catch {
    throw new ToolError('TOOL_FAILED', 'The project could not be validated.');
  }
  const violations = result.violations ?? [];
  const byRule = {};
  for (const v of violations) byRule[v.rule] = (byRule[v.rule] ?? 0) + 1;
  const n = Math.max(1, Math.min(LIMITS.findings, Math.floor(limit)));
  return {
    ok: true,
    passed: result.ok === true,
    counts: {
      total: violations.length,
      error: violations.filter((v) => v.severity === 'error').length,
      warning: violations.filter((v) => v.severity === 'warning').length,
      byRule: Object.fromEntries(Object.entries(byRule).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, LIMITS.keyed)),
    },
    findings: violations.slice(0, n).map((v) => ({
      rule: v.rule,
      severity: v.severity,
      file: v.file ?? null,
      ...(Number.isInteger(v.line) ? { line: v.line } : {}),
      message: cut(v.message, LIMITS.lineChars),
      ...(v.suggestedFix ? { fix: cut(v.suggestedFix, LIMITS.lineChars) } : {}),
    })),
    truncated: violations.length > n,
  };
}

// ------------------------------------------------------------------------------------------------- machine_capabilities

/**
 * `machine_capabilities`: the machine's tier (Lite, Cockpit use, Contributor) and what its memory and cores allow (model
 * proposals, the Cockpit), from `classifyMachine` and `capabilities`. Reads memory and cores only: it does not look for ffmpeg,
 * a browser or Ollama and makes no network call (`construct doctor` does those). Also says whether project decision plugins
 * are enabled on this server.
 *
 * @param {{ allowPlugins: boolean }} ctx The server's startup configuration.
 * @returns {Promise<object>} `{ ok, tier, machine, capabilities, decisionPlugins, notProbed }`.
 *
 * @example
 * await machineCapabilities({ allowPlugins: false }); // => { ok: true, tier: { id: 'contributor', name: 'Contributor' }, capabilities: { modelProposals: { available: true } } }
 */
export async function machineCapabilities(ctx) {
  const { classifyMachine, capabilities } = await import('@line/construct-core/machine');
  const cores = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
  const machine = { cores, totalRamMb: Math.round(os.totalmem() / 1048576) };
  const tier = classifyMachine(machine);
  const caps = capabilities(machine);
  return {
    ok: true,
    tier: { id: tier.id, name: tier.name, comfort: tier.comfort, reason: cut(tier.reason, 400) },
    machine: { platform: process.platform, node: process.versions.node, cores, totalMemoryMb: machine.totalRamMb },
    capabilities: { modelProposals: caps.modelProposals, cockpit: caps.cockpit },
    decisionPlugins: { enabled: ctx.allowPlugins === true, note: ctx.allowPlugins === true ? 'A project decision plugin may run when architecture.yml names one.' : 'Off: the rules provider answers (set CONSTRUCT_DECISION_PLUGINS=on when starting the server to allow a project plugin).' },
    notProbed: ['ffmpeg', 'Playwright browser', 'Ollama', 'python3', 'voice models'],
  };
}

// ----------------------------------------------------------------------------------------------------------- traces_stats

/**
 * `traces_stats`: `construct traces stats`, read-only: how many decisions were recorded for this project (by chooser, by
 * provider), how often a suggestion was accepted and how the outcomes came out. It reads this project's own trace file in the
 * per-user state directory (the only place outside the project the server reads) and never returns its path or any record.
 *
 * @param {{ root: string }} ctx The server's startup configuration.
 * @param {{ chooser?: string }} input Count only the decisions of this chooser id.
 * @returns {Promise<object>} `{ ok, enabled, skipped, unreadable, total, byChooser, suggestions, byProvider, outcomes }`.
 * @throws {ToolError} `PATH_OUTSIDE_ROOT` (a link that leaves the project), `INVALID_INPUT`.
 *
 * @example
 * await tracesStats(ctx, {}); // => { ok: true, enabled: true, total: 42, suggestions: { asked: 30, accepted: 21, overridden: 9, acceptanceRate: 0.7 } }
 */
export async function tracesStats(ctx, { chooser } = {}) {
  assertContained(ctx.root);
  const { readTraces } = await import('@line/construct-core/decision-trace-store');
  const { traceStats } = await import('@line/construct-core/decision-trace-replay');
  const read = readTraces(ctx.root);
  const decisions = chooser ? read.decisions.filter((d) => d.chooser?.id === chooser) : read.decisions;
  const stats = traceStats(decisions);
  const keyed = (record) => Object.fromEntries(Object.entries(record ?? {}).slice(0, LIMITS.keyed));
  return {
    ok: true,
    enabled: read.enabled,
    skipped: read.skipped,
    unreadable: read.error !== undefined,
    total: stats.total,
    byChooser: keyed(stats.byChooser),
    suggestions: stats.suggestions,
    byProvider: keyed(stats.byProvider),
    outcomes: stats.outcomes,
  };
}
