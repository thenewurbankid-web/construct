// cu4 -- the Components editor: one component's Behaviour, Events and States, over Studio's linked Editor parts.

// Wrapped, not rebuilt: Studio's Editor parts (vision-architect-pipeline studio/src, linked as @mx/studio-editor in
// packages/line-links) do the work. Its pure edits (plan/editorTools.ts applyEditorCall over EDITOR_WRITES) change a
// component's working copy (Morpheus's ComponentApiEdits), and its pure views (editor/behaviourView.ts primitivesOn,
// roleChips, statesOf, statePreview; editor/eventFlow.ts eventGroups, conflictsIfAdded; Morpheus's primitiveDiagram and
// compatiblePrimitives) say what the Behaviour, Events and States tabs show. Construct adds only what Studio does not
// have: reading a Line component's API from its code, where the working copy lives in a Line project, the library rule
// (library items are complete and never changed here) and the plan steps, so every edit goes through the checked
// writer (applyChange) after a person approves it.
//
// The working copy of a feature component lives beside it as `<Name>.behaviour.json` (Studio's ComponentApiEdits, plus
// the current state of each primitive); it is not an item file, so the Line rules ignore it.
//
// No single point of failure: when the link is down every read still answers (props, slots, events and the When -> Do
// wires as plain sentences, "Read by: static") and the event edits run on a small static copy of Studio's; attaching a
// behaviour and changing a state need Studio's diagrams, so they are refused in one sentence saying why.
import fs from 'node:fs';
import path from 'node:path';
import { parseToAst } from '@construct/ast';
import { importLinked, readLinks, sourceDirOf } from '../../line-links/index.mjs';
import { LineOpError } from './contract.mjs';
import { readLineProject } from './model.mjs';
import { planBaseOn } from './ops.mjs';

const posix = path.posix;
const EVENT_PROP = /^on[A-Z]/;
const SLOT_TYPE = /^(?:React\.)?(?:ReactNode|ReactElement|JSX\.Element)$/;
const ID_EVENT = /^ev-\d{1,4}$/;
/** A working copy with nothing in it (Morpheus's EMPTY_API_EDITS). */
const EMPTY = Object.freeze({ added: [], changed: {}, events: [], primitives: [] });
const asSentence = (s) => { const t = String(s ?? '').trim() || 'Something went wrong'; return /[.?!]$/.test(t) ? t : `${t}.`; };
const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);

// ------------------------------------------------------------------------------------------- Studio's parts
/**
 * @typedef {object} StudioEditor
 * @property {boolean} ok
 * @property {string} sentence  Where the parts come from, in one sentence.
 * @property {any} [tools]      plan/editorTools.ts (applyEditorCall, EDITOR_WRITES)
 * @property {any} [behaviour]  editor/behaviourView.ts
 * @property {any} [events]     editor/eventFlow.ts
 * @property {any} [edits]      editor/apiEdits.ts
 * @property {any} [diagram]    src/morpheus/ownLibrary/primitiveDiagram.ts
 * @property {any} [compat]     src/morpheus/ownLibrary/compatibility.ts
 * @property {any} [plan]       src/morpheus/ownLibrary/apiPlan.ts
 */

/**
 * Load Studio's Editor parts through the link. Never throws: a link that is down answers `{ok: false, sentence}`.
 * @param {{env?: NodeJS.ProcessEnv}} [o]
 * @returns {Promise<StudioEditor>}
 */
export async function loadStudioEditor(o = {}) {
  const linked = await importLinked('@mx/studio-editor', o.env ? { env: o.env } : {});
  if (linked.ok === false) return { ok: false, sentence: `Studio's Behaviour and Events parts are not linked (${lower(linked.reason).replace(/[.]$/, '')}), so Cockpit shows the component's events as plain sentences and cannot draw its behaviour.` };
  try {
    const table = readLinks();
    const studioSrc = path.join(sourceDirOf(table, o.env ?? process.env), table.links['@mx/studio-editor'].path);
    const at = (rel) => import(path.join(studioSrc, rel));
    const [behaviour, events, edits, diagram, compat, plan] = await Promise.all([
      at('editor/behaviourView.ts'), at('editor/eventFlow.ts'), at('editor/apiEdits.ts'),
      at('../../src/morpheus/ownLibrary/primitiveDiagram.ts'), at('../../src/morpheus/ownLibrary/compatibility.ts'), at('../../src/morpheus/ownLibrary/apiPlan.ts'),
    ]);
    return { ok: true, sentence: 'Behaviour, Events and States come from Studio\'s Editor parts (linked).', tools: linked.module, behaviour, events, edits, diagram, compat, plan };
  } catch (e) {
    return { ok: false, sentence: `Studio's Behaviour and Events parts could not be loaded (${String(/** @type {any} */ (e)?.message ?? e).split('\n')[0].slice(0, 160)}), so Cockpit shows the component's events as plain sentences and cannot draw its behaviour.` };
  }
}

/** The parts every call here uses; loaded once when this module loads (the plan ops are synchronous). */
let STUDIO = await loadStudioEditor();
/**
 * Studio's Editor parts as this process loaded them (or why not).
 * @returns {StudioEditor}
 */
export const studioEditor = () => STUDIO;
/**
 * Tests only: run as if the link were down (`false`), or load it again (`true`).
 * @param {boolean} on
 */
export async function setStudioLinked(on) {
  STUDIO = on ? await loadStudioEditor() : { ok: false, sentence: 'Studio\'s Behaviour and Events parts are not linked (switched off for this test), so Cockpit shows the component\'s events as plain sentences and cannot draw its behaviour.' };
}

// ------------------------------------------------------------------------------------------- the component's API
/** The type text of a TS type node, simplified to what Morpheus's PropSpec can hold. */
function propSpecOf(t, optional) {
  const required = !optional;
  if (!t) return null;
  if (t.type === 'TSStringKeyword') return { type: 'string', required };
  if (t.type === 'TSNumberKeyword') return { type: 'number', required };
  if (t.type === 'TSBooleanKeyword') return { type: 'boolean', required };
  if (t.type === 'TSUnionType') {
    const values = t.types.filter((x) => x.type === 'TSLiteralType' && (typeof x.literal.value === 'string' || typeof x.literal.value === 'number')).map((x) => x.literal.value);
    const rest = t.types.filter((x) => !(x.type === 'TSLiteralType') && x.type !== 'TSUndefinedKeyword' && x.type !== 'TSNullKeyword');
    if (values.length && !rest.length) return { type: 'enum', required, values };
    if (rest.length === 1 && !values.length) return propSpecOf(rest[0], true);
  }
  if (t.type === 'TSArrayType' && t.elementType.type === 'TSStringKeyword') return { type: 'string-list', required };
  return null;
}

/** The name of a type reference (`ReactNode`, `React.ReactNode`). */
function refName(t) {
  if (!t || t.type !== 'TSTypeReference') return '';
  const n = t.typeName;
  return n.type === 'Identifier' ? n.name : n.type === 'TSQualifiedName' ? `${n.left.name}.${n.right.name}` : '';
}

/** The members of the props type of the exported function `name` (inline, or a local interface or type alias). */
function propMembers(ast, name) {
  /** @type {Map<string, any[]>} */
  const local = new Map();
  let fn = null;
  for (const node of ast.body) {
    const d = node.type === 'ExportNamedDeclaration' && node.declaration ? node.declaration : node;
    if (d.type === 'TSInterfaceDeclaration') local.set(d.id.name, d.body.body);
    if (d.type === 'TSTypeAliasDeclaration' && d.typeAnnotation.type === 'TSTypeLiteral') local.set(d.id.name, d.typeAnnotation.members);
    if (d.type === 'FunctionDeclaration' && d.id?.name === name) fn = d;
    if (d.type === 'VariableDeclaration') {
      for (const v of d.declarations) if (v.id.type === 'Identifier' && v.id.name === name && v.init && /Function/.test(v.init.type)) fn = v.init;
    }
  }
  const param = fn?.params?.[0];
  const t = param?.typeAnnotation?.typeAnnotation;
  if (!t) return [];
  if (t.type === 'TSTypeLiteral') return t.members;
  const named = refName(t);
  return local.get(named) ?? [];
}

/**
 * A Line component as Morpheus's LibraryComponent sees it: its props (text, number, true/false, a choice), the props
 * that take content (slots) and its event props, read from its code. Pure.
 * @param {string} source The component file's code.
 * @param {string} name Its export name.
 * @param {string} file Its root-relative path.
 * @returns {any} The LibraryComponent fields Studio's parts read (name, file, props, slots, events, renders, parts).
 */
export function componentApiOf(source, name, file) {
  let ast = null;
  try { ast = parseToAst(source); } catch { ast = null; }
  /** @type {Record<string, any>} */
  const props = {};
  const slots = [];
  const events = [];
  const skipped = [];
  for (const m of ast ? propMembers(ast, name) : []) {
    if (m.type !== 'TSPropertySignature' || m.key?.type !== 'Identifier') continue;
    const key = m.key.name;
    const t = m.typeAnnotation?.typeAnnotation;
    if (EVENT_PROP.test(key) && t?.type === 'TSFunctionType') { events.push(key); continue; }
    if (key === 'children' || SLOT_TYPE.test(refName(t))) { slots.push(key); continue; }
    const spec = propSpecOf(t, Boolean(m.optional));
    if (spec) props[key] = spec; else skipped.push(`${key}: not a simple type`);
  }
  const renders = [...source.matchAll(/<([A-Z][A-Za-z0-9]*)\b/g)].map((x) => x[1]).filter((x, i, all) => x !== name && all.indexOf(x) === i);
  return { name, file, level: 'molecule', renders, usedBy: [], props, slots, events, skipped, parts: [] };
}

// ------------------------------------------------------------------------------------------- where it lives
/**
 * Where a component's working copy lives: `features/orders/components/OrderButton.tsx` -> `...OrderButton.behaviour.json`.
 * @param {string} file The component's root-relative path.
 * @returns {string} The working copy's root-relative path.
 */
export const workingCopyPath = (file) => `${file.slice(0, file.length - posix.extname(file).length)}.behaviour.json`;

/**
 * The component at `file`, as a library item or a feature item of the project. Throws a LineOpError for anything else.
 * @param {string} root @param {unknown} file
 */
function componentAt(root, file) {
  const rel = String(file ?? '');
  const p = readLineProject(root);
  const lib = p.library.find((l) => l.file === rel);
  if (lib) {
    if (lib.kind !== 'components') throw new LineOpError(`${lib.name} is a library ${lib.kind.replace(/s$/, '')}, not a component; open a component.`, 'NOT_A_COMPONENT');
    return { project: p, kind: /** @type {const} */ ('library'), item: lib, name: lib.name, file: rel, feature: null, base: null };
  }
  const item = p.features.flatMap((f) => f.items).find((i) => i.file === rel);
  if (!item) throw new LineOpError(`There is no component "${rel}" in this project; pick one from the library or a feature.`, 'UNKNOWN_ITEM');
  if (item.kind !== 'components') throw new LineOpError(`${item.name} is a feature ${item.kind.replace(/s$/, '')}, not a component; open a component.`, 'NOT_A_COMPONENT');
  return { project: p, kind: /** @type {const} */ ('feature'), item, name: item.name, file: rel, feature: item.feature, base: item.base ?? null };
}

const readText = (root, rel) => { try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch { return null; } };

/**
 * The working copy beside a feature component: `{edits, current}`. A missing or unreadable file is an empty copy.
 * @param {string} root @param {string} file
 * @returns {{edits: any, current: Record<string, string>}}
 */
function readWorkingCopy(root, file) {
  const text = readText(root, workingCopyPath(file));
  if (text === null) return { edits: { ...EMPTY }, current: {} };
  try {
    const v = JSON.parse(text);
    const edits = v && typeof v.edits === 'object' && v.edits ? v.edits : { ...EMPTY };
    return { edits: { ...EMPTY, ...edits }, current: v && typeof v.current === 'object' && v.current ? v.current : {} };
  } catch {
    return { edits: { ...EMPTY }, current: {} };
  }
}

const copyText = (name, edits, current) => `${JSON.stringify({ $lineEditor: 1, component: name, edits, current }, null, 2)}\n`;

/** A library component is complete and never changed here: one sentence, plus "base a feature item on it" as a typed fix. */
function libraryRefusal(c) {
  const feature = c.project.features[0]?.name ?? null;
  const name = feature ? `${feature.charAt(0).toUpperCase()}${feature.slice(1).replace(/s$/, '')}${c.name}` : null;
  const e = new LineOpError(`${c.name} is a library component, which stays complete and is never changed here; base a feature item on it and change that.`, 'LIBRARY_ITEM');
  /** @type {any} */ (e).fixes = feature && name
    ? [{ id: `LIBRARY_ITEM/base-on:${c.item.id}`, sentence: `Base a new feature component ${name} in ${feature} on ${c.name}, then change that.`, rank: 1, step: { tool: 'line.baseOn', args: { libraryId: c.item.id, feature, name } } }]
    : [];
  return e;
}

/** The feature component a write tool changes, its API and its working copy. Library components are refused. */
function editable(root, file) {
  const c = componentAt(root, file);
  if (c.kind === 'library') throw libraryRefusal(c);
  const source = readText(root, c.file) ?? '';
  const api = componentApiOf(source, c.name, c.file);
  // A feature component wraps its library base and passes its props through, so it has the base's API.
  const lib = c.base?.libraryId ? c.project.library.find((l) => l.id === c.base.libraryId) : null;
  const libApi = lib ? componentApiOf(readText(root, lib.file) ?? '', lib.name, lib.file) : null;
  const merged = libApi && !Object.keys(api.props).length && !api.slots.length && !api.events.length ? { ...libApi, name: c.name, file: c.file } : api;
  return { ...c, api: merged, ...readWorkingCopy(root, c.file) };
}

// ------------------------------------------------------------------------------------------- static fallback
/** Plain-English words for an event's source and action when Studio is not linked. */
function staticSourceWords(s) {
  if (s.kind === 'click') return `When ${s.slot === 'children' ? 'its content' : `the ${s.slot}`} is clicked`;
  if (s.kind === 'event') return `When ${s.prop} fires`;
  return `When the ${String(s.primitive).replace(/^used:/, '').replace(/-\d+$/, '')} changes`;
}
function staticActionWords(a) {
  if (a.kind === 'primitive') return `${a.action} the ${String(a.primitive).replace(/^used:/, '').replace(/-\d+$/, '')}`;
  if (a.kind === 'set') return `set ${a.prop} to ${JSON.stringify(a.value)}`;
  return `tell the page through ${a.name}`;
}
/** Studio's addEvent/updateEvent as plain array edits (the static path). */
const STATIC_EDITS = {
  'editor.addEvent': (edits, a) => {
    const n = Math.max(0, ...edits.events.map((e) => Number(String(e.id).slice(3)) || 0)) + 1;
    return { ...edits, events: [...edits.events, { id: `ev-${n}`, source: a.source, action: a.action }] };
  },
  'editor.updateEvent': (edits, a) => ({ ...edits, events: edits.events.map((e) => (e.id === a.id ? { ...e, action: a.action } : e)) }),
};

/** Apply one of Studio's editor calls to a working copy (Studio's own when linked, else the static copy). */
function applyCall(edits, tool, args) {
  if (STUDIO.ok) {
    try {
      return STUDIO.tools.applyEditorCall(edits, { tool, args });
    } catch (e) {
      const issues = /** @type {any} */ (e)?.issues;
      const why = Array.isArray(issues) && issues.length ? issues.map((i) => `${(i.path ?? []).join('.') || 'args'} ${i.message}`).join('; ') : String(/** @type {any} */ (e)?.message ?? e).split('\n')[0];
      throw new LineOpError('Studio could not apply this change to the component, so nothing was planned.', 'BAD_EDIT', why);
    }
  }
  const run = STATIC_EDITS[tool];
  if (!run) throw new LineOpError(STUDIO.sentence.replace(/, so Cockpit shows.*$/, ', so this change cannot be planned until the link is back.'), 'STUDIO_DOWN');
  return run(edits, args);
}

// ------------------------------------------------------------------------------------------- the view
/** A primitive's state diagram in the shape Cockpit's state diagram draws (cw1's LineWorkflow states/transitions). */
function diagramOf(on, current) {
  const d = STUDIO.diagram.primitiveDiagram(on.primitive, on.settings ?? {});
  const at = current[on.ref] && d.states.some((s) => s.id === current[on.ref]) ? current[on.ref] : d.initial;
  return {
    initial: d.initial,
    current: at,
    states: d.states.map((s) => ({ id: s.id, label: s.label, sentence: s.sentence, initial: s.id === d.initial, final: false, role: null, page: null, current: s.id === at })),
    transitions: d.transitions.map((t, i) => ({ id: `${t.from}|${t.action}|${i}`, from: t.from, to: t.to, event: t.label, origin: 'library', when: `When it is ${t.from}:`, do: `${t.label}.` })),
  };
}

/**
 * Everything the Components editor shows for one component: its API, Behaviour (primitives with role chips and a
 * state diagram, plus the behaviours that fit), Events (When -> Do groups with conflict warnings and their fixes, plus
 * the sources and actions the form offers) and States (the component's states, and each primitive's current state).
 * A library component reads the same, with `readOnly` and the sentence that says how to change it.
 * @param {string} root
 * @param {string} file
 * @returns {any} LineComponentEditor (contract.mjs).
 */
export function readLineComponent(root, file) {
  const c = componentAt(root, file);
  const source = readText(root, c.file) ?? '';
  let api = componentApiOf(source, c.name, c.file);
  const lib = c.kind === 'feature' && c.base?.libraryId ? c.project.library.find((l) => l.id === c.base.libraryId) : null;
  if (lib && !Object.keys(api.props).length && !api.slots.length && !api.events.length) api = { ...componentApiOf(readText(root, lib.file) ?? '', lib.name, lib.file), name: c.name, file: c.file };
  const { edits, current } = c.kind === 'feature' ? readWorkingCopy(root, c.file) : { edits: { ...EMPTY }, current: {} };
  const base = {
    file: c.file, name: c.name, kind: c.kind, feature: c.feature, baseName: lib?.name ?? null,
    readOnly: c.kind === 'library',
    readOnlySentence: c.kind === 'library' ? `${c.name} is a library component: complete, used as it is and never changed here. Base a feature item on it to change its behaviour.` : null,
    api: { props: Object.entries(api.props).map(([n, s]) => ({ name: n, type: s.type, values: s.values ?? [] })), slots: api.slots, events: api.events },
    via: STUDIO.ok ? 'studio' : 'static', viaSentence: STUDIO.sentence,
  };
  const actionChoices = (refs) => [
    ...refs.flatMap((r) => (STUDIO.ok ? STUDIO.plan.PRIMITIVE_ACTIONS[r.primitive] ?? [] : []).filter((x) => !x.needsKey).map((x) => ({ id: `primitive:${r.ref}:${x.action}`, label: `${x.label} (${r.label})`, action: { kind: 'primitive', primitive: r.ref, action: x.action } }))),
    ...Object.entries(api.props).filter(([, s]) => s.type === 'boolean').flatMap(([n]) => [true, false].map((v) => ({ id: `set:${n}:${v}`, label: `Set ${n} to ${v}`, action: { kind: 'set', prop: n, value: v } }))),
  ];
  const sourceChoices = (refs) => [
    ...api.slots.map((s) => ({ id: `click:${s}`, label: `${s === 'children' ? 'Its content' : `The ${s}`} is clicked`, source: { kind: 'click', slot: s } })),
    ...api.events.map((p) => ({ id: `event:${p}`, label: `${p} fires`, source: { kind: 'event', prop: p } })),
    ...refs.map((r) => ({ id: `change:${r.ref}`, label: `${r.label} changes`, source: { kind: 'change', primitive: r.ref } })),
  ];
  if (!STUDIO.ok) {
    const refs = edits.primitives.map((p) => ({ ref: p.id, primitive: p.primitive, label: `The ${p.primitive}` }));
    return {
      ...base,
      behaviour: { primitives: refs.map((r) => ({ ref: r.ref, primitive: r.primitive, origin: 'attached', roles: [], diagram: null })), fits: [] },
      events: {
        groups: edits.events.map((w) => ({ key: w.id, label: staticSourceWords(w.source), sentence: staticSourceWords(w.source), actions: [{ wire: w.id, label: staticActionWords(w.action), sentence: `${staticSourceWords(w.source)}, ${staticActionWords(w.action)}.` }], conflicts: [], fix: null })),
        sources: sourceChoices(refs), actions: actionChoices(refs),
      },
      states: { rows: [{ id: 'base', name: 'Normal', origin: 'base', sentence: 'Shows when no other state is on.' }], current: [] },
    };
  }
  const S = STUDIO;
  const on = S.behaviour.primitivesOn(api, edits, []);
  const refs = on.map((p) => ({ ref: p.ref, primitive: p.primitive, label: `The ${S.plan.shortPrimitiveWords ? S.plan.shortPrimitiveWords(p.primitive) : p.primitive}` }));
  const primitives = on.map((p) => ({
    ref: p.ref, primitive: p.primitive, origin: p.origin,
    roles: S.behaviour.roleChips(api, p).map((r) => ({ role: r.role, label: r.label, sentence: r.sentence })),
    diagram: diagramOf(p, current),
  }));
  const attachedKinds = new Set(edits.primitives.map((p) => p.primitive));
  const fits = S.compat.compatiblePrimitives(api, []).filter((f) => !attachedKinds.has(f.primitive)).map((f) => ({ primitive: f.primitive, reason: f.reason, mapping: f.mapping }));
  const groups = S.events.eventGroups(api, edits).map((g) => ({
    key: g.key, label: g.label, sentence: g.sentence,
    actions: g.actions.map((a) => ({ wire: a.wire, label: a.label, sentence: a.sentence })),
    conflicts: g.conflicts,
    fix: g.fix ? { label: g.fix.label, sentence: g.fix.sentence, remove: [...g.fix.remove], add: g.fix.add.map((x) => ({ source: x.source, action: x.action })) } : null,
  }));
  const sv = S.behaviour.statesOf(api, edits);
  const rows = [sv.base, ...sv.own, ...sv.added].map((r) => ({ id: r.id, name: r.name, origin: r.origin, sentence: r.sentence }));
  const currentRows = on.map((p) => {
    const d = diagramOf(p, current);
    const st = d.states.find((s) => s.current);
    const shows = S.behaviour.statePreview(api, p, d.current);
    return { ref: p.ref, primitive: p.primitive, state: d.current, label: st?.label ?? d.current, sentence: st?.sentence ?? '', shows: shows ? Object.entries(shows).map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join(', ') : null };
  });
  return { ...base, behaviour: { primitives, fits }, events: { groups, sources: sourceChoices(refs), actions: actionChoices(refs) }, states: { rows, current: currentRows } };
}

// ------------------------------------------------------------------------------------------- the plan ops
/** One working-copy change as a StagedChange: the sidecar file, rewritten whole. */
function stagedCopy(c, edits, current, summary) {
  return { summary: asSentence(summary), files: [{ path: workingCopyPath(c.file), content: copyText(c.name, edits, current) }] };
}

/** Refuse a change that changes nothing. */
function changed(before, after, sentence) {
  if (JSON.stringify(before) === JSON.stringify(after)) throw new LineOpError(sentence, 'NO_CHANGE');
}

/**
 * line.attachComponentPrimitive (Behaviour): attach one of Morpheus's behaviour primitives, its roles mapped to the
 * component's parts (Studio's editor.attachPrimitive). The mapping defaults to what Morpheus suggests for it.
 * @param {string} root @param {{file: string, primitive: string, mapping?: Record<string, string>}} req
 */
function planAttachComponentPrimitive(root, req = /** @type {any} */ ({})) {
  const c = editable(root, req.file);
  if (!STUDIO.ok) throw new LineOpError(STUDIO.sentence.replace(/, so Cockpit shows.*$/, ', so a behaviour cannot be attached until the link is back.'), 'STUDIO_DOWN');
  const fit = STUDIO.compat.compatiblePrimitives(c.api, []).find((f) => f.primitive === req.primitive);
  if (!fit) throw new LineOpError(`The ${req.primitive ?? ''} behaviour does not fit ${c.name}: it has no part or prop that can play its roles.`, 'NO_FIT');
  if (c.edits.primitives.some((p) => p.primitive === req.primitive)) throw new LineOpError(`${c.name} already has the ${req.primitive} behaviour.`, 'NO_CHANGE');
  const mapping = req.mapping && Object.keys(req.mapping).length ? req.mapping : fit.mapping;
  const edits = applyCall(c.edits, 'editor.attachPrimitive', { primitive: req.primitive, mapping });
  return stagedCopy(c, edits, c.current, `Gives ${c.name} in ${c.feature} the ${req.primitive} behaviour (${Object.entries(mapping).map(([r, p]) => `${r}: ${p}`).join(', ')})`);
}

/**
 * line.addComponentEvent (Events): add one When -> Do (Studio's editor.addEvent). A pair of actions that undo each
 * other is not refused: the card shows Studio's conflict warning and its fix.
 * @param {string} root @param {{file: string, source: any, action: any}} req
 */
function planAddComponentEvent(root, req = /** @type {any} */ ({})) {
  const c = editable(root, req.file);
  const s = req.source;
  if (s?.kind === 'click' && !c.api.slots.includes(s.slot)) throw new LineOpError(`${c.name} has no part "${s.slot}" to click; pick one of ${c.api.slots.join(', ') || 'none (it has no parts that take content)'}.`, 'UNKNOWN_PART');
  if (s?.kind === 'event' && !c.api.events.includes(s.prop)) throw new LineOpError(`${c.name} has no event "${s.prop}"; pick one of ${c.api.events.join(', ') || 'none'}.`, 'UNKNOWN_EVENT');
  const refs = new Set(c.edits.primitives.map((p) => p.id));
  for (const r of [s?.kind === 'change' ? s.primitive : null, req.action?.kind === 'primitive' ? req.action.primitive : null]) {
    if (r && !refs.has(r)) throw new LineOpError(`${c.name} has no behaviour "${r}"; attach one on the Behaviour tab first.`, 'UNKNOWN_BEHAVIOUR');
  }
  if (req.action?.kind === 'set' && !Object.prototype.hasOwnProperty.call(c.api.props, req.action.prop)) throw new LineOpError(`${c.name} has no prop "${req.action.prop}" to set.`, 'UNKNOWN_PROP');
  const edits = applyCall(c.edits, 'editor.addEvent', { source: s, action: req.action });
  changed(c.edits, edits, 'This When -> Do is already there.');
  const wire = edits.events[edits.events.length - 1];
  const sentence = STUDIO.ok ? STUDIO.events.eventGroups(c.api, edits).flatMap((g) => g.actions).find((a) => a.wire === wire.id)?.sentence : null;
  return stagedCopy(c, edits, c.current, `Adds to ${c.name}: ${lower(sentence ?? `${staticSourceWords(s)}, ${staticActionWords(req.action)}.`)}`);
}

/**
 * line.changeComponentEvent (Events): change what one When -> Do does (Studio's editor.updateEvent).
 * @param {string} root @param {{file: string, id: string, action: any}} req
 */
function planChangeComponentEvent(root, req = /** @type {any} */ ({})) {
  const c = editable(root, req.file);
  if (!ID_EVENT.test(String(req.id ?? '')) || !c.edits.events.some((e) => e.id === req.id)) throw new LineOpError(`${c.name} has no When -> Do "${req.id ?? ''}"; pick one of its cards.`, 'UNKNOWN_EVENT');
  const edits = applyCall(c.edits, 'editor.updateEvent', { id: req.id, action: req.action });
  changed(c.edits, edits, 'That When -> Do already does this.');
  return stagedCopy(c, edits, c.current, `Changes what ${c.name} does for ${req.id}: ${STUDIO.ok ? 'as the card now says' : staticActionWords(req.action)}`);
}

/**
 * line.fixComponentEvent (Events): apply the fix Studio offers for a conflict (Studio's editor.fixEvent).
 * @param {string} root @param {{file: string, label: string, remove: string[], add: any[]}} req
 */
function planFixComponentEvent(root, req = /** @type {any} */ ({})) {
  const c = editable(root, req.file);
  if (!STUDIO.ok) throw new LineOpError(STUDIO.sentence.replace(/, so Cockpit shows.*$/, ', so its fixes cannot be applied until the link is back.'), 'STUDIO_DOWN');
  for (const id of req.remove ?? []) if (!c.edits.events.some((e) => e.id === id)) throw new LineOpError(`${c.name} has no When -> Do "${id}" to replace; read the component again.`, 'UNKNOWN_EVENT');
  const edits = applyCall(c.edits, 'editor.fixEvent', { label: req.label, remove: req.remove ?? [], add: req.add ?? [] });
  changed(c.edits, edits, 'This fix changes nothing.');
  return stagedCopy(c, edits, c.current, `${req.label} on ${c.name}`);
}

/**
 * line.setComponentState (States): the state one behaviour is in, picked on its state graph (what the feature
 * component starts in and what its preview shows).
 * @param {string} root @param {{file: string, ref: string, state: string}} req
 */
function planSetComponentState(root, req = /** @type {any} */ ({})) {
  const c = editable(root, req.file);
  if (!STUDIO.ok) throw new LineOpError(STUDIO.sentence.replace(/, so Cockpit shows.*$/, ', so its states cannot be changed until the link is back.'), 'STUDIO_DOWN');
  const on = STUDIO.behaviour.primitivesOn(c.api, c.edits, []).find((p) => p.ref === req.ref);
  if (!on) throw new LineOpError(`${c.name} has no behaviour "${req.ref ?? ''}"; attach one on the Behaviour tab first.`, 'UNKNOWN_BEHAVIOUR');
  const d = diagramOf(on, c.current);
  const st = d.states.find((s) => s.id === req.state);
  if (!st) throw new LineOpError(`The ${on.primitive} behaviour has no state "${req.state ?? ''}"; pick one of ${d.states.map((s) => s.id).join(', ')}.`, 'UNKNOWN_STATE');
  if (d.current === st.id) throw new LineOpError(`${c.name}'s ${on.primitive} is already ${st.label}.`, 'NO_CHANGE');
  return stagedCopy(c, c.edits, { ...c.current, [on.ref]: st.id }, `Sets ${c.name}'s ${on.primitive} to ${st.label}`);
}

/**
 * line.newComponent: a new feature component based on one library component (the same planner as line.baseOn, for
 * components only).
 * @param {string} root @param {{libraryId: string, feature: string, name: string}} req
 */
function planNewComponent(root, req = /** @type {any} */ ({})) {
  if (!String(req.libraryId ?? '').startsWith('components/')) throw new LineOpError(`"${req.libraryId ?? ''}" is not a library component; a new component starts from one of the library's components.`, 'UNKNOWN_ITEM');
  return planBaseOn(root, req);
}

export const COMPONENT_OPS = Object.freeze({ readLineComponent, planAttachComponentPrimitive, planAddComponentEvent, planChangeComponentEvent, planFixComponentEvent, planSetComponentState, planNewComponent });
