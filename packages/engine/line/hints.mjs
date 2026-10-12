// line-hints (#884) -- what Line shows a builder when it says no, in ONE shape, from one module. Owner's shape
// (12 Oct): (1) what was wrong, quoting the bad value; (2) the rule in one clause; (3) numbered choices f1..fn, each
// with the exact step it sends, recommended first; (4) one line how to apply ({"fix":"f1"}). A code with no fix gives
// (1), (2) and a concrete correct call instead of (3) and (4). Never a programmer path ("fixes[0].step").
//
//   REFUSAL_HINTS            per code: the rule in one clause, the request fields that hold the bad value, an example
//   TOOL_EXAMPLES            one correct call per builder tool (the example a no-fix refusal shows)
//   shapeRefusal(o)          {code, sentence, tool, args, fixes} -> {wrong, rule, choices | example, apply, text}
//   renderRefusal(shape)     the plain text a builder reads (plan-cli prints it; MCP sends it as the message)
//
// Pure: no I/O. The plan service (planService.mjs) shapes every refusal it returns; plan-cli and MCP only print it.
import { closestId } from '@line/construct-core/nearest';

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

/**
 * Per code: `rule` (one clause, no full stop), `fields` (request args that may hold the bad value, first found wins),
 * `example(req)` (a correct call when the tool's own example is not the right one). Every code a builder can meet is
 * here: refusals.mjs REFUSAL_FIXES, contract.mjs PLAN_REFUSAL_CODES, the plan service's own and plan-cli's.
 * @type {Readonly<Record<string, {rule: string, fields?: string[], example?: (req: {tool?: string, args?: any}) => ({tool: string, args: any} | {fix: string} | {answer: string, option: string} | null)}>>}
 */
export const REFUSAL_HINTS = Object.freeze({
  NAME_TAKEN: { rule: 'a name or route is used once: reuse the one that exists or pick a free one', fields: ['name', 'route', 'page'] },
  UNKNOWN_ITEM: { rule: 'a step names a file or item that exists in the library or a feature', fields: ['page', 'libraryId', 'file', 'featureItemId', 'from', 'slot', 'components'] },
  TYPE_ERROR: { rule: 'code lands only when it type-checks against the files it imports', fields: ['file', 'page'] },
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
  NO_CHANGE: { rule: 'a step must change its file', fields: ['file'] },
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
  NO_QUESTION: { rule: 'answer only the question the import is asking now, by its id', fields: ['answer'] },
  BAD_OPTION: { rule: 'an answer is one of the question\'s option ids', fields: ['option'] },
  OWNER_ONLY: { rule: 'only a person can waive a logic unit', fields: ['option'] },
  // plan-cli's own (the bench driver).
  UNKNOWN_COMMAND: { rule: 'plan-cli takes one of its commands: tools, status, add, run-next, findings, validate, read, ls, rules' },
  NOT_FOUND: { rule: 'read and ls take a project-relative path that exists', example: () => ({ tool: 'read', args: { path: 'features/catalog/spec.md' } }) },
  TOO_BIG: { rule: 'read returns files up to 64 KB' },
  CRASH: { rule: 'plan-cli failed on its own; the call changed nothing' },
  // The plan store's own (PLAN_<code>): the plan changed or refused the call.
  PLAN: { rule: 'the plan changed meanwhile or refused the call: read plan status, then send the call again', example: () => ex('plan_status', {}) },
});

/** The hint for `code` (PLAN_<x> share one). */
export const hintOf = (code) => REFUSAL_HINTS[code] ?? (String(code).startsWith('PLAN_') ? REFUSAL_HINTS.PLAN : null);

function dropKeys(o, keys) { return Object.fromEntries(Object.entries(o ?? {}).filter(([k]) => !keys.includes(k))); }

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
/** A step as a builder sends it: the tool and its args as JSON, a long string (a file's code) shortened. */
export const stepText = (step) => `${step.tool} ${JSON.stringify(step.args ?? {}, (_k, v) => (typeof v === 'string' && v.length > 120 ? `<${v.split('\n').length} lines>` : v))}`;
const asSentence = (s) => { const t = String(s ?? '').trim().replace(/\s+/g, ' '); return !t ? t : /[.?!]$/.test(t) ? t : `${t}.`; };
/** The first sentence of `s` (a path's dots and "e.g." do not end one). */
export function firstSentence(s) {
  const t = asSentence(s);
  const m = /^(.+?[.?!])\s+(?=[A-Z"(])/.exec(t);
  return m ? m[1] : t;
}

/** The value the refusal is about, as {field, value}, or null: the first hinted field the request holds. */
export function badValueOf(code, req) {
  const args = req?.args && typeof req.args === 'object' ? req.args : {};
  if (code === 'UNKNOWN_TOOL') return req?.tool ? { field: 'tool', value: String(req.tool) } : null;
  if (code === 'UNKNOWN_FIX' && req?.fix) return { field: 'fix', value: String(req.fix) };
  if ((code === 'NO_QUESTION' || code === 'BAD_OPTION') && req?.answer) return code === 'NO_QUESTION' ? { field: 'answer', value: String(req.answer) } : { field: 'option', value: String(req.option ?? '') };
  if (code === 'NOT_RETRYABLE' && args.retry?.of) return { field: 'retry.of', value: String(args.retry.of) };
  if (code === 'BAD_ARGS' && req?.field && req.field in args) return { field: req.field, value: show(args[req.field]) };
  for (const f of hintOf(code)?.fields ?? []) if (args[f] !== undefined && args[f] !== '') return { field: f, value: show(args[f]) };
  return null;
}
const show = (v) => clip(typeof v === 'string' ? v : JSON.stringify(v), 60);

/** The field BAD_ARGS's sentence names ("The arguments do not fit line.x: points must be ..."). */
export const badArgsField = (sentence) => /: ([A-Za-z_$][\w$.]*) (?:must|is not)/.exec(String(sentence))?.[1]?.split('.')[0] ?? null;

/**
 * @typedef {object} HintChoice
 * @property {string} ref                     "f1" (the recommended one) .. "fn".
 * @property {string|null} id                 The fix's stable id.
 * @property {{tool: string, args: any}} step The exact step choosing it adds.
 * @property {boolean} recommended
 * @property {string} [sentence]              The fix's own sentence.
 * @property {string} [why]                   #886: one sentence from the deciding rule.
 * @property {string} [effect]                #886: what choosing it does.
 * @property {string[]} [context]             #886: the minimal lines that decide it.
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
 * @param {{code: string, sentence: string, tool?: string, args?: any, fix?: string, answer?: string, option?: string,
 *   fixes?: any[], tools?: string[], context?: string[]}} o `fixes`: the typed fixes (ref, step, why/effect/context
 *   when known), recommended first; `tools`: the tool names (UNKNOWN_TOOL's nearest one); `context`: refusal lines.
 * @returns {RefusalShape}
 */
export function shapeRefusal(o) {
  const code = String(o.code);
  const hint = hintOf(code) ?? { rule: 'Line refused the call' };
  const req = { tool: o.tool, args: o.args, fix: o.fix, answer: o.answer, option: o.option, field: code === 'BAD_ARGS' ? badArgsField(o.sentence) : null };
  const fixes = (o.fixes ?? []).filter((f) => f?.step && typeof f.step.tool === 'string');
  const choices = fixes.map((f, i) => ({
    ref: f.ref ?? `f${i + 1}`, id: f.id ?? null, step: f.step, recommended: i === 0, ...(f.sentence ? { sentence: asSentence(f.sentence) } : {}),
    ...(f.why ? { why: f.why } : {}), ...(f.effect ? { effect: f.effect } : {}), ...(f.context?.length ? { context: f.context } : {}),
  }));
  // (1) what was wrong: the planner's first sentence when choices follow (they carry the rest), else all of it.
  let wrong = clean(choices.length ? firstSentence(o.sentence) : asSentence(o.sentence));
  const bad = badValueOf(code, req);
  if (bad && !wrong.includes(bad.value)) wrong = `${wrong.replace(/[.?!]$/, '')} (you sent ${bad.field} "${bad.value}").`;
  let example = null;
  if (!choices.length) {
    const near = code === 'UNKNOWN_TOOL' && o.tool && o.tools?.length ? closestId(String(o.tool), o.tools) : null;
    const call = hint.example?.(req) ?? (near ? TOOL_EXAMPLES[near] ?? ex(near, {}) : null) ?? (o.tool ? TOOL_EXAMPLES[o.tool] : null) ?? (code === 'UNKNOWN_TOOL' || code === 'BAD_JSON' ? TOOL_EXAMPLES['line.addRoute'] : null);
    example = call ? callText(call) : `${o.tool ?? 'line.createFeature'} ${JSON.stringify(TOOL_EXAMPLES[o.tool ?? '']?.args ?? TOOL_EXAMPLES['line.createFeature'].args)}`;
  }
  const apply = choices.length ? `To apply one, send {"fix":"${choices[0].ref}"}.` : null;
  const shape = { code, wrong, rule: hint.rule, choices, apply, example, context: o.context ?? [] };
  return { ...shape, text: renderRefusal(shape) };
}

/** A call as text: a step "line.x {...}", a plan-cli read, or a fix/answer object. */
function callText(call) {
  if ('fix' in call || 'answer' in call) return JSON.stringify(call);
  return stepText(/** @type {any} */ (call));
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
    out.push(s.choices.length === 1 ? 'Choice:' : 'Choices, recommended first:');
    for (const c of s.choices.slice(0, SHOWN_CHOICES)) {
      out.push(`  ${c.ref}: ${stepText(c.step)}`);
      if (c.why) out.push(`      why: ${c.why}`);
      if (c.effect) out.push(`      does: ${c.effect}`);
      for (const l of c.context ?? []) out.push(`      ${l}`);
    }
    if (s.choices.length > SHOWN_CHOICES) out.push(`  (${s.choices.length - SHOWN_CHOICES} more: ${s.choices.slice(SHOWN_CHOICES).map((c) => c.ref).join(', ')})`);
    out.push(s.apply ?? '');
  } else if (s.example) {
    out.push(`A correct call: ${s.example}`);
  }
  return out.filter(Boolean).join('\n');
}
