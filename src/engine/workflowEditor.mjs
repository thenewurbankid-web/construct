// Epic #57 / #61 -- deterministic, non-LLM XState source edits.
//
// Every operation is an exact source-range replacement computed from the
// typescript-estree AST (workflowExtractor.mjs's analyzeMachines), so
// formatting, comments and everything outside the touched ranges stay
// byte-identical -- no reprint of the file, no metadata anywhere. Only edits
// expressible unambiguously are supported; anything else returns
// `{ ok: false, error }` with the reason (the UI disables those controls).
//
// Ops: addState, removeState, renameState, addTransition, removeTransition,
// retargetTransition. Transitions are only editable when they are a plain
// `on: { EVENT: 'target' }` / `{ target: 'x' }` entry without a guard.
import { analyzeMachines, extractMachines } from './workflowExtractor.mjs';

const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const EVENT_RE = /^[A-Za-z_$][A-Za-z0-9_$.*-]*$/;

class Refusal extends Error {}
const refuse = (m) => {
  throw new Refusal(m);
};

const quoteKey = (name) => (IDENT_RE.test(name) ? name : `'${name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`);

function applyEdits(source, edits) {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  for (let i = 1; i < sorted.length; i++) if (sorted[i].end > sorted[i - 1].start) refuse('internal error: overlapping edits');
  let out = source;
  for (const e of sorted) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

function indentOf(source, index) {
  const lineStart = source.lastIndexOf('\n', index - 1) + 1;
  return /^[ \t]*/.exec(source.slice(lineStart, index))[0];
}

/** Edit that inserts `entryText` (a `key: value` property) as the last
 * property of the object literal `obj` (an ESTree ObjectExpression). */
function insertProperty(source, obj, entryText) {
  const props = obj.properties;
  if (props.length === 0) {
    const inner = indentOf(source, obj.range[0]);
    return { start: obj.range[0], end: obj.range[1], text: `{\n${inner}  ${entryText},\n${inner}}` };
  }
  const last = props[props.length - 1];
  const indent = indentOf(source, last.range[0]);
  const multiline = source.slice(obj.range[0], last.range[0]).includes('\n');
  const sep = multiline ? `,\n${indent}` : ', ';
  return { start: last.range[1], end: last.range[1], text: `${sep}${entryText}` };
}

/** Edit that deletes property `prop` from object literal `obj`. */
function removeProperty(source, obj, prop) {
  const props = obj.properties;
  if (props.length === 1) return { start: obj.range[0], end: obj.range[1], text: '{}' };
  const i = props.indexOf(prop);
  if (i < props.length - 1) return { start: prop.range[0], end: props[i + 1].range[0], text: '' };
  return { start: props[i - 1].range[1], end: prop.range[1], text: '' };
}

function literalEdit(source, node, newValue) {
  const q = source[node.range[0]] === '"' ? '"' : "'";
  const esc = newValue.replace(/\\/g, '\\\\').replace(new RegExp(q, 'g'), `\\${q}`);
  return { start: node.range[0], end: node.range[1], text: `${q}${esc}${q}` };
}

/** How a state's path should be written as a transition target from `fromPath`. */
function targetString(machine, fromPath, toPath) {
  const parent = (p) => (p.includes('.') ? p.slice(0, p.lastIndexOf('.')) : '');
  if (parent(fromPath) === parent(toPath)) return toPath.slice(parent(toPath) ? parent(toPath).length + 1 : 0);
  if (!machine.hasExplicitId) refuse(`Cross-level transitions need the machine to declare an explicit id (to write "#id.${toPath}"); add one first.`);
  return `#${machine.id}.${toPath}`;
}

function findState(machine, path) {
  const st = machine.states.find((s) => s.path === path);
  if (!st) refuse(`No state "${path}" in this machine.`);
  return st;
}

function checkName(name, what, re) {
  if (typeof name !== 'string' || !name.trim() || !re.test(name)) refuse(`"${name}" is not a valid ${what} name.`);
}

function statesObjectOf(machine, parentPath) {
  if (!parentPath) {
    const node = machine._cfg.get('states');
    if (!node || node.type !== 'ObjectExpression') refuse('The machine has no states object literal.');
    return node;
  }
  const node = findState(machine, parentPath)._props.get('states');
  if (!node || node.type !== 'ObjectExpression') refuse(`State "${parentPath}" has no states object; only existing compound states can gain children.`);
  return node;
}

const OPS = {
  addState(source, machine, { name, parent }) {
    checkName(name, 'state', IDENT_RE);
    const obj = statesObjectOf(machine, parent);
    if (obj.properties.some((p) => (p.key.name ?? p.key.value) === name)) refuse(`A state named "${name}" already exists there.`);
    return [insertProperty(source, obj, `${quoteKey(name)}: {}`)];
  },

  removeState(source, machine, { path }) {
    const st = findState(machine, path);
    if (st.initial) refuse(`"${path}" is the initial state; make another state initial (edit the source) before removing it.`);
    const referrers = machine.transitions.filter((t) => t.target === path && t.from !== path);
    if (referrers.length) {
      refuse(`Cannot remove "${path}": still the target of ${referrers.map((t) => `${t.from} --${t.event}-->`).join(', ')}. Remove or retarget those transitions first.`);
    }
    if (machine.states.some((s) => s.parent === path)) refuse(`"${path}" has child states; remove them first.`);
    const parentObj = statesObjectOf(machine, st.parent);
    return [removeProperty(source, parentObj, st._prop)];
  },

  renameState(source, machine, { path, name }) {
    checkName(name, 'state', IDENT_RE);
    const st = findState(machine, path);
    const siblings = machine.states.filter((s) => s.parent === st.parent);
    if (siblings.some((s) => s.name === name)) refuse(`A sibling state named "${name}" already exists.`);
    const parentPath = st.parent ? `${st.parent}.` : '';
    const newPath = `${parentPath}${name}`;
    const edits = [];
    edits.push({ start: st._prop.key.range[0], end: st._prop.key.range[1], text: quoteKey(name) });
    // parent's `initial: 'old'`
    if (st.initial) {
      const holder = st.parent ? findState(machine, st.parent)._props : machine._cfg;
      const initNode = holder.get('initial');
      if (!initNode || initNode.type !== 'Literal') refuse('The initial state is not a plain string literal; rename it in the source.');
      edits.push(literalEdit(source, initNode, name));
    }
    // every transition targeting it (or a descendant path, kept relative)
    for (const t of machine.transitions) {
      if (!t._targetNode) continue;
      const raw = t.rawTarget;
      if (t.target === path) {
        const next = raw.startsWith('#') ? raw.slice(0, raw.lastIndexOf('.') + 1) + name : raw.startsWith('.') ? raw : raw.includes('.') ? raw.slice(0, raw.lastIndexOf('.') + 1) + name : name;
        if (raw.startsWith('.')) refuse('A transition uses a relative ".child" target; rename manually.');
        edits.push(literalEdit(source, t._targetNode, next));
      } else if (t.target && t.target.startsWith(`${path}.`) && raw.startsWith('#')) {
        edits.push(literalEdit(source, t._targetNode, `#${machine.id}.${newPath}${t.target.slice(path.length)}`));
      }
    }
    return edits;
  },

  addTransition(source, machine, { from, event, target }) {
    checkName(event, 'event', EVENT_RE);
    const st = findState(machine, from);
    findState(machine, target);
    const text = `${quoteKey(event)}: '${targetString(machine, from, target)}'`;
    const on = st._props.get('on');
    if (on) {
      if (on.type !== 'ObjectExpression') refuse(`"on" of "${from}" is not an object literal.`);
      if (on.properties.some((p) => (p.key.name ?? p.key.value) === event)) {
        refuse(`"${from}" already handles "${event}"; retarget or remove that transition instead.`);
      }
      return [insertProperty(source, on, text)];
    }
    const obj = st._value;
    if (obj.type !== 'ObjectExpression') refuse(`State "${from}" is not an object literal.`);
    return [insertProperty(source, obj, `on: { ${text} }`)];
  },

  removeTransition(source, machine, { from, event }) {
    editable(machine, from, event);
    const st = findState(machine, from);
    const on = st._props.get('on');
    const prop = on.properties.find((p) => (p.key.name ?? p.key.value) === event);
    return [removeProperty(source, on, prop)];
  },

  retargetTransition(source, machine, { from, event, target }) {
    const t = editable(machine, from, event);
    findState(machine, target);
    return [literalEdit(source, t._targetNode, targetString(machine, from, target))];
  },
};

function editable(machine, from, event) {
  const matches = machine.transitions.filter((t) => t.from === from && t.event === event && t.kind === 'on');
  if (matches.length !== 1) refuse(`No single editable "${event}" transition on "${from}".`);
  const t = matches[0];
  if (!t.editable) refuse(`The "${event}" transition on "${from}" is guarded, has several branches or has no target, so it can only be edited in the source.`);
  return t;
}

/**
 * Apply one edit to the workflow source.
 * @param {string} source
 * @param {{machine: number, op: keyof OPS} & Record<string, string>} req  `machine` = index in file order
 * @returns {{ok: true, source: string} | {ok: false, error: string}}
 */
export function editWorkflow(source, req) {
  try {
    const { machines, error } = analyzeMachines(source);
    if (error) refuse(error);
    const machine = machines[req.machine];
    if (!machine) refuse('No such machine in this file.');
    if (machine.error) refuse(`This machine can't be edited visually: ${machine.error}.`);
    const fn = OPS[req.op];
    if (!fn) refuse(`Unsupported operation "${req.op}".`);
    const edits = fn(source, machine, req);
    const next = applyEdits(source, edits);
    // Safety net: the result must still parse and the machine must still be analyzable.
    const after = extractMachines(next);
    if (after.error || after.machines[req.machine]?.error) refuse('The edit would leave the machine unparseable; nothing was changed.');
    return { ok: true, source: next };
  } catch (e) {
    if (e instanceof Refusal) return { ok: false, error: e.message };
    throw e;
  }
}
