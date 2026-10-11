// cg1 + ct1 -- Trace: from a person's request and the plan's open steps to the tools they need, and from the tools to
// the controls that do them (controls.mjs, the one control registry), plus Auto's scripted moves for each tool.
//
//   matchRequest(request)            static rules: every tool the words could mean, best first, with a score
//   readArgs(toolId, request, project)  what the request names (library item, feature, page, prop, value)
//   toolEntry(...)                   the tool's controls (with the item each acts on) and Auto's script
//   traceMatch({request, steps}, {project, decide})  TraceMatch (contract.mjs); `decide` picks when several tools tie
//                                    (traceDecide.mjs: jev through @mx/reason with a cloze, static order when it is down)
//
// Pure and synchronous except `traceMatch` (async only for `decide`); no Node imports, so Cockpit's mock mode uses it.
// Nothing here plans or writes: a change still happens only when the person (or Auto, driving the real controls)
// adds a plan step and the plan runner runs it after Approve.
import { LINE_CONTROLS, TOOL_PATHS, controlById } from './controls.mjs';

const RULES = Object.freeze([
  { toolId: 'line.baseOn', any: [/\bbased?\b.*\bon\b/, /\bnew component\b/, /\b(create|make|add)\b.*\b(component|from|like)\b/, /\bcopy of\b/, /\breus/] },
  { toolId: 'line.promote', any: [/\bpromote\b/, /\b(into|to) the library\b/, /\bshared?\b/, /\breus/] },
  { toolId: 'line.setPageProp', any: [/\b(change|set|rename|update)\b.*\b(title|label|text|heading|prop)\b/, /\bprop\b/] },
  { toolId: 'line.setFragment', any: [/\b(edit|change)\b.*\bcode\b/, /\bwhen\b.*\bclicked\b/, /\bhandler\b/, /\bcondition\b/] },
  { toolId: 'line.fix', any: [/\bfix\b/, /\b(problem|error|finding|warning)s?\b/] },
  { toolId: 'line.moveFile', any: [/\bmove\b/] },
  { toolId: 'line.createLayout', any: [/\blayout\b/] },
  { toolId: 'line.setBase', any: [/\bset the base\b/, /\bbase link\b/] },
  { toolId: 'line.leaveAsIs', any: [/\bleave\b.*\bas (it )?is\b/, /\bskip\b/, /\bcarry on\b/] },
  { toolId: 'plan.approve', any: [/\bapprove\b/, /\brun the (waiting )?step\b/] },
  { toolId: 'plan.retry', any: [/\btry\b.*\bagain\b/, /\bretry\b/] },
  { toolId: 'line.project', any: [/\b(show|list|see|open)\b.*\bfeatures?\b/, /\bwhat('s| is) in\b/] },
]);

/** What each tool is, in a few words, for sentences and jev's cloze options. */
export const TOOL_WORDS = Object.freeze({
  'line.baseOn': 'Base a new component on a library component',
  'line.promote': 'Promote a feature component to the library',
  'line.setPageProp': 'Change one prop of a page',
  'line.setFragment': 'Edit one piece of code on a page',
  'line.fix': 'Apply the recommended fix for a problem',
  'line.moveFile': 'Move a file',
  'line.createLayout': 'Create the layout',
  'line.setBase': 'Set the base link of an item',
  'line.leaveAsIs': 'Leave a step as it is and carry on',
  'plan.approve': 'Approve the waiting step',
  'plan.retry': 'Try a step again',
  'line.project': 'Look at the features',
});

/**
 * Every tool the request's words could mean, best first (score, then the rules' order).
 * @param {string} request
 * @returns {{toolId: string, score: number}[]}
 */
export function matchRequest(request) {
  const text = String(request ?? '').toLowerCase();
  if (!text.trim()) return [];
  return RULES.map((r, order) => ({ toolId: r.toolId, score: r.any.filter((re) => re.test(text)).length, order }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map(({ toolId, score }) => ({ toolId, score }));
}

const words = (request) => String(request ?? '').match(/[A-Za-z][A-Za-z0-9]*/g) ?? [];
const findName = (request, names) => words(request).find((w) => names.includes(w)) ?? null;

/**
 * What the request names for a tool. With the project (LineProject) the names resolve to ids; without it only the
 * words are kept. Partial is fine: `missing` in the tool entry says what is still needed.
 * @param {string} toolId @param {string} request @param {any} [project]
 * @returns {Record<string, string>}
 */
export function readArgs(toolId, request, project) {
  const lib = project?.library ?? [];
  const features = project?.features ?? [];
  const items = features.flatMap((f) => f.items ?? []);
  const lower = String(request ?? '').toLowerCase();
  const feature = features.map((f) => f.name).find((n) => new RegExp(`\\b${n.toLowerCase()}\\b`).test(lower)) ?? null;
  const out = {};
  if (toolId === 'line.baseOn') {
    const comps = lib.filter((i) => i.kind === 'components');
    const libName = findName(request, comps.map((i) => i.name));
    if (libName) out.libraryId = comps.find((i) => i.name === libName).id;
    if (feature) out.feature = feature;
    const named = /\b(?:new|called|named)\s+([A-Z][A-Za-z0-9]+)/.exec(String(request))?.[1];
    const taken = new Set([...lib.map((i) => i.name), ...items.map((i) => i.name)]);
    if (named && !taken.has(named)) out.name = named;
  } else if (toolId === 'line.promote') {
    const own = items.filter((i) => i.kind === 'components');
    const name = findName(request, own.map((i) => i.name));
    if (name) out.featureItemId = own.find((i) => i.name === name).id;
  } else if (toolId === 'line.setPageProp' || toolId === 'line.setFragment') {
    const pages = items.filter((i) => i.kind === 'pages');
    const pageName = findName(request, pages.map((i) => i.name));
    const page = pageName ? pages.find((i) => i.name === pageName) : feature ? pages.find((i) => i.feature === feature) : null;
    if (page) { out.page = page.name; out.feature = page.feature; out.file = page.file; }
    if (toolId === 'line.setPageProp') {
      const prop = /\b(?:change|set|update|rename)\s+(?:the\s+)?([a-z][A-Za-z]*)/i.exec(String(request))?.[1];
      if (prop && prop !== 'prop') out.prop = prop;
      const value = /\bto\s+["'“]?(.+?)["'”]?\s*\.?$/.exec(String(request))?.[1];
      if (value) out.value = value;
    }
  } else if (toolId === 'line.fix' && feature) {
    out.feature = feature;
  }
  return out;
}

const nameOf = (id) => (typeof id === 'string' ? id.split('/').at(-1) ?? null : null);

/** The item each control on a tool's path acts on (data-line-target), from the args. */
function targetFor(controlId, args) {
  switch (controlId) {
    case 'components.baseOn': case 'components.baseOnFeature': case 'components.baseOnName': case 'components.baseOnCreate': return nameOf(args.libraryId);
    case 'components.promote': case 'components.promoteConfirm': return nameOf(args.featureItemId);
    case 'pages.feature': case 'features.card': return args.feature ?? null;
    case 'pages.page': case 'pages.codeToggle': case 'pages.fragmentSave': return args.page ?? null;
    case 'pages.propInput': case 'pages.propSave': return args.prop ?? null;
    case 'plan.approve': case 'plan.retry': case 'plan.leave': case 'plan.fix': return args.n === undefined ? null : String(args.n);
    default: return null;
  }
}

/** Auto's moves for a request tool, or what it still needs from the person. */
function scriptFor(toolId, a) {
  const approve = { kind: 'approve', controlId: 'plan.approve', target: null, caption: 'Approve runs the change through the plan runner; it waits for you unless you let Auto approve in this session.' };
  if (toolId === 'line.baseOn') {
    const lib = nameOf(a.libraryId);
    if (!lib) return { script: [], missing: 'Say which library component to base it on, for example Badge.' };
    if (!a.feature) return { script: [], missing: `Say which feature the new component goes in, for example "in orders".` };
    if (!a.name) return { script: [], missing: 'Give the new component a name, for example "a new StatusBadge".' };
    return { missing: null, script: [
      { kind: 'click', controlId: 'components.baseOn', target: lib, caption: `Open "Base on this" on the ${lib} card.` },
      { kind: 'select', controlId: 'components.baseOnFeature', target: lib, value: a.feature, caption: `Choose the feature ${a.feature}.` },
      { kind: 'type', controlId: 'components.baseOnName', target: lib, value: a.name, caption: `Type the name ${a.name}.` },
      { kind: 'click', controlId: 'components.baseOnCreate', target: lib, caption: 'Click Create; the change joins the plan and waits for approval.' },
      approve,
    ] };
  }
  if (toolId === 'line.promote') {
    const item = nameOf(a.featureItemId);
    if (!item) return { script: [], missing: 'Say which feature component to promote, for example OrderButton.' };
    return { missing: null, script: [
      { kind: 'click', controlId: 'components.promote', target: item, caption: `Click "Promote to library" on ${item}.` },
      { kind: 'click', controlId: 'components.promoteConfirm', target: item, caption: 'Confirm with Promote; the change joins the plan and waits for approval.' },
      approve,
    ] };
  }
  if (toolId === 'line.setPageProp') {
    if (!a.page) return { script: [], missing: 'Say which page to change, for example OrdersPage.' };
    if (!a.prop || a.value === undefined) return { script: [], missing: 'Say which prop and its new value, for example "change the title of OrdersPage to My orders".' };
    return { missing: null, script: [
      { kind: 'click', controlId: 'pages.feature', target: a.feature, caption: `Open the feature ${a.feature}.` },
      { kind: 'click', controlId: 'pages.page', target: a.page, caption: `Open the page ${a.page}.` },
      { kind: 'type', controlId: 'pages.propInput', target: a.prop, value: a.value, caption: `Type ${a.value} as the new ${a.prop}.` },
      { kind: 'click', controlId: 'pages.propSave', target: a.prop, caption: 'Click Save; the change joins the plan and waits for approval.' },
      approve,
    ] };
  }
  if (toolId === 'plan.approve') return { missing: null, script: [approve] };
  if (toolId === 'line.project') return { missing: null, script: a.feature ? [{ kind: 'click', controlId: 'features.card', target: a.feature, caption: `Open the feature ${a.feature}.` }] : [] };
  return { script: [], missing: 'Auto cannot fill this one in yet; the lit controls show you where to do it.' };
}

/** The sentence for a request tool. */
function toolSentence(toolId, a) {
  switch (toolId) {
    case 'line.baseOn': return `Base ${a.name ? `a new ${a.name}` : 'a new component'} on ${nameOf(a.libraryId) ?? 'a library component'}${a.feature ? ` in ${a.feature}` : ''}.`;
    case 'line.promote': return `Promote ${nameOf(a.featureItemId) ?? 'a feature component'} to the library.`;
    case 'line.setPageProp': return `Change ${a.prop ? `the ${a.prop}` : 'a prop'} of ${a.page ?? 'a page'}${a.value !== undefined ? ` to ${a.value}` : ''}.`;
    case 'line.setFragment': return `Edit a piece of code on ${a.page ?? 'a page'}.`;
    default: return `${TOOL_WORDS[toolId] ?? toolId}${toolId === 'line.fix' && a.feature ? ` in ${a.feature}` : ''}.`;
  }
}

/**
 * One tool with its controls (in the order a person uses them) and Auto's script.
 * @param {string} toolId @param {'request'|'step'} from @param {Record<string, any>} args @param {string|null} stepId
 */
export function toolEntry(toolId, from, args, stepId = null) {
  const path = TOOL_PATHS[toolId] ?? LINE_CONTROLS.filter((c) => c.toolId === toolId).map((c) => c.controlId);
  const controls = path.map((controlId) => {
    const c = /** @type {import('./contract.mjs').LineControl} */ (controlById(controlId));
    return { controlId, target: targetFor(controlId, args), screen: c.screen, label: c.label };
  });
  if (from === 'step') {
    const n = args.n;
    const approve = { kind: 'approve', controlId: 'plan.approve', target: String(n), caption: `Approve step ${n}; it runs through the plan runner.` };
    const sentence = toolId === 'plan.approve' ? `Step ${n} waits for your approval.` : toolId === 'line.fix' ? `Step ${n} needs a fix; apply the recommended one or leave it as it is.` : `Step ${n} needs you; try it again or leave it as it is.`;
    return { toolId, from, stepId, args, sentence, controls, script: toolId === 'plan.approve' ? [approve] : [], missing: null };
  }
  const { script, missing } = scriptFor(toolId, args);
  return { toolId, from, stepId: null, args, sentence: toolSentence(toolId, args), controls, script, missing };
}

/** The open plan steps as tools: a waiting step lights Approve, a step that needs the person its choices. */
function stepTools(steps) {
  const out = [];
  for (const s of steps ?? []) {
    const args = { n: s.n ?? '' };
    if (s.state === 'waiting') out.push(toolEntry('plan.approve', 'step', args, s.id));
    else if (s.state === 'needs-fix') { out.push(toolEntry('line.fix', 'step', args, s.id)); }
    else if (s.state === 'needs-you') out.push(toolEntry('plan.retry', 'step', args, s.id));
  }
  return out;
}

/** The static order: the first candidate, and why. */
export const staticDecide = async (options) => ({ picked: options[0], via: /** @type {const} */ ('static'), note: 'it comes first in Line\'s static order' });

/**
 * The request and the open steps as tools and controls (TraceMatch, contract.mjs).
 * @param {import('./contract.mjs').TraceRequest} input
 * @param {{project?: any, decide?: (options: string[], request: string) => Promise<{picked: string, via: 'static'|'jev', note: string}>}} [o]
 * @returns {Promise<import('./contract.mjs').TraceMatch>}
 */
export async function traceMatch(input, o = {}) {
  const request = typeof input?.request === 'string' ? input.request.trim().slice(0, 500) : '';
  const steps = Array.isArray(input?.steps) ? input.steps.slice(0, 50) : [];
  const found = matchRequest(request);
  const top = found.filter((m) => m.score === found[0]?.score).map((m) => m.toolId);
  let choice = null;
  let picked = found[0]?.toolId ?? null;
  if (top.length > 1) {
    const d = await (o.decide ?? staticDecide)(top, request).catch(() => staticDecide(top));
    picked = top.includes(d.picked) ? d.picked : top[0];
    const via = top.includes(d.picked) ? d.via : 'static';
    const label = TOOL_WORDS[picked].charAt(0).toLowerCase() + TOOL_WORDS[picked].slice(1);
    choice = { options: top, picked, via, sentence: via === 'jev' ? `Several tools fit; jev picked "${label}".` : `Several tools fit; Line took "${label}" because ${d.note}.` };
  }
  const tools = [];
  if (picked) tools.push(toolEntry(picked, 'request', readArgs(picked, request, o.project)));
  tools.push(...stepTools(steps));
  const alternatives = found.map((m) => m.toolId).filter((t) => t !== picked);
  let sentence;
  if (!request && !tools.length) sentence = 'Type what you want to do, and Trace lights up the controls that do it.';
  else if (request && !picked) sentence = 'Trace found no control for that; try words like base on, promote, change the title, edit code or fix.';
  else sentence = `${tools[0].sentence} The lit controls do it.`;
  return { ok: true, request, tools, alternatives, choice, via: choice?.via ?? 'static', sentence };
}
