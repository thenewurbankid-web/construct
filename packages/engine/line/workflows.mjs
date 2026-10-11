// cw1 -- Line workflows (contract.mjs LineWorkflow): read a project's library and feature workflows as state machines
// between pages, and plan the changes Cockpit makes to them. Everything here is pure: reads files and returns a
// LineWorkflowList or a StagedChange (or throws a LineOpError); the write happens only in applyChange (ops.mjs),
// through Construct's transactional writer, when a person approves the plan step (planTools.mjs).
//
//   readLineWorkflows(root, feature)          the feature's workflows, the library's, the feature's pages
//   planBaseWorkflowOn(root, {libraryId, feature, name})          line.baseWorkflowOn: a copy of the library machine,
//                                             its roles not chosen yet (planBaseOn checks the request first)
//   planSetWorkflowRole(root, {file, role, page})                 line.setWorkflowRole: which page fills a role
//   planAddWorkflowTransition(root, {file, from, event, to, ...}) line.addWorkflowTransition (workflowEditor.mjs)
//   planRemoveWorkflowTransition(root, {file, from, event})      line.removeWorkflowTransition (the feature's own only)
//
// The machine is read with Construct's static xstate extractor (workflowExtractor.mjs, nothing is executed) and edited
// with its exact-range source editor (workflowEditor.mjs); `roles` / `pages` are plain object literals read from the AST.
import fs from 'node:fs';
import path from 'node:path';
import { parseToAst, walkAst } from '@construct/ast';
import { analyzeMachines } from '../workflowExtractor.mjs';
import { editWorkflow } from '../workflowEditor.mjs';
import { LineOpError } from './contract.mjs';
import { readLineProject } from './model.mjs';
import { planBaseOn } from './ops.mjs';
import { describeWorkflow, addTransitionSummary } from './workflowWords.mjs';

const NAME = /^[A-Za-z][A-Za-z0-9]*$/;
const EVENT = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
const asSentence = (s) => { const t = String(s ?? '').trim(); return /[.?!]$/.test(t) ? t : `${t}.`; };
const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');

/** The value of an object-literal property node as a string, null for `null`, undefined otherwise. */
function literal(node) {
  if (!node) return undefined;
  if (node.type === 'Literal' && (typeof node.value === 'string' || node.value === null)) return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0].value.cooked;
  return undefined;
}
const unwrap = (n) => (n && (n.type === 'TSAsExpression' || n.type === 'TSSatisfiesExpression') ? unwrap(n.expression) : n);

/**
 * `export const <name> = { key: 'value' | null, ... }` in `source`: its entries and the nodes to edit them.
 * @param {string} source The file's source.
 * @param {string} name The constant's name, e.g. "roles" or "pages".
 * @param {any} [ast] The parsed source, when already parsed.
 * @returns {{obj: any, entries: Map<string, {value: string|null|undefined, node: any}>}|null}
 */
export function constObject(source, name, ast = parseToAst(source)) {
  let found = null;
  walkAst(ast, {
    enter(node) {
      if (found || node.type !== 'VariableDeclarator' || node.id.type !== 'Identifier' || node.id.name !== name) return;
      const obj = unwrap(node.init);
      if (obj?.type !== 'ObjectExpression') return;
      const entries = new Map();
      for (const p of obj.properties) {
        if (p.type !== 'Property' || p.computed) continue;
        const key = p.key.type === 'Identifier' ? p.key.name : String(p.key.value);
        entries.set(key, { value: literal(p.value), node: p.value });
      }
      found = { obj, entries };
    },
  });
  return found;
}

/** One xstate action node as a LineWorkflowAction. */
function actionOf(node) {
  const s = literal(node);
  if (typeof s === 'string') return { kind: 'other', name: s };
  if (node?.type !== 'ObjectExpression') return { kind: 'other', name: '(inline action)' };
  const get = (obj, key) => obj.properties.find((p) => p.type === 'Property' && !p.computed && (p.key.name ?? p.key.value) === key)?.value;
  const type = literal(get(node, 'type'));
  const params = get(node, 'params');
  const param = (k) => (params?.type === 'ObjectExpression' ? literal(get(params, k)) : undefined);
  if (type === 'callService' && typeof param('service') === 'string') return { kind: 'callService', service: param('service') };
  if (type === 'setPartState' && typeof param('part') === 'string' && typeof param('state') === 'string') return { kind: 'setPartState', part: param('part'), state: param('state') };
  return { kind: 'other', name: typeof type === 'string' ? type : '(action)' };
}

/** The actions of one transition value (`'target'` has none; `{target, actions}` has its list). */
function actionsOf(value) {
  if (value?.type !== 'ObjectExpression') return [];
  const a = value.properties.find((p) => p.type === 'Property' && !p.computed && (p.key.name ?? p.key.value) === 'actions')?.value;
  if (!a) return [];
  return (a.type === 'ArrayExpression' ? a.elements : [a]).map(actionOf);
}

/**
 * The first exported xstate machine of a workflow file, as plain data (states, `on` transitions with their actions),
 * or a sentence saying why Cockpit cannot draw it.
 * @param {string} source The workflow file's source.
 * @returns {any} `{ok: true, index, exportName, machine, raw}` or `{ok: false, sentence}`.
 */
export function readMachine(source) {
  const { machines, error } = analyzeMachines(source);
  if (error) return { ok: false, sentence: 'This file does not parse, so Cockpit cannot draw its workflow.' };
  const index = machines.findIndex((m) => m.exportName);
  const m = machines[index];
  if (!m) return { ok: false, sentence: 'This file has no xstate machine (createMachine), so Cockpit cannot draw it as a workflow.' };
  if (m.error) return { ok: false, sentence: `Cockpit cannot draw this machine, because its ${m.error}.` };
  return {
    ok: true, index, exportName: m.exportName,
    machine: {
      id: m.id, initial: m.initial,
      states: m.states.map((s) => ({ path: s.path, final: s.final })),
      transitions: m.transitions.filter((t) => t.kind === 'on' && !t.targetless).map((t) => ({ from: t.from, event: t.event, target: t.target, actions: actionsOf(t._valueNode?.type === 'ArrayExpression' ? t._valueNode.elements[0] : t._valueNode) })),
    },
    raw: m,
  };
}

/** Entries of a `roles` / `pages` object, as plain values. */
const plainEntries = (found, keep) => Object.fromEntries([...(found?.entries ?? [])].filter(([, e]) => keep(e.value)).map(([k, e]) => [k, e.value]));

/**
 * The feature's workflows, the library's workflows (to base one on), the feature's pages, and the workflow files
 * Cockpit cannot draw. Pure read.
 * @param {string} root
 * @param {string} feature
 * @returns {import('./contract.mjs').LineWorkflowList}
 */
export function readLineWorkflows(root, feature) {
  const p = readLineProject(root);
  const f = p.features.find((x) => x.name === feature);
  if (!f) throw new LineOpError(`There is no feature "${feature}"; pick one from the list.`, 'UNKNOWN_ITEM');
  const notMachines = [];
  const libWorkflows = p.library.filter((l) => l.kind === 'workflows');
  const libRead = new Map();
  for (const l of libWorkflows) {
    const src = read(root, l.file);
    const m = readMachine(src);
    if (!m.ok) { notMachines.push({ id: l.id, file: l.file, sentence: m.sentence }); continue; }
    // A promoted feature workflow keeps its `pages` object: its keys are the roles the next feature fills.
    const roles = plainEntries(constObject(src, 'roles'), (v) => typeof v === 'string');
    if (!Object.keys(roles).length) for (const r of constObject(src, 'pages')?.entries.keys() ?? []) roles[r] = `The ${r} page`;
    libRead.set(l.id, { item: l, m, roles });
  }
  const library = [...libRead.values()].map(({ item, m, roles }) => describeWorkflow({
    kind: 'library', name: item.name, file: item.file, feature: null, base: null, machine: m.machine, roles, pages: null,
    featurePages: [], baseTransitions: null,
    usedBy: item.usedBy.filter((u) => p.features.some((x) => x.items.some((i) => i.file === u.file && i.kind === 'workflows'))),
  }));
  const pages = f.items.filter((i) => i.kind === 'pages').map((i) => i.name);
  const workflows = [];
  for (const it of f.items.filter((i) => i.kind === 'workflows')) {
    const src = read(root, it.file);
    const m = readMachine(src);
    if (!m.ok) { notMachines.push({ id: it.id, file: it.file, sentence: m.sentence }); continue; }
    const base = libRead.get(it.base.libraryId ?? '');
    workflows.push(describeWorkflow({
      kind: 'feature', name: it.name, file: it.file, feature, base: it.base, machine: m.machine,
      roles: base?.roles ?? {}, pages: plainEntries(constObject(src, 'pages'), (v) => typeof v === 'string' || v === null),
      featurePages: pages, baseTransitions: base ? base.m.machine.transitions : null, usedBy: [],
    }));
  }
  return { feature, workflows, library, pages, notMachines };
}

// ------------------------------------------------------------------------------------------------- plans

/** A feature workflow file of the project, read: its feature, source, machine and the feature's pages. */
function featureWorkflow(root, file) {
  const rel = String(file ?? '');
  const p = readLineProject(root);
  const item = p.features.flatMap((f) => f.items).find((i) => i.file === rel);
  if (!item || item.kind !== 'workflows') {
    const lib = p.library.find((l) => l.file === rel);
    if (lib) throw new LineOpError(`The workflow ${lib.name} is in the library, which Cockpit does not change here; base a feature workflow on it and change that.`, 'LIBRARY_ITEM');
    throw new LineOpError(`There is no feature workflow "${rel}"; pick one from the feature's workflows.`, 'UNKNOWN_ITEM');
  }
  const source = read(root, rel);
  const m = readMachine(source);
  if (!m.ok) throw new LineOpError(m.sentence, 'NOT_A_MACHINE');
  const feature = p.features.find((f) => f.name === item.feature);
  return { item, source, m, project: p, pages: feature.items.filter((i) => i.kind === 'pages').map((i) => i.name) };
}

/** The workflow as Cockpit shows it, for `source` (the file now, or as a change would leave it). */
function describeSource(root, w, source) {
  const m = readMachine(source);
  if (!m.ok) return null;
  const lib = w.project.library.find((l) => l.id === w.item.base.libraryId);
  const libSrc = lib ? read(root, lib.file) : null;
  const libM = libSrc ? readMachine(libSrc) : null;
  return describeWorkflow({
    kind: 'feature', name: w.item.name, file: w.item.file, feature: w.item.feature, base: w.item.base, machine: m.machine,
    roles: libSrc ? plainEntries(constObject(libSrc, 'roles'), (v) => typeof v === 'string') : {},
    pages: plainEntries(constObject(source, 'pages'), (v) => typeof v === 'string' || v === null),
    featurePages: w.pages, baseTransitions: libM?.ok ? libM.machine.transitions : null, usedBy: [],
  });
}

/**
 * line.baseWorkflowOn: a new feature workflow based on a library workflow -- a copy of its machine (renamed), with a
 * `pages` object holding every role not chosen yet. The request is checked by planBaseOn first (library item, feature,
 * name, name taken), so the refusals are the same as for every other kind.
 * @param {string} root
 * @param {import('./contract.mjs').BaseWorkflowOnRequest} req
 * @returns {import('./contract.mjs').StagedChange}
 */
export function planBaseWorkflowOn(root, req = /** @type {any} */ ({})) {
  const { libraryId, feature, name } = req;
  if (!String(libraryId ?? '').startsWith('workflows/')) throw new LineOpError(`"${libraryId}" is not a library workflow; pick one from the library's workflows.`, 'UNKNOWN_ITEM');
  if (!NAME.test(String(name ?? ''))) throw new LineOpError(`"${name}" is not a workflow name; use letters and digits starting with a letter, such as orderBrowse.`, 'BAD_NAME');
  const plain = planBaseOn(root, { libraryId, feature, name });
  const dest = plain.files[0].path;
  const lib = readLineProject(root).library.find((l) => l.id === libraryId);
  const libSrc = read(root, lib.file);
  const m = readMachine(libSrc);
  if (!m.ok) throw new LineOpError(`The library workflow ${lib.name} is not an xstate machine Cockpit can copy: ${m.sentence.charAt(0).toLowerCase()}${m.sentence.slice(1)}`, 'NOT_A_MACHINE');
  const ast = parseToAst(libSrc);
  /** @type {any} */
  let init = null;
  let imports = [];
  walkAst(ast, {
    enter(node) {
      if (node.type === 'ImportDeclaration' && node.source.value === 'xstate') imports.push(libSrc.slice(node.range[0], node.range[1]));
      if (!init && node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && node.id.name === m.exportName) init = node.init;
    },
  });
  let machineText = libSrc.slice(init.range[0], init.range[1]);
  const idNode = m.raw._cfg.get('id');
  if (idNode && idNode.range[0] >= init.range[0] && idNode.range[1] <= init.range[1]) {
    machineText = `${machineText.slice(0, idNode.range[0] - init.range[0])}'${name}'${machineText.slice(idNode.range[1] - init.range[0])}`;
  }
  const roles = Object.keys(plainEntries(constObject(libSrc, 'roles', ast), (v) => typeof v === 'string'));
  const pagesText = roles.length ? `{\n${roles.map((r) => `  ${r}: null,`).join('\n')}\n}` : '{}';
  imports = imports.length ? imports : ["import { setup } from 'xstate';"];
  const content = `// @line-base ${libraryId}\n// ${name}: the library workflow ${lib.name} for feature ${feature}. Choose its pages and add transitions in Cockpit (Features, Workflows).\n${imports.join('\n')}\n\n/** Which page of ${feature} fills each role of ${lib.name} (null: not chosen yet). */\nexport const pages: Record<string, string | null> = ${pagesText};\n\nexport const ${name} = ${machineText};\n`;
  return { summary: `Creates the workflow ${name} in feature ${feature}, based on the library workflow ${lib.name}.`, files: [{ path: dest, content }] };
}

/**
 * line.setWorkflowRole: which page of the feature fills one role ('' clears it).
 * @param {string} root
 * @param {import('./contract.mjs').SetWorkflowRoleRequest} req
 * @returns {import('./contract.mjs').StagedChange}
 */
export function planSetWorkflowRole(root, { file, role, page } = /** @type {any} */ ({})) {
  const w = featureWorkflow(root, file);
  const found = constObject(w.source, 'pages');
  if (!found) throw new LineOpError(`The workflow ${w.item.name} has no pages object, so its roles cannot be chosen; base a new workflow on the library one.`, 'NO_ROLES');
  const entry = found.entries.get(String(role ?? ''));
  if (!entry) throw new LineOpError(`The workflow ${w.item.name} has no role "${role}"; its roles are ${[...found.entries.keys()].join(', ') || 'none'}.`, 'UNKNOWN_ROLE');
  const next = String(page ?? '');
  if (next && !w.pages.includes(next)) throw new LineOpError(`There is no page ${next} in ${w.item.feature}; pick one of its pages${w.pages.length ? ` (${w.pages.join(', ')})` : ''}.`, 'UNKNOWN_PAGE');
  if ((entry.value ?? '') === next) throw new LineOpError(next ? `The page ${next} already fills the ${role} role of ${w.item.name}.` : `The ${role} role of ${w.item.name} is already empty.`, 'NO_CHANGE');
  const text = next ? `'${next}'` : 'null';
  const content = w.source.slice(0, entry.node.range[0]) + text + w.source.slice(entry.node.range[1]);
  return { summary: next ? `Chooses ${next} for the ${role} page of the workflow ${w.item.name}.` : `Clears the page chosen for the ${role} role of the workflow ${w.item.name}.`, files: [{ path: w.item.file, content }] };
}

/** The source text of the actions a new transition runs. */
function actionsText({ service, part, partState }) {
  const out = [];
  if (service) {
    if (!NAME.test(service)) throw new LineOpError(`"${service}" is not a service name; use letters and digits, such as cancelOrder.`, 'BAD_NAME');
    out.push(`{ type: 'callService', params: { service: '${service}' } }`);
  }
  if (part || partState) {
    if (!NAME.test(String(part ?? '')) || !NAME.test(String(partState ?? ''))) throw new LineOpError('Name both the part and the state to set it to, such as OrderCard and loading.', 'BAD_NAME');
    out.push(`{ type: 'setPartState', params: { part: '${part}', state: '${partState}' } }`);
  }
  return out;
}

/**
 * line.addWorkflowTransition: When <from> sends <event>, Do: the actions, then go to <to>.
 * @param {string} root
 * @param {import('./contract.mjs').AddWorkflowTransitionRequest} req
 * @returns {import('./contract.mjs').StagedChange}
 */
export function planAddWorkflowTransition(root, req = /** @type {any} */ ({})) {
  const { file, from, event, to } = req;
  const w = featureWorkflow(root, file);
  if (!EVENT.test(String(event ?? ''))) throw new LineOpError(`"${event ?? ''}" is not an event name; use a word such as CANCEL.`, 'BAD_EVENT');
  const states = w.m.machine.states.map((s) => s.path);
  for (const s of [from, to]) if (!states.includes(s)) throw new LineOpError(`The workflow ${w.item.name} has no step "${s}"; pick one of ${states.join(', ')}.`, 'UNKNOWN_STATE');
  const extra = actionsText(/** @type {any} */ (req));
  const added = /** @type {any} */ (editWorkflow(w.source, /** @type {any} */ ({ machine: w.m.index, op: 'addTransition', from, event, target: to })));
  if (!added.ok) throw new LineOpError(asSentence(added.error), 'BAD_TRANSITION');
  let content = added.source;
  if (extra.length) {
    const again = analyzeMachines(content).machines[w.m.index];
    const t = again.transitions.find((x) => x.from === from && x.event === event && x.kind === 'on');
    const node = t._valueNode;
    content = `${content.slice(0, node.range[0])}{ target: ${content.slice(node.range[0], node.range[1])}, actions: [${extra.join(', ')}] }${content.slice(node.range[1])}`;
  }
  const card = describeSource(root, w, content)?.transitions.find((x) => x.id === `${from}|${event}`);
  if (!card) throw new LineOpError('The new transition would leave the workflow unreadable, so nothing was planned.', 'BAD_TRANSITION');
  return { summary: asSentence(addTransitionSummary(w.item.name, card)), files: [{ path: w.item.file, content }] };
}

/**
 * line.removeWorkflowTransition: remove one transition the feature added (the library's stay).
 * @param {string} root
 * @param {import('./contract.mjs').RemoveWorkflowTransitionRequest} req
 * @returns {import('./contract.mjs').StagedChange}
 */
export function planRemoveWorkflowTransition(root, { file, from, event } = /** @type {any} */ ({})) {
  const w = featureWorkflow(root, file);
  const view = describeSource(root, w, w.source);
  const t = view?.transitions.find((x) => x.id === `${from}|${event}`);
  if (!t) throw new LineOpError(`The workflow ${w.item.name} has no transition ${event} from ${from}.`, 'UNKNOWN_TRANSITION');
  if (!t.removable) throw new LineOpError(`The transition ${event} from ${from} comes from the library workflow, so it stays; a feature only removes what it added.`, 'LIBRARY_TRANSITION');
  const out = /** @type {any} */ (editWorkflow(w.source, /** @type {any} */ ({ machine: w.m.index, op: 'removeTransition', from, event })));
  if (!out.ok) throw new LineOpError(asSentence(out.error), 'BAD_TRANSITION');
  return { summary: `Removes from ${w.item.name}: ${t.when.replace(/\.$/, '').replace(/^When/, 'when')}.`, files: [{ path: w.item.file, content: out.source }] };
}

export const WORKFLOW_OPS = Object.freeze({ readLineWorkflows, planBaseWorkflowOn, planSetWorkflowRole, planAddWorkflowTransition, planRemoveWorkflowTransition });
