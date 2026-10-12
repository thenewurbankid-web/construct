// line-hints (#884) -- what Line shows a builder when it says no, in ONE shape, from one module. Owner's shape
// (12 Oct): (1) what was wrong, quoting the bad value; (2) the rule in one clause; (3) numbered choices f1..fn, each
// with the exact step it sends, recommended first; (4) one line how to apply ({"fix":"f1"}). A code with no fix gives
// (1), (2) and a concrete correct call instead of (3) and (4). Never a programmer path ("fixes[0].step").
//
//   REFUSAL_HINTS            per code: the rule in one clause, the request fields that hold the bad value, an example
//   TOOL_EXAMPLES            one correct call per builder tool (the example a no-fix refusal shows)
//   shapeRefusal(o)          {code, sentence, tool, args, fixes} -> {wrong, rule, choices | example, apply, text}
//   renderRefusal(shape)     the plain text a builder reads (plan-cli prints it; MCP sends it as the message)
//   whyOf / effectOf         #886: per fix, one sentence from the deciding rule, and what choosing it does (pure)
//   renderQuestion(q)        #887: an import question in the same shape: hint, options with their effect, how to answer
//   rulesCard(tool, args)    #888: the 2-4 rules for a step's tool and target layer, plain English, one example each
//                            (#916: with {resolve}, each example names a real page/feature of the project, or goes)
//   hintsJevOn / jevShadow   #890: the "jev picks context" switch (off) and jev's scores logged beside the static ones
//   createExampleResolver    #916: makes an example's paths real for a project (or drops it); plannedFiles(plan)
//   contextFor(root, o)      #886: the minimal deterministic lines that decide it, ranked by contextScore.mjs and cut
//                            to 5 (15 when the same code repeats for the same target in this plan); reads files only
//
// The plan service (planService.mjs) shapes every refusal it returns; plan-cli and MCP only print it.
import fs from 'node:fs';
import path from 'node:path';
import { closestId } from '@line/construct-core/nearest';
import { loadConfig, DEFAULT_RULES } from '@line/construct-core/config';
import { normalizeLineConfig, CODE_EXTENSIONS, LINE_RULES } from '@line/construct-core/profiles/line/contract';
import { resolveLayout } from '@line/construct-core/profiles/line/checks';
import { RULE_METADATA } from '@line/construct-core/rules-catalog';
import { stepOnFor, stepProfile, projectStepOn } from '@line/construct-core/ai-profiles';
import { rankLines, capFor } from './contextScore.mjs';

/** How many choices the text lists (the rest are named by ref, so they stay pickable). */
export const SHOWN_CHOICES = 4;

const ex = (tool, args) => ({ tool, args });

/** One correct call per builder tool: what a no-fix refusal shows as "A correct call". */
export const TOOL_EXAMPLES = Object.freeze({
  'line.createFeature': ex('line.createFeature', { name: 'cart', story: 'As a shopper, I want a cart I can change, so that I buy exactly what I want.', points: ['The page at /cart lists each product in the cart.', 'A button "Remove <name>" removes that line.'] }),
  'line.baseOn': ex('line.baseOn', { libraryId: 'pages/ListPage', feature: 'catalog', name: 'ProductListPage' }),
  'line.setCode': ex('line.setCode', { file: 'features/cart/pages/CartPage.tsx', code: '<the whole file>', contentHash: '<from read, only when the file exists>' }),
  'line.addRoute': ex('line.addRoute', { route: '/cart', page: 'features/cart/pages/CartPage.tsx' }),
  'line.setLayoutSlot': ex('line.setLayoutSlot', { slot: 'header', components: ['features/cart/components/CartLink.tsx'] }),
  'line.useViaUsecase': ex('line.useViaUsecase', { file: 'features/catalog/pages/ListPage.tsx', specifier: '../services/products' }),
  'line.extractExpression': ex('line.extractExpression', { file: 'features/catalog/pages/ListPage.tsx' }),
  'line.promote': ex('line.promote', { featureItemId: 'cart/components/CartLine' }),
  'line.setBase': ex('line.setBase', { file: 'features/cart/pages/CartPage.tsx', libraryId: 'pages/FormPage' }),
  'line.moveFile': ex('line.moveFile', { from: 'features/cart/Cart.tsx', to: 'features/cart/components/Cart.tsx' }),
  'line.setFragment': ex('line.setFragment', { file: 'features/catalog/pages/ListPage.tsx', fragmentId: '<id from findings>', code: '<the new expression>', contentHash: '<from read>' }),
  'line.setPageProp': ex('line.setPageProp', { file: 'features/catalog/pages/ListPage.tsx', nodeId: '<id from findings>', prop: 'title', kind: 'string', value: 'Products' }),
  'line.fix': ex('line.fix', { findingKey: '<key from findings>', fixId: '<one of its fix ids>' }),
  'line.leaveAsIs': ex('line.leaveAsIs', { stepId: '<the id of the step that needs you>' }),
  'line.createLayout': ex('line.createLayout', {}),
  'line.project': ex('line.project', {}),
});

const STEP_THAT_NEEDS_YOU = '<the id of the step whose state is needs-fix or needs-you>';
/** #915: the plan tool that runs the next approved step (plan-cli run-next, MCP plan_run_next); a fix may name it. */
export const RUN_NEXT = 'plan_run_next';

const given = (v) => v !== undefined && v !== null && v !== '' && (typeof v !== 'object' || Array.isArray(v));
/**
 * #906 (data-qwen3-4b-r1 call 34): a tool's correct call with the refused request's own values (its page, route,
 * file...) in place of the example's, so a builder is never sent to another page. `drop`: fields that held the bad value
 * (the example's own value stays there). A file's code is never echoed back: the example's placeholder stays.
 * @param {string} tool @param {any} args @param {string[]} [drop]
 * @returns {{tool: string, args: any} | null}
 */
export function sameCall(tool, args, drop = []) {
  const t = TOOL_EXAMPLES[tool];
  if (!t) return null;
  const a = args && typeof args === 'object' ? args : {};
  return ex(tool, Object.fromEntries(Object.entries(t.args).map(([k, v]) => [k, k !== 'code' && !drop.includes(k) && given(a[k]) ? a[k] : v])));
}

/** The name a page file exports, from its path (features/catalog/pages/ListPage.tsx -> ListPage). */
const nameOfFile = (f) => path.posix.basename(String(f)).replace(/\.[^.]+$/, '');
/**
 * #906: TYPE_ERROR's correct call is about the request's own file: the page a route would serve (addRoute), the page a
 * baseOn would create, or the file a setCode sent, rewritten whole with line.setCode.
 * @param {{tool?: string, args?: any}} req
 * @returns {{tool: string, args: any} | null}
 */
function typeErrorCall(req) {
  const a = req.args ?? {};
  if (req.tool === 'line.addRoute' && given(a.page)) return ex('line.setCode', { file: a.page, code: `<the whole file: ${nameOfFile(a.page)} takes no props, and passes the library page the props it needs>`, contentHash: '<from read>' });
  if (req.tool === 'line.baseOn' && given(a.feature) && given(a.name) && given(a.libraryId)) {
    const kind = String(a.libraryId).split('/')[0];
    return ex('line.setCode', { file: `features/${a.feature}/${kind}/${a.name}.tsx`, code: `<the whole file: // @line-base ${a.libraryId}, then ${a.name}${kind === 'pages' ? ', taking no props' : ''}>` });
  }
  if (given(a.file)) return ex('line.setCode', { file: a.file, code: '<the whole file, fixed where the error points>', contentHash: given(a.contentHash) ? a.contentHash : '<from read>' });
  return null;
}

/**
 * Per code: `rule` (one clause, no full stop), `fields` (request args that may hold the bad value, first found wins),
 * `example(req)` (a correct call when the tool's own example is not the right one). Every code a builder can meet is
 * here: refusals.mjs REFUSAL_FIXES, contract.mjs PLAN_REFUSAL_CODES, the plan service's own and plan-cli's.
 * @type {Readonly<Record<string, {rule: string, ruleOf?: (said: string) => (string | null), fields?: string[], example?: (req: {tool?: string, args?: any, why?: any}) => ({tool: string, args: any, why?: string} | {fix: string} | {answer: string, option: string} | null)}>>}
 */
export const REFUSAL_HINTS = Object.freeze({
  NAME_TAKEN: { rule: 'a name or route is used once: reuse the one that exists or pick a free one', fields: ['name', 'route', 'page'] },
  UNKNOWN_ITEM: { rule: 'a step names a file or item that exists in the library or a feature', fields: ['page', 'libraryId', 'file', 'featureItemId', 'from', 'slot', 'components'] },
  TYPE_ERROR: { rule: 'code lands only when it type-checks against the files it imports', fields: ['file', 'page'], example: (req) => typeErrorCall(req) },
  BAD_ARGS: { rule: 'each tool takes exactly its own arguments, in the types its schema gives' },
  BAD_CODE: { rule: 'a file is saved only as whole, non-empty code that parses', fields: ['file'] },
  BAD_EVENT: { rule: 'a workflow event is a name of letters and digits', fields: ['event'] },
  BAD_FEATURE: { rule: 'a feature name is lower-case words joined by hyphens, like cart or order-history', fields: ['name'] },
  BAD_FOLDER: { rule: 'an import names one folder inside the project, like src/alerts', fields: ['folder'] },
  BAD_JSON: { rule: 'arguments and fixtures are valid JSON' },
  BAD_NAME: { rule: 'a component or page name is a capital letter then letters and digits, like CartPage', fields: ['name'] },
  BAD_ROUTE: { rule: 'a route is a URL path like "/", "/cart" or "/products/:id"', fields: ['route'] },
  BAD_TRANSITION: { rule: 'a workflow goes only to a state it declares', fields: ['to'] },
  BAD_VALUE: { rule: 'a prop value has the kind the prop declares', fields: ['value'] },
  LIBRARY_ITEM: { rule: 'library items stay complete and unchanged: base a feature item on one and change that', fields: ['file', 'libraryId'], example: () => TOOL_EXAMPLES['line.baseOn'] },
  LIBRARY_TRANSITION: { rule: 'a transition the library workflow owns changes only in the library', fields: ['file'] },
  NEEDS_YOU: { rule: 'while a step waits for a fix, only its fix, its retry or leaving it as it is may run', example: () => TOOL_EXAMPLES['line.leaveAsIs'] },
  NEEDS_FIX: { rule: 'a step Construct refused when it ran waits for one of its fixes, a retry, or leaving it as it is', example: () => TOOL_EXAMPLES['line.leaveAsIs'] },
  NOTHING_TO_DO: { rule: 'a step must change something that is not so already', fields: ['file'] },
  NOTHING_TO_FIX: { rule: 'fixOf names a step that waits for a fix (state needs-fix)', fields: ['fixOf'], example: (req) => (req.tool ? ex(req.tool, dropKeys(req.args, ['fixOf'])) : null) },
  NOTHING_TO_LEAVE: { rule: 'line.leaveAsIs names a step that waits for you (state needs-fix or needs-you)', fields: ['stepId'], example: () => ex('line.leaveAsIs', { stepId: STEP_THAT_NEEDS_YOU }) },
  NOT_A_CHANGE: { rule: 'only a change tool joins the plan as a write step' },
  NOT_A_MACHINE: { rule: 'a workflow tool works on a workflow file Line can read', fields: ['file'] },
  NOT_LINE_LAYOUT: { rule: 'Line writes app/layout.tsx only once Line owns it' },
  NOT_RETRYABLE: { rule: 'only a step that waits for you can be tried again', example: (req) => ex(req.tool || 'line.setCode', { retry: { of: STEP_THAT_NEEDS_YOU } }) },
  // #916 (pilot-qwen-7b-r4-s2): the file is right, its code is what is already there; the correct call is about the same file.
  NO_CHANGE: { rule: 'a step must change its file', fields: ['file'], example: (req) => (given(req.args?.file) ? ex('line.setCode', { file: req.args.file, code: '<the whole file with the change you want; the code you sent is already there>', contentHash: given(req.args.contentHash) ? req.args.contentHash : '<from read>' }) : null) },
  NO_EXPORT: { rule: 'a page exports the component its route shows', fields: ['page'] },
  NO_PLAN: { rule: 'a plan starts with the first step you add', example: () => TOOL_EXAMPLES['line.createFeature'] },
  NO_ROLES: { rule: 'a workflow role is filled only when the workflow declares roles', fields: ['file'] },
  NO_STEP: { rule: 'a fix with no step is made by hand, with line.setCode', example: () => TOOL_EXAMPLES['line.setCode'] },
  OUTSIDE_WORKSPACE: { rule: 'a step writes only inside your workspace folder', fields: ['file', 'page', 'to'] },
  PRE_FAILED: { rule: 'a tool runs only when what it needs already exists' },
  STALE: { rule: 'replacing a file needs the contentHash you get by reading it; creating one needs none', fields: ['file', 'contentHash'] },
  STOPPED: { rule: 'a retry that passed no more checks than the try before is not tried again', example: () => ex('line.leaveAsIs', { stepId: STEP_THAT_NEEDS_YOU }) },
  UNKNOWN_FEATURE: { rule: 'a step names a feature that exists; line.createFeature makes a new one', fields: ['feature', 'file'], example: () => TOOL_EXAMPLES['line.createFeature'] },
  UNKNOWN_FILE: { rule: 'a step names a file that exists', fields: ['file', 'from'] },
  UNKNOWN_FINDING: { rule: 'a fix names a finding that is still reported (see findings)', fields: ['findingKey'] },
  UNKNOWN_FIX: { rule: 'send a ref the last refusal offered, like f1', fields: ['fix', 'fixId'] },
  UNKNOWN_PAGE: { rule: 'a workflow role names a page that exists', fields: ['page'] },
  UNKNOWN_PROP: { rule: 'a step sets only a prop the component declares', fields: ['prop'] },
  UNKNOWN_ROLE: { rule: 'a step fills only a role the workflow declares', fields: ['role'] },
  UNKNOWN_STATE: { rule: 'a step names only a state the workflow declares', fields: ['state', 'from', 'to'] },
  UNKNOWN_TRANSITION: { rule: 'a step removes only a transition the workflow has', fields: ['from', 'event'] },
  UNKNOWN_TOOL: { rule: 'a step uses one of the Line tools by its exact name', fields: ['tool'] },
  WRONG_KIND: { rule: 'each tool works on one kind of item', fields: ['file'] },
  // D3 (#887): import questions answered through the plan API.
  NO_QUESTION: { rule: 'answer the question the import is asking now, or one of its scan questions, by its id', fields: ['answer'] },
  TOO_LATE: { rule: 'a scan question is answered before the first import step runs', fields: ['answer'] },
  BAD_OPTION: { rule: 'an answer is one of the question\'s option ids', fields: ['option'] },
  OWNER_ONLY: { rule: 'only a person can waive a logic unit', fields: ['option'] },
  // #915: the same call is already in the plan, approved and waiting: running it is the one way on.
  DUPLICATE_STEP: { rule: 'a step joins the plan once; an approved step lands when the next run runs it', example: () => ex(RUN_NEXT, {}) },
  // plan-cli's own (the bench driver).
  UNKNOWN_COMMAND: { rule: 'plan-cli takes one of its commands: tools, status, add, run-next, findings, validate, read, ls, rules' },
  NOT_FOUND: { rule: 'read and ls take a project-relative path that exists', example: () => ({ tool: 'read', args: { path: 'features/catalog/spec.md' } }) },
  TOO_BIG: { rule: 'read returns files up to 64 KB' },
  CRASH: { rule: 'plan-cli failed on its own; the call changed nothing' },
  // The plan store's own (PLAN_<code>): the plan changed or refused the call.
  PLAN: { rule: 'the plan changed meanwhile or refused the call: read plan status, then send the call again', example: () => ex('plan_status', {}) },
  // A plan store's `invalid`: the step itself is malformed, so reading the plan again would not help. The rule names the
  // part that failed (ruleOf, from the store's sentence) and the correct call is the builder's own step, mended.
  PLAN_INVALID: {
    rule: 'a step names a Line tool, takes the arguments that fit it, and says why in one plain-English sentence',
    ruleOf: (said) => (/\bwhy\b/.test(said) ? "a step's why is one plain-English sentence that starts with a capital letter"
      : /\bgoal\b/.test(said) ? "a plan's goal is one plain-English sentence that starts with a capital letter and ends with a full stop"
        : /arguments do not fit/.test(said) ? 'each tool takes exactly its own arguments, in the types its schema gives'
          : /no tool named|tool is missing/.test(said) ? 'a step uses one of the Line tools by its exact name' : null),
    example: (req) => (req.tool ? { tool: req.tool, args: req.args ?? {}, why: mendWhy(req.why, req.tool) } : null),
  },
});

/** A why as a correct call shows it: the builder's own words, capital first and a full stop last. */
function mendWhy(why, tool) {
  const t = String(why ?? '').trim().replace(/\s+/g, ' ');
  if (!t) return `Run ${tool}.`;
  const c = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.?!]$/.test(c) ? c : `${c}.`;
}

/**
 * The hint for `code` (PLAN_<x> share one).
 * @param {string} code A refusal code.
 * @returns {any} The hint, or null.
 */
export const hintOf = (code) => REFUSAL_HINTS[code] ?? (String(code).startsWith('PLAN_') ? REFUSAL_HINTS.PLAN : null);

function dropKeys(o, keys) { return Object.fromEntries(Object.entries(o ?? {}).filter(([k]) => !keys.includes(k))); }

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
/**
 * A step as a builder sends it: the tool and its args as JSON, a long string (a file's code) shortened.
 * @param {{tool: string, args?: any}} step
 * @returns {string}
 */
export const stepText = (step) => `${step.tool} ${JSON.stringify(step.args ?? {}, (_k, v) => (typeof v === 'string' && v.length > 120 ? `<${v.split('\n').length} lines>` : v))}`;
const asSentence = (s) => { const t = String(s ?? '').trim().replace(/\s+/g, ' '); return !t ? t : /[.?!]$/.test(t) ? t : `${t}.`; };
/**
 * The first sentence of `s` (a path's dots and "e.g." do not end one).
 * @param {unknown} s
 * @returns {string}
 */
export function firstSentence(s) {
  const t = asSentence(s);
  const m = /^(.+?[.?!])\s+(?=[A-Z"(])/.exec(t);
  return m ? m[1] : t;
}

/**
 * The value the refusal is about, as {field, value}, or null: the first hinted field the request holds.
 * @param {string} code @param {any} req The request ({tool, args, fix, answer, option, field}).
 * @returns {{field: string, value: string} | null}
 */
export function badValueOf(code, req) {
  const args = req?.args && typeof req.args === 'object' ? req.args : {};
  if (code === 'UNKNOWN_TOOL') return req?.tool ? { field: 'tool', value: String(req.tool) } : null;
  if (code === 'UNKNOWN_FIX' && req?.fix) return { field: 'fix', value: String(req.fix) };
  if ((code === 'NO_QUESTION' || code === 'BAD_OPTION' || code === 'TOO_LATE') && req?.answer) return code !== 'BAD_OPTION' ? { field: 'answer', value: String(req.answer) } : { field: 'option', value: String(req.option ?? '') };
  if (code === 'NOT_RETRYABLE' && args.retry?.of) return { field: 'retry.of', value: String(args.retry.of) };
  if (code === 'BAD_ARGS' && req?.field && req.field in args) return { field: req.field, value: show(args[req.field]) };
  for (const f of hintOf(code)?.fields ?? []) if (args[f] !== undefined && args[f] !== '') return { field: f, value: show(args[f]) };
  return null;
}
const show = (v) => clip(typeof v === 'string' ? v : JSON.stringify(v), 60);

/**
 * The field BAD_ARGS's sentence names ("The arguments do not fit line.x: points must be ...").
 * @param {string} sentence
 * @returns {string|null}
 */
export const badArgsField = (sentence) => /: ([A-Za-z_$][\w$.]*) (?:must|is not)/.exec(String(sentence))?.[1]?.split('.')[0] ?? null;

/**
 * @typedef {object} HintChoice
 * @property {string} ref                     "f1" (the recommended one) .. "fn".
 * @property {string|null} id                 The fix's stable id.
 * @property {{tool: string, args: any}} step The exact step choosing it adds.
 * @property {boolean} recommended
 * @property {string} [sentence]              The fix's own sentence.
 * @property {string} [why]                   One sentence from the deciding rule (#886).
 * @property {string} [effect]                What choosing it does (#886).
 * @property {string[]} [context]             The minimal lines that decide it (#886).
 *
 * @typedef {object} RefusalShape
 * @property {string} code
 * @property {string} wrong      (1) What was wrong, the bad value quoted.
 * @property {string} rule       (2) The rule, one clause.
 * @property {HintChoice[]} choices  (3) Recommended first; empty when no step can get past it.
 * @property {string|null} apply (4) How to apply one: {"fix":"f1"}.
 * @property {string|null} example  With no choices: a concrete correct call.
 * @property {string[]} context  #886: lines that are about the refusal, not one choice.
 * @property {string} text       All of it, as the builder reads it.
 */

/**
 * The refusal as the builder sees it.
 * @param {{code: string, sentence: string, tool?: string, args?: any, why?: string, fix?: string, answer?: string, option?: string,
 *   fixes?: any[], tools?: string[], context?: string[], example?: string, resolve?: ((call: any, near?: string|null) => any) | null}} o
 *   `fixes`: the typed fixes (ref, step, why/effect/context when known), recommended first; `tools`: the tool names
 *   (UNKNOWN_TOOL's nearest one); `context`: refusal lines; `example`: the correct call, when the caller knows a better
 *   one than the tool's; `resolve` (#916, createExampleResolver's call): makes the correct call's paths real for the project,
 *   or returns null to drop it (no "A correct call" line then).
 * @returns {RefusalShape}
 */
export function shapeRefusal(o) {
  const code = String(o.code);
  const hint = hintOf(code) ?? { rule: 'Line refused the call' };
  const req = { tool: o.tool, args: o.args, why: o.why, fix: o.fix, answer: o.answer, option: o.option, field: code === 'BAD_ARGS' ? badArgsField(o.sentence) : null };
  const fixes = (o.fixes ?? []).filter((f) => f?.step && typeof f.step.tool === 'string');
  const choices = fixes.map((f, i) => ({
    ref: f.ref ?? `f${i + 1}`, id: f.id ?? null, step: f.step, recommended: i === 0, ...(f.sentence ? { sentence: asSentence(f.sentence) } : {}),
    ...(f.why ? { why: f.why } : {}), ...(f.effect ? { effect: f.effect } : {}), ...(f.context?.length ? { context: f.context } : {}),
  }));
  // (1) what was wrong: the planner's first sentence when choices follow (they carry the rest), else all of it.
  let wrong = clean(choices.length ? firstSentence(o.sentence) : asSentence(o.sentence));
  const bad = badValueOf(code, req);
  if (bad && !wrong.includes(bad.value)) wrong = `${wrong.replace(/[.?!]$/, '')} (you sent ${bad.field} "${bad.value}").`;
  let example = o.example ?? null;
  if (!choices.length && !example) {
    const near = code === 'UNKNOWN_TOOL' && o.tool && o.tools?.length ? closestId(String(o.tool), o.tools) : null;
    // #906: the refused request's own values (minus the bad one) fill the tool's example, so it names the same page.
    const call = hint.example?.(req) ?? (near ? TOOL_EXAMPLES[near] ?? ex(near, {}) : null) ?? (o.tool ? sameCall(o.tool, o.args, bad ? [bad.field] : []) : null) ??(code === 'UNKNOWN_TOOL' || code === 'BAD_JSON' ? TOOL_EXAMPLES['line.addRoute'] : null);
    const picked = call ?? ex(o.tool ?? 'line.createFeature', TOOL_EXAMPLES[o.tool ?? '']?.args ?? TOOL_EXAMPLES['line.createFeature'].args);
    // #916: a path the project does not have is swapped for a real one of its kind (the request's own first), or the
    // example goes; never a hard-coded page that is not there.
    const own = typeof o.args?.file === 'string' ? o.args.file : typeof o.args?.page === 'string' ? o.args.page : typeof o.args?.feature === 'string' ? o.args.feature : null;
    const real = o.resolve && picked && 'tool' in picked ? o.resolve(picked, own) : picked;
    example = real ? callText(real) : null;
  }
  const apply = choices.length ? `To apply one, send {"fix":"${choices[0].ref}"}.` : null;
  const shape = { code, wrong, rule: hint.ruleOf?.(String(o.sentence ?? '')) ?? hint.rule, choices, apply, example, context: o.context ?? [] };
  return { ...shape, text: renderRefusal(shape) };
}

/** A call as text: a step "line.x {...}", a plan-cli read, or a fix/answer object. */
function callText(call) {
  if ('fix' in call || 'answer' in call) return JSON.stringify(call);
  const step = stepText(/** @type {any} */ (call));
  return typeof (/** @type {any} */ (call).why) === 'string' ? `${step} --why ${JSON.stringify(/** @type {any} */ (call).why)}` : step;
}

/** Programmer paths never reach a builder: "(fixes[0].step)" and "options[].step" are dropped or said in words. */
const clean = (s) => String(s).replace(/\s*\((?:fixes|options)\[\d*\](?:\.step)?\)/g, '').replace(/(?:fixes|options)\[\d*\]\.step/g, 'the fix');

/**
 * The plain text of a shaped refusal.
 * @param {Omit<RefusalShape, 'text'>} s
 * @returns {string}
 */
export function renderRefusal(s) {
  const out = [`Refused (${s.code}): ${s.wrong}`, `Rule: ${s.rule}.`];
  for (const c of s.context ?? []) out.push(`  ${c}`);
  if (s.choices.length) {
    out.push(...choiceLines(s.choices));
    out.push(s.apply ?? '');
  } else if (s.example) {
    out.push(`A correct call: ${s.example}`);
  }
  return out.filter(Boolean).join('\n');
}

/** The numbered choices as a builder reads them (the first SHOWN_CHOICES; the rest named by ref). */
function choiceLines(choices) {
  const out = [choices.length === 1 ? 'Choice:' : 'Choices, recommended first:'];
  let lastWhy = null;
  for (const c of choices.slice(0, SHOWN_CHOICES)) {
    out.push(`  ${c.ref}: ${stepText(c.step)}`);
    // Minimal: a why the choice before already gave is not repeated (the structured choice keeps it).
    if (c.why && c.why !== lastWhy) out.push(`      why: ${c.why}`);
    lastWhy = c.why ?? null;
    if (c.effect) out.push(`      does: ${c.effect}`);
    for (const l of c.context ?? []) out.push(`      ${l}`);
  }
  if (choices.length > SHOWN_CHOICES) out.push(`  (${choices.length - SHOWN_CHOICES} more: ${choices.slice(SHOWN_CHOICES).map((c) => c.ref).join(', ')})`);
  return out;
}

/**
 * #906: the blocked steps a landed setCode freed, offered again in the refusal's shape (the first one's sentence, the
 * numbered choices, how to apply one), for run-next and the plan view.
 * @param {{ref: string, step: {tool: string, args: any}, sentence?: string, why?: string, effect?: string}[]} fixes Recommended first.
 * @returns {string}
 */
export function renderReoffer(fixes) {
  if (!fixes.length) return '';
  const choices = fixes.map((f, i) => ({ ...f, ref: f.ref ?? `f${i + 1}` }));
  return [asSentence(choices[0].sentence ?? `Now add ${choices[0].step.tool} again.`), ...choiceLines(choices), `To apply ${choices.length === 1 ? 'it' : 'one'}, send {"fix":"${choices[0].ref}"}.`].join('\n');
}

// ------------------------------------------------------------------------------------------- #886 why, effect, context

const firstClause = (s) => String(s ?? '').split(/[,;:]| so /)[0].replace(/[.?!]$/, '').trim();
const base = (p) => path.posix.basename(String(p ?? '')).replace(/\.[^.]+$/, '');

/**
 * Why a fix is offered, one sentence naming the rule that decided it (its id family: "UNKNOWN_ITEM/page:..." -> page).
 * @param {{id?: string|null, because?: string}} fix @param {number} i Its place (0 = recommended). @param {{code: string, asked?: string|null}} c
 * @returns {string}
 */
export function whyOf(fix, i, c) {
  // #915: a fix that carries its own reason (run-next: the pending step it waits on) says that.
  if (typeof fix.because === 'string') return fix.because;
  const id = String(fix.id ?? '');
  const family = id.split(':')[0];
  const kind = family.includes('/') ? family.split('/').slice(1).join('/') : family;
  const asked = c.asked ? `"${c.asked}"` : 'what you sent';
  const lead = i === 0 ? 'Recommended because' : 'Also possible:';
  const rule = /^(LINE-[A-Z]+|[A-Z]+-\d+)\//.exec(family)?.[1];
  if (family.startsWith('BLOCKED/')) return `${i === 0 ? 'Recommended because' : 'Also possible:'} the page it was refused for has changed since, and it plans clean now (rule blocked-step).`;
  if (rule) return `${lead} it fixes ${rule}: ${firstClause(LINE_RULES[rule]?.why ?? 'the rule that refused it').toLowerCase()} (rule ${family}).`;
  switch (kind) {
    case 'page': return i === 0 ? `Recommended because its path is the closest feature page to ${asked} (rule nearest-page).` : 'Another feature page a route can serve (rule feature-pages).';
    case 'base-on': return `${lead} there is no feature page for it yet, so this makes one from a library page (rule base-on-library).`;
    case 'did-you-mean': return i === 0 ? `Recommended because it is the nearest valid name to ${asked} (rule did-you-mean).` : `A near name to ${asked} (rule did-you-mean).`;
    case 'use-existing': return 'Recommended because that feature exists already; its spec.md takes this story and these points (rule use-existing).';
    case 'route-props': return 'Recommended because a page a route serves may take only params and searchParams (rule route-props).';
    case 'import': return `${lead} that file has the export the import misses (rule resolve-import).`;
    case 'slot': case 'layout-slot': return `${lead} the layout's slots take components and this one fits (rule layout-slots).`;
    case 'retry': return 'Tries the same step again; worth it only after something it needed has changed (rule retry).';
    case 'leave': return 'Goes on without this step; the plan runs the next one (rule leave-as-is).';
    default: return i === 0 ? `Recommended: Line ranks it first for ${c.code} (rule ${family || c.code}).` : `Option ${i + 1} for ${c.code} (rule ${family || c.code}).`;
  }
}

/**
 * What choosing a step does, in a few words (static: from the step alone, nothing planned).
 * @param {{tool: string, args?: any}} step
 * @returns {string}
 */
export function effectOf(step) {
  const a = step.args ?? {};
  switch (step.tool) {
    case 'line.addRoute': return `writes the route entry for ${a.route}, which shows ${base(a.page)}`;
    case 'line.setCode': return `${a.contentHash ? 'replaces' : 'creates'} ${a.file}`;
    case 'line.baseOn': case 'line.newComponent': case 'line.baseWorkflowOn': return `creates ${a.name} in feature ${a.feature}, based on the library's ${a.libraryId}`;
    case 'line.createFeature': return `creates feature ${a.name} with its spec.md`;
    case 'line.setLayoutSlot': return `shows ${(a.components ?? []).map(base).join(', ')} in the ${a.slot} slot of every page`;
    case 'line.leaveAsIs': return `marks step ${a.stepId} as left as it is, so the plan goes on`;
    case 'line.useViaUsecase': return `puts a usecase in front of ${a.specifier} and points ${base(a.file)} at it`;
    case 'line.promote': return `moves ${a.featureItemId} into the library and points its users at the library copy`;
    case 'line.setBase': return `points ${base(a.file)}'s @line-base at ${a.libraryId}`;
    case 'line.moveFile': return `moves ${a.from} to ${a.to} and re-points its imports`;
    case 'line.extractExpression': return `moves the inline conditional or loop of ${base(a.file)} into a typed expression`;
    case 'line.createLayout': return 'creates the library folder';
    case 'line.amend': return 'saves the refused change together with its fix, in one step';
    case 'line.fix': return `applies fix ${a.fixId}`;
    case RUN_NEXT: return 'runs the next approved step of the plan (nothing is added)';
    default: return a.retry?.of ? `runs step ${a.retry.of} again` : `runs ${step.tool}`;
  }
}

const layoutOf = (root) => {
  try { return resolveLayout(root, normalizeLineConfig(/** @type {any} */ (loadConfig(root)).line)); } catch { return { library: 'library', features: 'features' }; }
};
const readText = (abs) => { try { return fs.readFileSync(abs, 'utf8'); } catch { return null; } };
const MAX_FILES = 600;

/** The code files under the library, the features and the app router (bounded), project-relative. */
function codeFiles(root, dirs) {
  const out = [];
  const walk = (rel) => {
    if (out.length >= MAX_FILES) return;
    let es = [];
    try { es = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(r); else if (CODE_EXTENSIONS.includes(path.extname(e.name))) out.push(r);
    }
  };
  for (const d of dirs) walk(d);
  return out;
}

/**
 * The main export of a source ("export default function X", else the first named export).
 * @param {string} src
 * @returns {string|null}
 */
export const mainExportOf = (src) => /export\s+default\s+(?:async\s+)?(?:function|class)\s+([A-Za-z_$][\w$]*)/.exec(src)?.[1]
  ?? /export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z_$][\w$]*)/.exec(src)?.[1] ?? null;
/** The URL an app-router entry serves: app/products/[id]/page.tsx -> /products/:id. */
const routeOfEntry = (rel, app) => `/${rel.slice(app.length + 1).split('/').slice(0, -1).filter((s) => !/^\(.*\)$/.test(s)).map((s) => s.replace(/^\[(.+)\]$/, ':$1')).join('/')}`;

/**
 * The file a step or request is about (a page, a file, a library item), project-relative, or null.
 * @param {any} args @param {{library: string}|null} layout
 * @returns {string|null}
 */
export function targetOf(args, layout) {
  const a = args ?? {};
  if (typeof a.page === 'string') return a.page;
  if (typeof a.file === 'string') return a.file;
  if (typeof a.from === 'string') return a.from;
  if (typeof a.libraryId === 'string' && layout) return `${layout.library}/${a.libraryId}.tsx`;
  return null;
}

/**
 * The context lines of a refusal: deterministic facts Line already has, each about the request or one choice (ref),
 * ranked by the static context scorer and cut to the cap.
 * @param {string} root
 * @param {{code: string, tool?: string, args?: any, fixes?: any[], detail?: string|null, plan?: any, fields?: string[]|null, repeat?: number,
 *   score?: (line: any) => number}} o `repeat`: how often this code was refused for this target before in this plan.
 *   `score`: a scorer in place of the static one (#890: jev, only when its switch is on).
 * @returns {{lines: {text: string, kind: string, keys: string[], ref: string|null, score: number}[], candidates: {text: string, kind: string, keys: string[], ref: string|null}[], cap: number, attempt: string}}
 */
export function contextFor(root, o) {
  const layout = layoutOf(root);
  const app = fs.existsSync(path.join(root, 'src', 'app')) ? 'src/app' : 'app';
  /** @type {{text: string, kind: string, keys: string[], ref: string|null}[]} */
  const lines = [];
  const add = (text, kind, keys, ref = null) => { if (!lines.some((l) => l.text === text)) lines.push({ text, kind, keys: keys.filter(Boolean), ref }); };
  /** @type {string[] | null} */
  let files = null;
  const all = () => (files ??= codeFiles(root, [layout.library, layout.features, app]));
  const about = (rel, ref) => {
    if (!rel) return;
    const src = readText(path.join(root, rel));
    if (src === null) return;
    const exp = mainExportOf(src);
    const b = /@line-base\s+([\w/-]+)/.exec(src)?.[1];
    add(`${rel} exports ${exp ?? 'nothing'}${b ? `, based on ${b}` : ''}`, 'refusal-path', [rel, exp], ref);
    const name = base(rel);
    const imports = new RegExp(`from\\s+['"][^'"]*/${name.replace(/[$]/g, '\\$')}(?:\\.[jt]sx?)?['"]`);
    const users = all().filter((f) => f !== rel && imports.test(readText(path.join(root, f)) ?? ''));
    const entry = users.find((f) => f.startsWith(`${app}/`) && /\/(page|layout)\.[jt]sx?$/.test(f));
    if (entry) add(`${name} is served at ${routeOfEntry(entry, app)} (${entry})`, 'refusal-path', [entry, routeOfEntry(entry, app)], ref);
    const others = users.filter((f) => f !== entry).slice(0, 3);
    if (others.length) add(`${name} is imported by ${others.join(', ')}`, 'refusal-path', others, ref);
  };
  const fixes = (o.fixes ?? []).slice(0, SHOWN_CHOICES);
  about(targetOf(o.args, layout), null);
  for (const f of fixes) about(targetOf(f.step?.args, layout), f.ref ?? null);
  // A type error: the failing line +-2 of the code that was sent (or of the file on disk).
  const first = /^(\S+):(\d+) (TS\d+) (.+)$/m.exec(String(o.detail ?? ''));
  if (first) {
    const [, file, n, tsCode, msg] = first;
    const sent = typeof o.args?.code === 'string' && (!o.args.file || file.endsWith(String(o.args.file)) || String(o.args.file).endsWith(file));
    const code = sent ? o.args.code : readText(path.join(root, file));
    if (code) {
      const at = Number(n);
      const win = code.split('\n').map((l, i) => ({ n: i + 1, l })).filter((x) => Math.abs(x.n - at) <= 2).map((x) => `${x.n === at ? '>' : ' '}${x.n}| ${x.l}`);
      add(`${file}:${at} ${tsCode} ${msg.slice(0, 160)}\n${win.join('\n')}`, 'fix', [file, tsCode]);
    }
  }
  if (o.fields?.length && o.code === 'BAD_ARGS') add(`${o.tool} takes ${o.fields.join(', ')}`, 'fix', o.fields);
  if (o.code === 'STALE' && typeof o.args?.file === 'string' && fs.existsSync(path.join(root, o.args.file))) add(`${o.args.file} exists: read it, then send its contentHash`, 'fix', [o.args.file, 'contentHash']);
  const last = o.plan?.steps?.at(-1);
  if (last) add(`it follows step ${last.n}: ${stepText({ tool: last.tool, args: dropKeys(last.args, ['expect', 'retry', 'fixOf', 'code']) })} (${last.status})`, 'status', [last.id, last.tool]);
  const cap = capFor(o.repeat ?? 0);
  const attempt = o.tool ? stepText({ tool: o.tool, args: o.args ?? {} }) : '';
  const { ranked, kept } = rankLines(lines, { attempt, cap, ...(o.score ? { score: o.score } : {}) });
  return { lines: kept, candidates: ranked, cap, attempt };
}

/**
 * #886: the fixes with why and effect (pure), and the context lines split between them and the refusal.
 * @param {any[]} fixes @param {{code: string, asked?: string|null}} c @param {{lines: {text: string, ref: string|null}[]}} [ctx]
 * @returns {{fixes: any[], context: string[]}}
 */
export function withHints(fixes, c, ctx) {
  const kept = ctx?.lines ?? [];
  const out = fixes.map((f, i) => {
    const mine = kept.filter((l) => l.ref && l.ref === f.ref).map((l) => l.text);
    return { ...f, why: whyOf(f, i, c), effect: effectOf(f.step), ...(mine.length ? { context: mine } : {}) };
  });
  const refs = new Set(out.map((f) => f.ref));
  return { fixes: out, context: kept.filter((l) => !l.ref || !refs.has(l.ref)).map((l) => l.text) };
}

// ------------------------------------------------------------------------------------------------ #888 rules cards

/** The example paths a card names when it cannot look at a project (no resolver): the shapes, as before #916. */
const DEFAULT_PAGE = 'features/cart/pages/CartPage.tsx';
const DEFAULT_ROUTES = Object.freeze({ [DEFAULT_PAGE]: '/cart', 'features/product/pages/DetailPage.tsx': '/products/:id' });
/**
 * @typedef {{file: (rel: string, near?: string|null) => (string|null), feature: (name: string, near?: string|null) => (string|null),
 *   route: (page: string) => (string|null), exists: (rel: string) => boolean}} CardResolver
 * @typedef {string | ((x: CardResolver, own: {file: string|null, page: string|null}) => (string|null))} CardExample
 */
/** No project to look at: every path is taken as it is (the card's own examples). */
const STATIC_RESOLVER = /** @type {CardResolver} */ ({ file: (rel) => rel, feature: (name) => name, route: (page) => DEFAULT_ROUTES[page] ?? null, exists: () => true });
const featureOfPath = (p) => /^features\/([^/]+)\//.exec(String(p))?.[1] ?? null;
/** #916: the page a card's example names: the step's own page when real, else a real page (its feature first), else none. */
const cardPage = (x, own, fallback = DEFAULT_PAGE) => (own.page && x.exists(own.page) ? own.page : x.file(fallback, own.page ?? own.file));

/** The checks a tool's planner makes before a step joins the plan (build.mjs, typeGate.mjs), in plain English. */
/** @type {Readonly<Record<string, {id: string, text: string, example: CardExample}[]>>} */
const TOOL_RULES = Object.freeze({
  'line.addRoute': [
    { id: 'route-page', text: 'A route serves one feature page file, features/<feature>/pages/<Name>.tsx', example: (x, own) => { const pg = cardPage(x, own); return pg ? JSON.stringify({ route: x.route(pg) ?? '<the route its spec names>', page: pg }) : null; } },
    { id: 'route-props', text: 'The page it serves takes no props except params and searchParams', example: (x, own) => { const pg = cardPage(x, own); return pg ? `export function ${nameOfFile(pg)}() { ... }` : null; } },
    { id: 'route-once', text: 'One page serves one route, and one route has one page', example: (x, own) => { const pg = cardPage(x, own, 'features/product/pages/DetailPage.tsx'); return pg ? `${x.route(pg) ?? '<its route>'} -> ${pg}` : null; } },
  ],
  'line.setCode': [
    { id: 'contentHash', text: 'To replace a file, read it and send its contentHash; to create one, leave contentHash out', example: (x, own) => {
      const f = own.file && x.exists(own.file) ? own.file : x.file(DEFAULT_PAGE, own.file);
      return `read ${f ?? 'the file'}, then line.setCode {"file": ..., "code": ..., "contentHash": "<from read>"}`;
    } },
  ],
  'line.baseOn': [
    { id: 'base-name', text: 'name is a capital letter then letters and digits, and the feature must exist', example: (x, own) => { const f = x.feature('catalog', own.file ?? own.page); return f ? JSON.stringify({ libraryId: 'pages/ListPage', feature: f, name: 'ProductListPage' }) : null; } },
  ],
  'line.createFeature': [
    { id: 'feature-name', text: 'name is lower-case words joined by hyphens', example: '"cart", "order-history"' },
    { id: 'feature-story', text: 'story is one sentence: As a <role>, I want <capability>, so that <benefit>', example: '"As a shopper, I want a cart I can change, so that I buy exactly what I want."' },
    { id: 'feature-points', text: 'points is a JSON list of strings, one acceptance point each', example: '["The page at /cart has the heading \\"Your cart\\".", "A button \\"Remove <name>\\" removes that line."]' },
    { id: 'feature-once', text: 'A feature that exists is reused: write its spec.md with line.setCode', example: (x) => { const f = x.file('features/cart/spec.md'); return f ? `line.setCode {"file":"${f}", ...}` : null; } },
  ],
  'line.setLayoutSlot': [
    { id: 'slot', text: 'slot is header, nav or footer; components are component files of the library or a feature', example: (x) => { const c = x.file('features/cart/components/CartLink.tsx'); return c ? JSON.stringify({ slot: 'header', components: [c] }) : null; } },
  ],
  'line.leaveAsIs': [
    { id: 'leave', text: 'stepId names a step whose state is needs-fix or needs-you', example: '{"stepId":"s4"}' },
  ],
});

/** A one-line example for a framework rule (falls back to the catalog's expected shape). */
/** @type {Readonly<Record<string, CardExample>>} */
const RULE_EXAMPLES = Object.freeze({
  'LINE-BASE': '// @line-base pages/ListPage   (the first line of a feature page)',
  'LINE-DIR': "import { Button } from '../../../library/components/Button';   (never ../../other-feature/...)",
  'LINE-OWNER': (x, own) => { const pg = cardPage(x, own); return pg ? `${pg} belongs to feature ${featureOfPath(pg) ?? '<its feature>'} only` : null; },
  'LINE-LAYOUT': 'features/<feature>/{components,pages,usecases,services,domains,expressions,fixtures}/',
  'PAGE-003': "a page imports components and usecases: import { useCart } from '../usecases/useCart';",
  'COMPONENT-003': 'take data as props: export function CartLine({ line }: { line: CartItem }) { ... }',
  'WORKFLOW-001': 'a workflow file imports no React and renders nothing',
  'SERVICE-002': 'a service file imports no React: export async function placeOrder(order: Order) { ... }',
  'DOMAIN-001': 'export const subtotal = (lines: CartItem[]): number => lines.reduce(...)',
  'EXPR-001': 'an expression only maps props to JSX: no fetch, no state, no writes',
});

/** The one layer rule a card shows per layer (the error rule a builder meets first there). */
const LAYER_RULE = Object.freeze({ page: 'PAGE-003', component: 'COMPONENT-003', workflow: 'WORKFLOW-001', service: 'SERVICE-002', domain: 'DOMAIN-001', expression: 'EXPR-001' });
const KIND_TO_LAYER = Object.freeze({ pages: 'page', components: 'component', workflows: 'workflow', services: 'service', domains: 'domain', expressions: 'expression', usecases: 'usecase', fixtures: 'fixture', atoms: 'atom' });
const BASED = new Set(['page', 'component', 'workflow', 'fixture']);

/**
 * The layer a step targets: its file's kind folder, a library id's kind, a served page; null when none.
 * @param {string} tool @param {any} args
 * @returns {string|null}
 */
export function layerOf(tool, args) {
  const a = args ?? {};
  if (tool === 'line.addRoute') return 'page';
  if (tool === 'line.setLayoutSlot') return 'component';
  if (tool === 'line.createFeature') return 'feature';
  if (typeof a.file === 'string' && /(^|\/)spec\.md$/.test(a.file)) return 'spec';
  const kind = /(?:^|\/)(pages|components|workflows|services|domains|expressions|usecases|fixtures|atoms)\//.exec(String(a.file ?? a.page ?? ''))?.[1] ?? String(a.libraryId ?? '').split('/')[0];
  return KIND_TO_LAYER[kind] ?? null;
}

/**
 * #888: the 2-4 framework rules that apply to a step's tool and target layer, each in plain English with a one-line
 * example. Static: the tool's planner checks, then LINE_RULES (LINE-BASE for a based kind, LINE-OWNER for a page,
 * LINE-DIR for code), then the layer's first error rule from the rule catalog (RULE_METADATA layers, DEFAULT_RULES).
 * @param {string} tool @param {any} [args] @param {{metadata?: Record<string, any>, defaults?: Record<string, any>}} [rules]
 *   The catalog (default: packages/core rules-catalog.mjs RULE_METADATA and config.mjs DEFAULT_RULES).
 * @param {{resolve?: CardResolver | null}} [o] (#916) The project's example resolver (createExampleResolver); each example then
 *   names a real page or feature (the step's own first), or the rule shows no example. Without one, the card's own.
 * @returns {{tool: string, layer: string|null, rules: {id: string, text: string, example: string}[], text: string}}
 */
export function rulesCard(tool, args, rules = { metadata: RULE_METADATA, defaults: DEFAULT_RULES }, o = {}) {
  const layer = layerOf(tool, args);
  const x = o.resolve ?? STATIC_RESOLVER;
  const own = { file: typeof args?.file === 'string' ? args.file : null, page: typeof args?.page === 'string' ? args.page : typeof args?.file === 'string' && /\/pages\//.test(args.file) ? args.file : null };
  const real = (e) => (typeof e === 'function' ? e(x, own) ?? '' : e);
  const out = [...(TOOL_RULES[tool] ?? [])].map((r) => ({ ...r, example: real(r.example) }));
  const line = (id) => ({ id, text: firstClause(LINE_RULES[id].why), example: real(RULE_EXAMPLES[id]) || (RULE_EXAMPLES[id] ? '' : LINE_RULES[id].expected[0]) });
  const code = ['line.setCode', 'line.baseOn', 'line.newComponent', 'line.setFragment'].includes(tool) && layer !== 'spec';
  if (code && BASED.has(String(layer))) out.push(line('LINE-BASE'));
  if (tool === 'line.addRoute') out.push(line('LINE-OWNER'));
  if (code) out.push(line('LINE-DIR'));
  const lr = layer ? LAYER_RULE[layer] : null;
  if (code && lr && rules.metadata?.[lr]?.layers?.includes(layer) && rules.defaults?.[lr]?.severity === 'error') {
    out.push({ id: lr, text: String(rules.defaults[lr].name), example: real(RULE_EXAMPLES[lr]) || String(rules.metadata[lr].expected?.[0] ?? '') });
  }
  if (tool === 'line.setCode' && layer === 'spec') out.push({ id: 'spec-format', text: 'A spec.md is "## <story>" then one numbered acceptance point per line', example: '## As a shopper, I want ..., so that ...\\n\\n1. CART-1: ...' });
  const picked = out.slice(0, 4);
  const head = `Rules for ${tool}${layer ? ` (${layer})` : ''}:`;
  return { tool, layer, rules: picked, text: picked.length ? [head, ...picked.map((r) => (r.example ? `- ${r.text}. Example: ${r.example}` : `- ${r.text}.`))].join('\n') : '' };
}

// ------------------------------------------------------------------------------------------------ #890 jev shadow

/** The AI step that may pick context lines (packages/core/ai-profiles.json). Off: an AI step ships off until it has a
 * measured win over static (#881 held-out r2: static P@5 0.265, jev 0.253), so static picks and jev is only logged. */
export const HINTS_STEP = 'construct.hints';
/**
 * Where jev answers (trace/tools/jev/serve.py); the JEV_URL environment variable overrides it, read at each call.
 * @returns {string}
 */
export const jevUrl = () => process.env.JEV_URL || 'http://127.0.0.1:8765';
/** How long a shadow call may take in all; jev never holds a builder up longer than this. */
export const JEV_SHADOW_MS = 300;

/**
 * Whether jev picks a project's context lines: the step's profile AND a measured win (stepOnFor), the project's own
 * switch (`<root>/line/ai-profiles.json` {steps: {"construct.hints": {on}}}) in place of the profile's. Never throws.
 * @param {string} root
 * @returns {boolean}
 */
export function hintsJevOn(root) {
  try { return stepOnFor(stepProfile(HINTS_STEP), projectStepOn(root, HINTS_STEP)); } catch { return false; }
}

/** Line text as the jev trainer normalises it (train_context.py norm): camelCase and path punctuation split into words. */
const norm = (s, n = 400) => String(s ?? '').slice(0, n).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[/._:[\]{}()"',=<>|-]+/g, ' ');

/**
 * jev's keep-score for each candidate line (one typed Choice per line, as trained in #881), or null when jev does not
 * answer in time. Never throws and never waits longer than `timeoutMs` in all.
 * @param {{text: string, kind: string}[]} lines @param {{attempt?: string, code?: string, said?: string, url?: string, timeoutMs?: number, fetch?: typeof fetch}} [o]
 * @returns {Promise<{scores: number[], ms: number} | null>}
 */
export async function jevScores(lines, o = {}) {
  if (!lines.length) return { scores: [], ms: 0 };
  const t0 = Date.now();
  const signal = AbortSignal.timeout(o.timeoutMs ?? JEV_SHADOW_MS);
  const get = o.fetch ?? fetch;
  const question = { text: "Keep this context line for the builder's next step?", options: ['keep', 'drop'], key: 'keep' };
  try {
    const scores = await Promise.all(lines.map(async (l) => {
      const state = { attempt: norm(o.attempt, 240), outcome: 'refused', code: o.code ?? 'none', said: norm(o.said, 200), line: { kind: l.kind, src: 'hint', text: norm(l.text) } };
      const r = await get(`${o.url ?? jevUrl()}/choose`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ state, questions: [question] }), signal });
      if (!r.ok) throw new Error(`jev answered ${r.status}`);
      const a = (await r.json())?.answers?.[0];
      const p = Array.isArray(a?.probabilities) ? a.probabilities[0] : a?.probabilities?.keep;
      if (typeof p !== 'number') throw new Error('jev gave no keep probability');
      return +p.toFixed(4);
    }));
    return { scores, ms: Date.now() - t0 };
  } catch {
    return null;
  }
}

/**
 * #890: the shadow record for a refusal's context: every candidate line with its static score and jev's (when jev
 * answered in time), and which lines each would keep under the same cap. For calls.jsonl; nothing here changes what
 * the builder is shown.
 * @param {{candidates: {text: string, kind: string, score: number}[], cap: number, attempt?: string}} ctx A refusal's hintContext.
 * @param {{code?: string, said?: string, url?: string, timeoutMs?: number, fetch?: typeof fetch}} [o]
 * @returns {Promise<{via: 'jev', on: false, ms: number, lines: {text: string, static: number, jev: number}[], keptStatic: number[], keptJev: number[]} | {via: 'jev', on: false, unreachable: true}>}
 */
export async function jevShadow(ctx, o = {}) {
  const lines = ctx.candidates ?? [];
  const got = await jevScores(lines, { ...o, attempt: ctx.attempt });
  if (!got) return { via: 'jev', on: false, unreachable: true };
  const top = (key) => lines.map((l, i) => ({ i, s: key(l, i) })).sort((a, b) => b.s - a.s || a.i - b.i).slice(0, ctx.cap).map((x) => x.i);
  return {
    via: 'jev', on: false, ms: got.ms,
    lines: lines.map((l, i) => ({ text: l.text, static: l.score, jev: got.scores[i] })),
    keptStatic: top((l) => l.score), keptJev: top((_l, i) => got.scores[i]),
  };
}

// ------------------------------------------------------------------------------------------------ #916 example paths

// #916 -- examples name only real things. Bench run pilot-qwen-7b-r4-s2 looped 93 times on a NO_CHANGE setCode whose
// "A correct call" (and the setCode rules card) named features/cart/pages/CartPage.tsx, a file that project never had:
// the examples in hints.mjs (TOOL_EXAMPLES, TOOL_RULES) were hard-coded. This resolves an example against the project
// it is shown for: a path that exists stays; a path that does not is swapped for one of the same kind that exists (or
// that a pending plan step will create), the refused request's own feature first; when none fits, the example goes.
//
//   createExampleResolver(root, {planned})  -> {exists, file, feature, call, route}
//     exists(rel)        the file or folder is in the project, or a pending step creates it
//     file(rel, near?)   rel when real, else a real file of the same kind (pages, components, spec.md, ...), or null
//     feature(name)      name when the feature exists (or a pending createFeature makes it), else a real one, or null
//     call(call, near?)  {tool, args} with each path argument real, or null when one cannot be made real
//     route(page)        the route a page serves (its @line-route), or null
//
// Placeholders ("<the whole file>", "<from read>") are never touched. Reads files only; never throws.

const isPlaceholder = (v) => typeof v === 'string' && /<[^>]+>/.test(v);
const dirsOf = (abs) => { try { return fs.readdirSync(abs, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name).sort(); } catch { return []; } };
const filesOf = (abs) => { try { return fs.readdirSync(abs, { withFileTypes: true }).filter((e) => e.isFile() && !e.name.startsWith('.')).map((e) => e.name).sort(); } catch { return []; } };

/**
 * The files a pending plan step will create or rewrite (line.baseOn's new item, line.setCode's file), project-relative.
 * @param {{steps?: {tool: string, args?: any, status?: string}[]} | null | undefined} plan
 * @param {string} [features] The features folder.
 * @returns {string[]}
 */
export function plannedFiles(plan, features = 'features') {
  const out = [];
  for (const s of plan?.steps ?? []) {
    if (s.status !== 'planned' && s.status !== 'approved') continue;
    const a = s.args ?? {};
    if ((s.tool === 'line.baseOn' || s.tool === 'line.newComponent') && typeof a.feature === 'string' && typeof a.name === 'string' && typeof a.libraryId === 'string') out.push(`${features}/${a.feature}/${String(a.libraryId).split('/')[0]}/${a.name}.tsx`);
    else if (s.tool === 'line.createFeature' && typeof a.name === 'string') out.push(`${features}/${a.name}/spec.md`);
    else if (typeof a.file === 'string') out.push(a.file);
  }
  return out;
}

/**
 * An example resolver for one project (see the section header).
 * @param {string} root
 * @param {{planned?: string[]}} [o] `planned`: files pending plan steps will create (plannedFiles).
 * @returns {CardResolver & {call: (c: {tool: string, args?: any}, near?: string|null) => ({tool: string, args: any} | null), layout: {library: string, features: string}}}
 */
export function createExampleResolver(root, { planned = [] } = {}) {
  let layout = { library: 'library', features: 'features' };
  try { layout = /** @type {any} */ (resolveLayout(root, normalizeLineConfig(/** @type {any} */ (loadConfig(root)).line))); } catch { /* the default layout */ }
  const fdir = layout.features;
  const plannedSet = new Set(planned);
  const exists = (rel) => typeof rel === 'string' && rel !== '' && (plannedSet.has(rel) || fs.existsSync(path.join(root, rel)));
  const featureOf = (rel) => (typeof rel === 'string' && rel.startsWith(`${fdir}/`) ? rel.slice(fdir.length + 1).split('/')[0] : null);
  const features = () => [...new Set([...dirsOf(path.join(root, fdir)), ...planned.map(featureOf).filter(Boolean)])];
  /** Real files of one kind folder (pages, components, ...) across the features, planned ones after those on disk. */
  const ofKind = (kind) => {
    const disk = features().flatMap((f) => filesOf(path.join(root, fdir, f, kind)).filter((n) => CODE_EXTENSIONS.includes(path.extname(n)) && !/^index\.|\.(test|spec|stories)\./.test(n)).map((n) => `${fdir}/${f}/${kind}/${n}`));
    const later = planned.filter((p) => p.startsWith(`${fdir}/`) && p.split('/')[2] === kind && p.split('/').length === 4);
    return [...new Set([...disk, ...later])];
  };
  /** The nearest real file of a list: the `near` feature's first, then the first. */
  const pick = (list, near) => list.find((p) => near && featureOf(p) === featureOf(near)) ?? list[0] ?? null;

  /**
   * rel when it is real; else a real file of the same kind, `near`'s feature first; null when none.
   * @param {string} rel @param {string|null} [near]
   * @returns {string|null}
   */
  const file = (rel, near = null) => {
    if (typeof rel !== 'string' || isPlaceholder(rel) || exists(rel)) return rel;
    if (!rel.startsWith(`${fdir}/`)) return null;
    const segs = rel.slice(fdir.length + 1).split('/');
    if (segs.length === 2 && segs[1] === 'spec.md') return pick(features().map((f) => `${fdir}/${f}/spec.md`).filter(exists), near);
    if (segs.length === 3) return pick(ofKind(segs[1]), near);
    return null;
  };
  /**
   * name when that feature is real; else a real feature (`near`'s first); null when the project has none.
   * @param {string} name @param {string|null} [near]
   * @returns {string|null}
   */
  const feature = (name, near = null) => {
    const all = features();
    if (all.includes(name)) return name;
    const n = featureOf(near ?? '') ?? near;
    return all.includes(String(n)) ? String(n) : all[0] ?? null;
  };
  /** The route a page serves (its @line-route line), or null. */
  const route = (page) => /@line-route\s+(\S+)/.exec(readText(path.join(root, String(page))) ?? '')?.[1] ?? null;

  /**
   * A call with each path argument real (file, page, from, path, components, featureItemId, feature), `near` (the refused
   * request's own file or feature) first; null when one cannot be made real. A route follows a swapped page.
   * @param {{tool: string, args?: any}} c @param {string|null} [near]
   * @returns {{tool: string, args: any} | null}
   */
  const call = (c, near = null) => {
    if (!c || typeof c !== 'object' || typeof c.tool !== 'string') return null;
    const a = { ...(c.args ?? {}) };
    for (const k of ['file', 'page', 'from', 'path']) {
      if (typeof a[k] !== 'string' || isPlaceholder(a[k])) continue;
      // A file line.setCode creates (no contentHash) in a real feature is not looked up.
      if (k === 'file' && c.tool === 'line.setCode' && !a.contentHash && featureOf(a[k]) && features().includes(String(featureOf(a[k])))) continue;
      const real = file(a[k], near);
      if (!real) return null;
      if (real !== a[k] && k === 'page' && typeof a.route === 'string') a.route = route(real) ?? '<the route its spec names>';
      a[k] = real;
    }
    // A file a step creates (line.moveFile's target) keeps its name, inside a feature that is real.
    if (typeof a.to === 'string' && !isPlaceholder(a.to) && featureOf(a.to)) {
      const f = feature(featureOf(a.to) ?? '', typeof a.from === 'string' ? a.from : near);
      if (!f) return null;
      a.to = `${fdir}/${f}/${a.to.slice(fdir.length + 1).split('/').slice(1).join('/')}`;
    }
    if (Array.isArray(a.components)) {
      const comps = a.components.map((x) => (typeof x === 'string' ? file(x.split('#')[0], near) : x));
      if (comps.some((x) => !x)) return null;
      a.components = comps;
    }
    if (typeof a.featureItemId === 'string' && !isPlaceholder(a.featureItemId)) {
      const real = file(`${fdir}/${a.featureItemId}.tsx`, near);
      if (!real) return null;
      a.featureItemId = real.slice(fdir.length + 1).replace(/\.[^.]+$/, '');
    }
    if (typeof a.feature === 'string' && c.tool !== 'line.createFeature') {
      const real = feature(a.feature, near);
      if (!real) return null;
      a.feature = real;
    }
    return { ...c, args: a };
  };
  return { exists, file, feature, call, route, layout };
}

// ------------------------------------------------------------------------------------------------ #887 questions

/**
 * #887: an import question as a builder reads it, in the same shape as a refusal's choices: the question, why the
 * recommended option (its hint), each option with what it does, and how to answer ({"answer": id, "option": id}).
 * @param {{id: string, sentence: string, hint?: string, options: {id: string, sentence: string, effect?: string}[], recommended?: string}} q
 * @param {{folder?: string}} [o] The import folder, sent along with the answer.
 * @returns {string[]}
 */
export function renderQuestion(q, o = {}) {
  const rec = q.recommended ?? q.options[0]?.id;
  const opts = [...q.options].sort((a, b) => (a.id === rec ? -1 : b.id === rec ? 1 : 0));
  return [
    `Question (${q.id}): ${asSentence(q.sentence)}`,
    ...(q.hint ? [`Hint: ${asSentence(q.hint)}`] : []),
    opts.length === 1 ? 'Option:' : 'Options, recommended first:',
    ...opts.flatMap((x) => [`  ${x.id}: ${asSentence(x.sentence)}`, ...(x.effect ? [`      does: ${x.effect}`] : [])]),
    `To answer, send ${answerCall(q.id, rec, o.folder)}.`,
  ];
}

/**
 * The answer call for a question: {"answer": <id>, "option": <id>, "folder": <folder>}.
 * @param {string} qid @param {string} oid @param {string} [folder]
 * @returns {string}
 */
export const answerCall = (qid, oid, folder) => JSON.stringify({ answer: qid, option: oid, ...(folder ? { folder } : {}) });
