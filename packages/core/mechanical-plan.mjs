// #605 -- the import plan, computed without a model.
//
// `construct import --route` first has to decide which layers each traced file becomes. That decision is
// mostly readable off the code itself: JSX means presentation, local React state means a hook, fetch means a
// service, a module of plain functions is domain. This module reads those signals from each file's syntax tree
// and returns the exact plan shape the LLM planner returns (`{ feature, units: [{ name, layers, from }] }`),
// plus a one-line reason per layer so a human approving the plan can see why. The model is still what ports the
// code; it just no longer has to be trusted to decide where the code goes.
import fs from 'node:fs';
import path from 'node:path';
import { ts } from '../ast/lazy.mjs';
import { LAYER_ORDER } from './generators.mjs';
import { normalizePlanLayers } from './import.mjs';

const STATE_HOOKS = new Set(['useState', 'useReducer', 'useEffect', 'useLayoutEffect', 'useRef', 'useMemo', 'useCallback', 'useContext', 'useSyncExternalStore']);
const IO_CALLS = new Set(['fetch', 'axios', 'createApi', 'fetchBaseQuery', 'XMLHttpRequest', 'WebSocket', 'EventSource']);
const IO_GLOBALS = new Set(['localStorage', 'sessionStorage', 'indexedDB']);
const MACHINE_CALLS = new Set(['createSlice', 'createReducer', 'createMachine', 'setup']);
const RTK_QUERY_HOOK = /^use[A-Z]\w*(?:Query|Mutation)$/;
const PASCAL = /^[A-Z][A-Za-z0-9]*$/;
const HOOK_NAME = /^use[A-Z0-9]/;

function scriptKindFor(file) {
  const ext = path.extname(file);
  if (ext === '.tsx') return ts.ScriptKind.TSX;
  if (ext === '.jsx') return ts.ScriptKind.JSX;
  if (ext === '.js' || ext === '.mjs') return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function calleeName(expr) {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) return calleeName(expr.expression);
  return null;
}

/**
 * Everything the planner needs to know about one source file, read from its syntax tree. Pure: same text in, same signals out.
 *
 * @param {string} source The file's text.
 * @param {string} [fileName] Used only to pick the parser flavour (.tsx, .ts, .jsx, .js).
 * @returns {{jsx:boolean, stateHooks:Set<string>, io:Set<string>, machine:Set<string>, definedHooks:string[], components:string[], pureFunctions:string[], hasRuntime:boolean, onlyReexports:boolean}} The signals found.
 */
export function readSignals(source, fileName = 'file.tsx') {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, scriptKindFor(fileName));
  const s = {
    jsx: false,
    stateHooks: new Set(),
    io: new Set(),
    machine: new Set(),
    definedHooks: [],
    components: [],
    pureFunctions: [],
    exportedRuntime: 0,
    onlyReexports: false,
    hasRuntime: false,
    hasDefaultExport: false,
    reexports: 0,
  };

  const noteFunction = (name, isExported) => {
    if (!name) return;
    if (HOOK_NAME.test(name)) s.definedHooks.push(name);
    else if (PASCAL.test(name)) s.components.push(name);
    else if (isExported) s.pureFunctions.push(name);
  };

  for (const stmt of sf.statements) {
    const exported = !!(ts.getCombinedModifierFlags(stmt) & ts.ModifierFlags.Export);
    if (ts.isImportDeclaration(stmt) || ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)) continue;
    if (ts.isExportDeclaration(stmt)) {
      if (stmt.moduleSpecifier) s.reexports++;
      continue;
    }
    if (ts.isExportAssignment(stmt)) {
      s.hasDefaultExport = true;
      s.hasRuntime = true;
      continue;
    }
    s.hasRuntime = true;
    if (exported) s.exportedRuntime++;
    if (ts.isFunctionDeclaration(stmt)) noteFunction(stmt.name?.text, exported);
    else if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(d.name)) continue;
        const init = d.initializer;
        if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) noteFunction(d.name.text, exported);
        else if (exported && !PASCAL.test(d.name.text)) s.pureFunctions.push(d.name.text);
      }
    }
  }

  const visit = (node) => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) s.jsx = true;
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const name = node.expression ? calleeName(node.expression) : null;
      if (name) {
        if (STATE_HOOKS.has(name)) s.stateHooks.add(name);
        if (IO_CALLS.has(name) || RTK_QUERY_HOOK.test(name)) s.io.add(name);
        if (MACHINE_CALLS.has(name)) s.machine.add(name);
      }
    }
    if (ts.isIdentifier(node) && IO_GLOBALS.has(node.text)) s.io.add(node.text);
    if (ts.isSwitchStatement(node) && /\.type\b|\.kind\b/.test(node.expression.getText(sf))) s.machine.add('switch on action.type');
    ts.forEachChild(node, visit);
  };
  visit(sf);
  s.onlyReexports = s.reexports > 0 && !s.hasRuntime;
  return s;
}

/**
 * Turn one file's signals into `{ layers, reasons }`, or `{ skip }` with why it is not a layer of its own.
 *
 * @param {object} signals The result of `readSignals`.
 * @param {{isEntry?: boolean}} [options] `isEntry` marks the route entry file (page + controller).
 * @returns {{layers?: string[], reasons?: Record<string,string>, skip?: string}} Layers in build order with a reason each, or why the file is skipped.
 */
export function classify(signals, { isEntry = false } = {}) {
  const reasons = {};
  const layers = new Set();
  const add = (layer, why) => {
    layers.add(layer);
    reasons[layer] = why;
  };

  if (!isEntry && signals.onlyReexports) return { skip: 're-exports only (a barrel): the feature index.ts is generated instead' };
  if (!isEntry && !signals.hasRuntime) return { skip: 'types only: nothing runtime to port' };

  const ownState = [...signals.stateHooks];
  const io = [...signals.io];

  if (isEntry) {
    add('page', 'route entry file: the page composes the UI');
    add('controller', 'route entry file: the controller wires the page to the route');
  } else if (signals.jsx) {
    add('component', `renders JSX (${signals.components.slice(0, 3).join(', ') || 'anonymous component'})`);
  }

  if (signals.definedHooks.length) add('hook', `defines ${signals.definedHooks.slice(0, 3).join(', ')}`);
  else if (signals.jsx && ownState.length) add('hook', `keeps its own state/effects in the component (${ownState.slice(0, 3).join(', ')}): the logic moves to a hook`);

  if (io.length) add('service', `talks to the outside world (${io.slice(0, 3).join(', ')}): effects live in a service`);
  if (signals.machine.size) add('workflow', `state machine shape (${[...signals.machine].slice(0, 2).join(', ')})`);

  const uiOrLogicOnlyFile = signals.jsx || signals.definedHooks.length;
  if (uiOrLogicOnlyFile && signals.pureFunctions.length) {
    add('domain', `exports pure helpers next to the UI/hook (${signals.pureFunctions.slice(0, 3).join(', ')})`);
  } else if (!uiOrLogicOnlyFile && !io.length && !signals.machine.size && !isEntry) {
    add('domain', signals.pureFunctions.length ? `plain functions with no UI, state or I/O (${signals.pureFunctions.slice(0, 3).join(', ')})` : 'plain values/functions with no UI, state or I/O');
  }

  if (!layers.size) return { skip: 'no layer signal found' };
  return { layers: LAYER_ORDER.filter((l) => layers.has(l)), reasons };
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function unitNameFor(absFile, layers, entryName) {
  if (entryName) return entryName;
  let base = path.basename(absFile).replace(/\.(t|j)sx?$/, '').replace(/\.(mjs|cjs)$/, '');
  if (/^(page|index|route|layout)$/i.test(base)) base = path.basename(path.dirname(absFile));
  const pascal = base.split(/[^A-Za-z0-9]+/).filter(Boolean).map(cap).join('');
  const stripped = layers.includes('hook') && /^Use[A-Z0-9]/.test(pascal) ? pascal.slice(3) : pascal;
  return stripped || pascal || 'Unit';
}

/**
 * Plan an import without asking a model.
 *
 * @param {string[]} absPaths Traced source files, in discovery order (each route's entry file first).
 * @param {string} featureName Destination feature.
 * @param {{entryFiles?: string[]}} [options] The route entry file(s); default: the first file.
 * @returns {{feature:string, units:{name:string, layers:string[], from:string, reasons:object}[], skipped:{file:string, reason:string}[], layerAdjustments?:object[]}}
 */
export function planMechanically(absPaths, featureName, { entryFiles } = {}) {
  const files = absPaths.map((p) => path.resolve(p));
  const entries = new Set((entryFiles?.length ? entryFiles : files.slice(0, 1)).map((p) => path.resolve(p)));
  const units = [];
  const skipped = [];
  const usedNames = new Map();

  for (const from of files) {
    let source;
    try {
      source = fs.readFileSync(from, 'utf8');
    } catch (e) {
      skipped.push({ file: from, reason: `unreadable: ${e.message}` });
      continue;
    }
    const result = classify(readSignals(source, from), { isEntry: entries.has(from) });
    if (result.skip) {
      skipped.push({ file: from, reason: result.skip });
      continue;
    }
    const isEntry = entries.has(from);
    let name = unitNameFor(from, result.layers, isEntry && !usedNames.has(cap(featureName)) ? cap(featureName) : undefined);
    const count = usedNames.get(name) || 0;
    usedNames.set(name, count + 1);
    if (count) name = `${cap(path.basename(path.dirname(from)).replace(/[^A-Za-z0-9]/g, ''))}${name}`;
    units.push({ name, layers: result.layers, from, reasons: result.reasons });
  }

  // Build order: what the others depend on first. Domain/service leaves before hooks before UI, entry last.
  const rank = (u) => (entries.has(u.from) ? 1000 : Math.min(...u.layers.map((l) => LAYER_ORDER.indexOf(l))));
  units.sort((a, b) => rank(a) - rank(b));

  const plan = { feature: featureName, units, skipped };
  const adjustments = normalizePlanLayers(plan);
  if (adjustments.length) plan.layerAdjustments = adjustments;
  return plan;
}
