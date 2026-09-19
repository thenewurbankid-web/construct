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
// retargetTransition. Epic #223 adds the machine's data and behaviour:
// addContextField, setContextField, removeContextField (context + its
// interface member), declareAction/declareGuard, removeAction/removeGuard
// (setup({ actions, guards })), assignAction/unassignAction (a state's
// entry/exit or a transition's actions) and setGuard. Transitions are only editable when they are a plain
// `on: { EVENT: 'target' }` / `{ target: 'x' }` entry without a guard.
import { parseToAst } from '../ast/index.mjs';
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

// ---- #223: context / actions / guards helpers ------------------------------

const strLit = (node) => (node && node.type === 'Literal' && typeof node.value === 'string' ? node.value : undefined);
const quote = (name) => `'${name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const propKey = (p) => p.key.name ?? String(p.key.value);
const lineStartOf = (source, i) => source.lastIndexOf('\n', i - 1) + 1;

function isStaticLiteral(n) {
  if (!n) return false;
  switch (n.type) {
    case 'Literal': return true;
    case 'TemplateLiteral': return n.expressions.length === 0;
    case 'UnaryExpression': return (n.operator === '-' || n.operator === '+') && n.argument.type === 'Literal' && typeof n.argument.value === 'number';
    case 'ArrayExpression': return n.elements.every(isStaticLiteral);
    case 'ObjectExpression': return n.properties.every((p) => p.type === 'Property' && !p.computed && !p.method && !p.shorthand && isStaticLiteral(p.value));
    default: return false;
  }
}

/** The initial value must be a plain literal (number/string/boolean/null/[]/{}...): never executable code. */
function checkInitial(text) {
  if (typeof text !== 'string' || !text.trim()) refuse('An initial value is required (for example 0, "", false, null, [] or {}).');
  let ast;
  try {
    ast = parseToAst(`const __v = (${text});`);
  } catch {
    refuse(`"${text}" is not a valid literal value.`);
  }
  const init = ast.body.length === 1 && ast.body[0].declarations?.[0]?.init;
  if (!isStaticLiteral(init)) refuse(`"${text}" is not a plain literal (numbers, strings, true/false, null, and lists/objects of those are supported).`);
  return text.trim();
}

/** The type must be a single TypeScript type expression. */
function checkType(text) {
  if (typeof text !== 'string' || !text.trim()) refuse('A type is required (for example number, string, boolean, string | null).');
  let ast;
  try {
    ast = parseToAst(`type __T = ${text};`);
  } catch {
    refuse(`"${text}" is not a valid type.`);
  }
  if (ast.body.length !== 1 || ast.body[0].type !== 'TSTypeAliasDeclaration') refuse(`"${text}" is not a single valid type.`);
  return text.trim();
}

/** Edit that deletes `item` from a comma-separated node list (`items`, in order). */
function removeListItem(items, item, whole) {
  if (items.length === 1) return { start: whole.range[0], end: whole.range[1], text: whole.type === 'ArrayExpression' ? '[]' : '{}' };
  const i = items.indexOf(item);
  if (i < items.length - 1) return { start: item.range[0], end: items[i + 1].range[0], text: '' };
  return { start: items[i - 1].range[1], end: item.range[1], text: '' };
}

/** Insert a member before the machine's `states` (so `context` reads before it). */
function insertBeforeStates(source, machine, entryText) {
  const states = machine._cfg.propNodes.get('states');
  const indent = indentOf(source, states.range[0]);
  return { start: states.range[0], end: states.range[0], text: `${entryText},\n${indent}` };
}

function contextObject(machine) {
  if (!machine.contextEditable) refuse("The machine's context is not a plain object literal; edit it in the source.");
  const node = machine._cfg.get('context');
  return node && node.type === 'ObjectExpression' ? node : null;
}

/** Edit that adds `name: type;` to the context's type (interface / type literal). */
function addTypeMember(source, info, name, typeText) {
  const list = info.list;
  if (list.length === 0) {
    const inner = indentOf(source, info.body.range[0]);
    return { start: info.body.range[0], end: info.body.range[1], text: `{\n${inner}    ${quoteKey(name)}: ${typeText};\n${inner}}` };
  }
  const last = list[list.length - 1];
  const indent = indentOf(source, last.range[0]);
  const multiline = source.slice(info.body.range[0], last.range[0]).includes('\n');
  const semi = source[last.range[1] - 1] === ';';
  const at = last.range[1];
  return { start: at, end: at, text: multiline ? `${semi ? '' : ';'}\n${indent}${quoteKey(name)}: ${typeText};` : `${semi ? '' : ';'} ${quoteKey(name)}: ${typeText}` };
}

function removeTypeMember(source, member) {
  const start = lineStartOf(source, member.range[0]);
  const onOwnLine = /^[ \t]*$/.test(source.slice(start, member.range[0]));
  const nl = source.indexOf('\n', member.range[1]);
  if (onOwnLine && nl !== -1 && /^[ \t]*$/.test(source.slice(member.range[1], nl))) return { start, end: nl + 1, text: '' };
  return { start: member.range[0], end: member.range[1], text: '' };
}

const setupProp = (machine, section) => machine._setupObj?.properties.find((x) => x.type === 'Property' && !x.computed && propKey(x) === section) ?? null;

function declare(source, machine, section, name, stub) {
  checkName(name, section === 'actions' ? 'action' : 'guard', IDENT_RE);
  if (!machine._setupObj) refuse('Declaring named actions/guards needs the machine to be created with setup({ ... }).createMachine(...); this one is not.');
  const p = setupProp(machine, section);
  if (p && p.value.type !== 'ObjectExpression') refuse(`setup({ ${section} }) is not an object literal; edit it in the source.`);
  if (p && p.value.properties.some((x) => x.type === 'Property' && propKey(x) === name)) refuse(`"${name}" is already declared.`);
  if (p) return [insertProperty(source, p.value, `${quoteKey(name)}: ${stub}`)];
  const last = machine._setupObj.properties[machine._setupObj.properties.length - 1];
  const indent = last ? indentOf(source, last.range[0]) : '  ';
  const entry = `${section}: {\n${indent}  ${quoteKey(name)}: ${stub},\n${indent}}`;
  if (!last) return [{ start: machine._setupObj.range[0], end: machine._setupObj.range[1], text: `{\n  ${entry},\n}` }];
  return [insertProperty(source, machine._setupObj, entry)];
}

function referencesOf(machine, section, name) {
  const out = [];
  if (section === 'guards') {
    for (const t of machine.transitions) if (t.guard === name) out.push(`${t.from} --${t.event}-->`);
    return out;
  }
  for (const s of machine.states) {
    if (s.entry.includes(name)) out.push(`entry of ${s.path}`);
    if (s.exit.includes(name)) out.push(`exit of ${s.path}`);
  }
  for (const t of machine.transitions) if (t.actions.includes(name)) out.push(`${t.from} --${t.event}-->`);
  return out;
}

function undeclare(source, machine, section, name) {
  const p = setupProp(machine, section);
  const decl = p && p.value.type === 'ObjectExpression' && p.value.properties.find((x) => x.type === 'Property' && propKey(x) === name);
  if (!decl) refuse(`"${name}" is not declared in setup({ ${section} }).`);
  const refs = referencesOf(machine, section, name);
  if (refs.length) refuse(`Cannot remove "${name}": still used by ${refs.join(', ')}. Unassign it first.`);
  return [removeProperty(source, p.value, decl)];
}

function requireDeclared(machine, section, name) {
  checkName(name, section === 'actions' ? 'action' : 'guard', IDENT_RE);
  if (machine.hasSetup && !machine.declared[section].includes(name)) {
    refuse(`"${name}" is not declared; declare it first (setup({ ${section} })).`);
  }
}

/** The single, plain transition (string or object literal) a request points at. */
function transitionValue(machine, req) {
  const kind = req.kind || 'on';
  const matches = machine.transitions.filter((t) => t.from === req.from && t.event === req.event && t.kind === kind);
  if (matches.length !== 1) refuse(`No single "${req.event}" transition on "${req.from}".`);
  const t = matches[0];
  if (t._multi || !t._valueNode) refuse(`"${req.event}" on "${req.from}" has several branches, so it can only be edited in the source.`);
  if (t._valueNode.type !== 'Literal' && t._valueNode.type !== 'ObjectExpression') refuse(`"${req.event}" on "${req.from}" is not a plain transition.`);
  return t._valueNode;
}

/** Where the actions of a slot live: a state's entry/exit or one transition's `actions`. */
function actionSlot(machine, req) {
  if (req.where === 'entry' || req.where === 'exit') {
    const st = findState(machine, req.path);
    if (st._value.type !== 'ObjectExpression') refuse(`State "${req.path}" is not an object literal.`);
    return { holder: st._value, key: req.where, node: st._props.get(req.where) ?? null, wrap: null };
  }
  if (req.where === 'transition') {
    const v = transitionValue(machine, req);
    if (v.type === 'Literal') return { holder: null, key: 'actions', node: null, wrap: v };
    const p = v.properties.find((x) => x.type === 'Property' && !x.computed && propKey(x) === 'actions');
    return { holder: v, key: 'actions', node: p ? p.value : null, wrap: null };
  }
  return refuse('Choose where the action runs: entry, exit or transition.');
}

const wrapWith = (source, litNode, key, valueText) => ({ start: litNode.range[0], end: litNode.range[1], text: `{ target: ${source.slice(litNode.range[0], litNode.range[1])}, ${key}: ${valueText} }` });

const OPS = {
  addContextField(source, machine, { name, initial, type }) {
    checkName(name, 'context field', IDENT_RE);
    const init = checkInitial(initial);
    const obj = contextObject(machine);
    if (machine.context.some((f) => f.name === name)) refuse(`The context already has a "${name}" field.`);
    const edits = [];
    const entry = `${quoteKey(name)}: ${init}`;
    if (obj) edits.push(insertProperty(source, obj, entry));
    else edits.push(insertBeforeStates(source, machine, `context: { ${entry} }`));
    if (machine._types) {
      if (machine._types.members.some((m) => m.name === name)) refuse(`The context type already declares "${name}"; remove it from the source first.`);
      edits.push(addTypeMember(source, machine._types, name, checkType(type)));
    }
    return edits;
  },

  setContextField(source, machine, { name, initial, type }) {
    const obj = contextObject(machine);
    const prop = obj && obj.properties.find((p) => propKey(p) === name);
    if (!prop) refuse(`The context has no "${name}" field.`);
    if (initial === undefined && type === undefined) refuse('Nothing to change: give a new initial value and/or type.');
    const edits = [];
    if (initial !== undefined) edits.push({ start: prop.value.range[0], end: prop.value.range[1], text: checkInitial(initial) });
    if (type !== undefined) {
      const member = machine._types?.members.find((m) => m.name === name);
      if (!member) refuse(`There is no declared type for "${name}" to change in this file.`);
      const t = member.node.typeAnnotation.typeAnnotation;
      edits.push({ start: t.range[0], end: t.range[1], text: checkType(type) });
    }
    return edits;
  },

  removeContextField(source, machine, { name }) {
    const obj = contextObject(machine);
    const prop = obj && obj.properties.find((p) => propKey(p) === name);
    if (!prop) refuse(`The context has no "${name}" field.`);
    const edits = [removeProperty(source, obj, prop)];
    const member = machine._types?.members.find((m) => m.name === name);
    if (member) edits.push(removeTypeMember(source, member.node));
    return edits;
  },

  declareAction: (source, machine, { name }) => declare(source, machine, 'actions', name, '() => {}'),
  declareGuard: (source, machine, { name }) => declare(source, machine, 'guards', name, '() => true'),
  removeAction: (source, machine, { name }) => undeclare(source, machine, 'actions', name),
  removeGuard: (source, machine, { name }) => undeclare(source, machine, 'guards', name),

  assignAction(source, machine, req) {
    requireDeclared(machine, 'actions', req.name);
    const slot = actionSlot(machine, req);
    const q = quote(req.name);
    if (slot.wrap) return [wrapWith(source, slot.wrap, 'actions', q)];
    if (!slot.node) return [insertProperty(source, slot.holder, `${slot.key}: ${q}`)];
    const names = slot.node.type === 'ArrayExpression' ? slot.node.elements.map(strLit) : [strLit(slot.node)];
    if (names.includes(req.name)) refuse(`"${req.name}" already runs there.`);
    if (slot.node.type === 'ArrayExpression') {
      const els = slot.node.elements;
      if (els.length === 0) return [{ start: slot.node.range[0], end: slot.node.range[1], text: `[${q}]` }];
      return [{ start: els[els.length - 1].range[1], end: els[els.length - 1].range[1], text: `, ${q}` }];
    }
    return [{ start: slot.node.range[0], end: slot.node.range[1], text: `[${source.slice(slot.node.range[0], slot.node.range[1])}, ${q}]` }];
  },

  unassignAction(source, machine, req) {
    checkName(req.name, 'action', IDENT_RE);
    const slot = actionSlot(machine, req);
    const node = slot.node;
    if (!node) refuse(`"${req.name}" does not run there.`);
    const dropProp = () => removeProperty(source, slot.holder, slot.holder.properties.find((x) => x.value === node));
    if (node.type !== 'ArrayExpression') {
      if (strLit(node) !== req.name) refuse(`"${req.name}" does not run there.`);
      return [dropProp()];
    }
    const item = node.elements.find((e) => strLit(e) === req.name);
    if (!item) refuse(`"${req.name}" does not run there.`);
    return [node.elements.length === 1 ? dropProp() : removeListItem(node.elements, item, node)];
  },

  setGuard(source, machine, req) {
    const { name } = req;
    const v = transitionValue(machine, req);
    if (name) requireDeclared(machine, 'guards', name);
    if (v.type === 'Literal') {
      if (!name) refuse('That transition has no guard.');
      return [wrapWith(source, v, 'guard', quote(name))];
    }
    const g = v.properties.find((x) => x.type === 'Property' && !x.computed && propKey(x) === 'guard');
    if (!name) {
      if (!g) refuse('That transition has no guard.');
      return [removeProperty(source, v, g)];
    }
    if (g) return [{ start: g.value.range[0], end: g.value.range[1], text: quote(name) }];
    return [insertProperty(source, v, `guard: ${quote(name)}`)];
  },

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
