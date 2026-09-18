// Epic #57 / #60 -- static XState machine extraction from real source.
//
// Deterministic, non-LLM, offline: parses a workflow file with the repo's
// existing typescript-estree wrapper (parseToAst) and walks it with
// estree-walker, finding every `createMachine({...})` /
// `setup({...}).createMachine({...})` call and turning its config object
// literal into a plain, JSON-serializable graph description. Nothing is
// executed or imported (workflow files are only ever *read*), nothing is
// persisted, and nothing leaves the machine -- deliberately NOT
// @statelyai/sdk's `extractMachines`, which POSTs the source to Stately's
// hosted API (see the license/privacy decision on issue #57).
//
// Anything not expressible as a static object literal (spreads, computed
// keys, config held in a variable, inline function guards are fine -- shown
// as "(inline guard)") degrades to a per-machine `error` string instead of
// throwing, so the UI can say "can't visualize this machine" for that one
// machine and still render the rest of the file.
import { parseToAst, walkAst } from '../ast/index.mjs';

class Unsupported extends Error {}

function isMachineCall(node) {
  if (node.type !== 'CallExpression') return false;
  const c = node.callee;
  if (c.type === 'Identifier') return c.name === 'createMachine';
  return c.type === 'MemberExpression' && !c.computed && c.property.type === 'Identifier' && c.property.name === 'createMachine';
}

function keyName(prop) {
  if (prop.type === 'SpreadElement') throw new Unsupported('object spread (...) is not statically resolvable');
  if (prop.computed) throw new Unsupported('computed property keys are not statically resolvable');
  if (prop.key.type === 'Identifier') return prop.key.name;
  if (prop.key.type === 'Literal') return String(prop.key.value);
  throw new Unsupported('unsupported property key');
}

/** Map of key -> value node for an ObjectExpression (throws Unsupported on
 * spreads/computed keys/methods-with-no-value). */
function propsOf(obj, what) {
  if (!obj || obj.type !== 'ObjectExpression') throw new Unsupported(`${what} is not an object literal`);
  const out = new Map();
  out.propNodes = new Map(); // key -> the Property node itself (ranges, for workflowEditor.mjs)
  out.objNode = obj;
  for (const prop of obj.properties) {
    const name = keyName(prop);
    out.set(name, prop.type === 'Property' ? prop.value : null);
    out.propNodes.set(name, prop);
  }
  return out;
}

function strOf(node) {
  if (!node) return undefined;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0].value.cooked;
  return undefined;
}

function guardLabel(node) {
  if (!node) return undefined;
  const s = strOf(node);
  if (s !== undefined) return s;
  if (node.type === 'ObjectExpression') {
    const t = strOf(propsOf(node, 'guard').get('type'));
    return t || '(guard)';
  }
  if (node.type === 'CallExpression' && node.callee.type === 'Identifier') return `${node.callee.name}(...)`;
  return '(inline guard)';
}

/** Resolve an XState target string against the source state's position.
 * Returns the full dotted path id, or null when it can't be resolved. */
function resolveTarget(target, fromPath, allPaths, machineId, idIndex) {
  if (target.startsWith('#')) {
    const [head, ...rest] = target.slice(1).split('.');
    const base = head === machineId ? '' : idIndex.get(head);
    if (base === undefined) return null;
    const full = [base, ...rest].filter(Boolean).join('.');
    return full === '' ? null : allPaths.has(full) ? full : null;
  }
  const parent = fromPath.includes('.') ? fromPath.slice(0, fromPath.lastIndexOf('.')) : '';
  const candidates = target.startsWith('.')
    ? [`${fromPath}.${target.slice(1)}`]
    : [parent ? `${parent}.${target}` : target, target];
  return candidates.find((c) => allPaths.has(c)) ?? null;
}

/** Normalize one transition value (string | object | array of either) into
 * [{target?, guard?, actions?}]; targets are raw strings here. */
function transitionsOf(value, what) {
  if (!value) return [{}];
  if (value.type === 'ArrayExpression') return value.elements.flatMap((e) => transitionsOf(e, what));
  const s = strOf(value);
  if (s !== undefined) return [{ target: s, targetNode: value }];
  if (value.type === 'ObjectExpression') {
    const p = propsOf(value, what);
    const tNode = p.get('target');
    let targets;
    if (tNode && tNode.type === 'ArrayExpression') targets = tNode.elements.filter((e) => strOf(e) !== undefined).map((e) => ({ target: strOf(e), targetNode: e }));
    else if (tNode) {
      const ts = strOf(tNode);
      if (ts === undefined) throw new Unsupported(`${what} has a non-literal target`);
      targets = [{ target: ts, targetNode: tNode }];
    }
    const guard = guardLabel(p.get('guard'));
    if (!targets) return [{ guard }];
    return targets.map((t) => ({ ...t, guard }));
  }
  throw new Unsupported(`${what} is not a string, object, or array literal`);
}

function collectStates(statesNode, parentPath, out, machineId, idIndex) {
  const states = propsOf(statesNode, 'states');
  for (const [name, node] of states) {
    const p = propsOf(node, `state "${name}"`);
    const path = parentPath ? `${parentPath}.${name}` : name;
    const explicitId = strOf(p.get('id'));
    if (explicitId) idIndex.set(explicitId, path);
    const entry = {
      path,
      name,
      parent: parentPath || null,
      type: strOf(p.get('type')) || (p.has('states') ? 'compound' : 'atomic'),
      initial: false,
      line: node.loc?.start.line,
      _node: p,
      _prop: states.propNodes.get(name),
      _value: node,
    };
    out.push(entry);
    if (p.has('states')) {
      const initial = strOf(p.get('initial'));
      const before = out.length;
      collectStates(p.get('states'), path, out, machineId, idIndex);
      const kids = out.slice(before).filter((s) => s.parent === path);
      const initialKid = kids.find((k) => k.name === initial);
      if (initialKid) initialKid.initial = true;
      entry.initialChild = initialKid ? initialKid.path : undefined;
    }
  }
}

function extractMachine(call, exportName, keep = false) {
  const machine = { exportName, id: exportName, line: call.loc?.start.line, initial: null, states: [], transitions: [], error: null };
  try {
    const cfg = propsOf(call.arguments[0], 'machine config');
    machine.hasExplicitId = !!strOf(cfg.get('id'));
    machine.id = strOf(cfg.get('id')) || exportName || 'machine';
    const raw = [];
    const idIndex = new Map();
    if (!cfg.has('states')) throw new Unsupported('the machine has no states object');
    collectStates(cfg.get('states'), '', raw, machine.id, idIndex);
    const initial = strOf(cfg.get('initial'));
    const top = raw.filter((s) => !s.parent);
    const initialState = top.find((s) => s.name === initial);
    if (initialState) initialState.initial = true;
    machine.initial = initialState ? initialState.path : null;
    const paths = new Set(raw.map((s) => s.path));
    const addEdge = (from, event, kind, value) => {
      for (const t of transitionsOf(value, `${kind} "${event}" of state "${from}"`)) {
        const resolved = t.target === undefined ? from : resolveTarget(t.target, from, paths, machine.id, idIndex);
        machine.transitions.push({
          ...(keep ? { _valueNode: value, _targetNode: t.targetNode, _multi: value.type === 'ArrayExpression' } : {}),
          from,
          event,
          kind,
          target: resolved,
          rawTarget: t.target,
          guard: t.guard,
          editable: kind === 'on' && value.type !== 'ArrayExpression' && t.target !== undefined && !t.guard,
          targetless: t.target === undefined,
          unresolved: t.target !== undefined && resolved === null,
        });
      }
    };
    const eventMap = (p, key, kind, from) => {
      const node = p.get(key);
      if (!node) return;
      for (const [event, value] of propsOf(node, `"${key}" of state "${from}"`)) addEdge(from, event, kind, value);
    };
    for (const s of raw) {
      const p = s._node;
      eventMap(p, 'on', 'on', s.path);
      eventMap(p, 'after', 'after', s.path);
      if (p.has('always')) addEdge(s.path, 'always', 'always', p.get('always'));
      if (p.has('onDone')) addEdge(s.path, 'onDone', 'onDone', p.get('onDone'));
      if (p.has('invoke')) {
        const inv = p.get('invoke');
        const invokes = inv.type === 'ArrayExpression' ? inv.elements : [inv];
        for (const i of invokes) {
          const ip = propsOf(i, `invoke of state "${s.path}"`);
          if (ip.has('onDone')) addEdge(s.path, 'invoke.onDone', 'invoke', ip.get('onDone'));
          if (ip.has('onError')) addEdge(s.path, 'invoke.onError', 'invoke', ip.get('onError'));
        }
      }
    }
    machine.states = raw.map(({ _node, _prop, _value, ...rest }) => ({ ...rest, final: rest.type === 'final', ...(keep ? { _props: _node, _prop, _value } : {}) }));
    if (keep) machine._cfg = cfg;
  } catch (e) {
    if (!(e instanceof Unsupported)) throw e;
    machine.states = [];
    machine.transitions = [];
    machine.initial = null;
    machine.error = e.message;
  }
  return machine;
}

/** (See extractMachines below.) Extract every XState machine defined in `source`. Always returns
 * `{ machines: [...], error: string|null }` and never throws: a file that
 * doesn't parse yields `error`; a machine whose config isn't statically
 * analyzable yields a machine entry with its own `error`. */
function analyze(source, keep) {
  let ast;
  try {
    ast = parseToAst(source);
  } catch (e) {
    return { machines: [], error: `Could not parse this file: ${String(e.message).split('\n')[0]}` };
  }
  const machines = [];
  walkAst(ast, {
    enter(node, parent) {
      if (!isMachineCall(node)) return;
      const exportName = parent?.type === 'VariableDeclarator' && parent.id.type === 'Identifier' ? parent.id.name : null;
      try {
        machines.push(extractMachine(node, exportName, keep));
      } catch (e) {
        machines.push({ exportName, id: exportName || 'machine', line: node.loc?.start.line, initial: null, states: [], transitions: [], error: `Unexpected error: ${e.message}` });
      }
    },
  });
  return { machines, error: null };
}

export function extractMachines(source) {
  return analyze(source, false);
}

/** Internal (used by workflowEditor.mjs): same as extractMachines but every
 * machine/state/transition also carries the AST nodes (`_cfg`, `_props`,
 * `_prop`, `_valueNode`, `_targetNode`) so edits can be made as exact source
 * range replacements. Not JSON-serializable; never sent to the client. */
export function analyzeMachines(source) {
  return analyze(source, true);
}
