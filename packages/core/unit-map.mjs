import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { ensureDir, write, rel } from './fs.mjs';
import { loadConfig } from './config.mjs';
import { layerFileBaseName, layerTargetFile, layerFromGeneratedFile, folderFor, pascalCase, generateLayer } from './generators.mjs';

// LIN-154 -- the unit map. A unit's stable id is its identity; name, path,
// layer, feature and display label are ATTRIBUTES held here, never encoded
// in a hand-written import or symbol name. Renaming or moving a unit is a
// map edit plus a regenerate, never an AST rename cascade, because no
// hand-written code references a physical name (LIN-153).
//
// Scope note (LIN-155 cardinality correction, 2026-09-30): units and
// members are NODES only -- one entry per unit, one per member. Neither
// record carries a dependency/edge field (no "composedOf", no single
// "parent"), because the real shape is a graph (one controller -> N
// services, one service shared by N controllers), not a 1:1 chain. LIN-155
// adds the typed edge set (`map.edges`, EDGE_KINDS, addDependency/
// removeDependency/dependenciesOf/dependentsOf/composedDependencyShape)
// below, alongside these node records -- never bolted onto a unit/member
// record itself.
//
// Format/granularity decision, reaffirmed 2026-09-30 after the owner moved
// slot bodies INTO the map (closed by the "SLOT STORAGE -- DECIDED" note in
// the issue, which was an open question when this task started).
// Re-examined on reopen because slot bodies make merge behaviour a
// first-order concern, not a detail:
//   - Format: JSON, unchanged. Diffable, machine-writable, no second parser.
//   - Granularity: per-feature (one unit-map.json per feature), unchanged --
//     NOT one file per unit and NOT a single root file. Two things keep a
//     shared per-feature file safe even with slot bodies inside it:
//       1. `units` and `members` are objects keyed by opaque id, not arrays.
//          Two developers editing two different members' slot bodies touch
//          non-adjacent keys; a line-based git merge resolves that without a
//          conflict as long as neither edit reorders keys (saveUnitMap
//          always JSON.stringifies in the map's existing insertion order and
//          never re-sorts, so an untouched key's lines never move).
//       2. Per-unit files would trade that for a worse property: a LIN-153
//          slot edit is often cross-cutting within one feature (a rename or
//          a dependency change touches a controller member and the adapter
//          member it calls), which would turn one logical edit into a
//          multi-file diff instead of one.
//     Per-feature still beats one root map for the same reason as before
//     (isolates merge conflicts to the owning feature); rootUnitMapIndex
//     covers the whole-repo read without becoming a second source of truth.
//     If dogfood usage later shows same-feature slot edits colliding often,
//     the escape hatch is splitting a hot unit into its own feature, not a
//     schema change.

// LIN-155 -- the edge set, added alongside the LIN-154 nodes above (never
// bolted onto a unit/member record; the header note above explains why).
// Real cardinality is many-to-many in both directions (one controller -> N
// services; one service shared by N controllers), so an edge is its own
// record with its own opaque id, not a list stashed on either endpoint.
// `from` is a unit id OR a member id (a composed function inside a unit
// depends on N other units); `to` is always a unit id (you depend on a
// whole unit -- a service, adapter or domain function -- never on one of
// its members). `kind` is closed and extensible (EDGE_KINDS) so a second
// edge kind never needs a second storage shape.
export const EDGE_KINDS = Object.freeze(['dependsOn']);

// Opaque, short, stable under every operation including a move between
// features (the id itself never encodes feature/layer/name, so moving a
// unit is a field edit on its record, never an id change).
const UNIT_ID_PREFIX = 'u_';
const MEMBER_ID_PREFIX = 'm_';
const EDGE_ID_PREFIX = 'e_';
const ID_BYTES = 4; // 8 hex chars -- 4B+ combinations, collision-checked against the live map anyway

function randomId(prefix) {
  return `${prefix}${crypto.randomBytes(ID_BYTES).toString('hex')}`;
}

// One map per feature (reduces merge conflicts vs. a single root map, per
// the task's own open-decision recommendation) -- diffable, machine-writable
// JSON. A generated root index (rootUnitMapIndex below) aggregates all
// per-feature maps for a whole-repo read, but is never hand-edited or
// treated as a source of truth.
export function unitMapPath(root, feature, config = loadConfig(root)) {
  return path.join(root, config.features?.root || 'features', feature, 'unit-map.json');
}

function emptyMap() {
  return { units: {}, members: {}, edges: {} };
}

export function loadUnitMap(root, feature, config = loadConfig(root)) {
  const file = unitMapPath(root, feature, config);
  if (!fs.existsSync(file)) return emptyMap();
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { units: parsed.units || {}, members: parsed.members || {}, edges: parsed.edges || {} };
}

export function saveUnitMap(root, feature, map, config = loadConfig(root)) {
  const file = unitMapPath(root, feature, config);
  ensureDir(path.dirname(file));
  write(file, `${JSON.stringify(map, null, 2)}\n`);
  return file;
}

function freshUnitId(map) {
  let id = randomId(UNIT_ID_PREFIX);
  while (map.units[id]) id = randomId(UNIT_ID_PREFIX); // never reused, even across tombstones
  return id;
}

function freshMemberId(map) {
  let id = randomId(MEMBER_ID_PREFIX);
  while (map.members[id]) id = randomId(MEMBER_ID_PREFIX);
  return id;
}

function freshEdgeId(map) {
  let id = randomId(EDGE_ID_PREFIX);
  while (map.edges[id]) id = randomId(EDGE_ID_PREFIX);
  return id;
}

function endpointExists(map, id) {
  return Boolean(map.units[id] || map.members[id]);
}

/**
 * Register a newly generated unit in its feature's map. Called once per unit
 * creation (wired into generators.mjs's generateLayer); the id assigned here
 * never changes and is never reused, even after the unit is tombstoned.
 *
 * @returns {{id:string, record:object}} The assigned id and its stored record.
 */
export function registerUnit(root, feature, layer, name, config = loadConfig(root)) {
  const map = loadUnitMap(root, feature, config);
  const file = layerTargetFile(root, layer, name, feature, config);
  const relPath = rel(root, file);
  // Idempotent: re-registering the same feature/layer/name (e.g. a second
  // `construct create` after an edit) reuses the existing live id rather
  // than minting a duplicate for the same physical unit.
  const existing = Object.entries(map.units).find(
    ([, u]) => !u.tombstoned && u.feature === feature && u.layer === layer && u.unit === name
  );
  if (existing) return { id: existing[0], record: existing[1] };
  const id = freshUnitId(map);
  const cap = pascalCase(name, layer[0].toUpperCase() + layer.slice(1));
  const record = { feature, unit: name, layer, name: layerFileBaseName(layer, cap), path: relPath, tombstoned: false };
  map.units[id] = record;
  saveUnitMap(root, feature, map, config);
  return { id, record };
}

/**
 * Register a composed member (a function inside a unit, e.g. a controller
 * member composing several services) scoped to its owning unit id.
 * `defaultName` is whatever generated-name scheme the caller uses (LIN-155's
 * connector-keyword scheme, once built) -- this module only guarantees the
 * id is stable and `name` stays an overridable attribute, never derived at
 * read time from the member's dependency set.
 */
export function registerMember(root, feature, unitId, defaultName, config = loadConfig(root)) {
  const map = loadUnitMap(root, feature, config);
  if (!map.units[unitId]) throw new Error(`registerMember: unknown unit id "${unitId}" in feature "${feature}"`);
  const id = freshMemberId(map);
  map.members[id] = { unitId, name: defaultName, tombstoned: false };
  saveUnitMap(root, feature, map, config);
  return { id, record: map.members[id] };
}

/**
 * Declare a typed dependency edge: `from` (a unit id, or a member id for a
 * composed function inside a unit) depends on `to` (always a unit id --
 * you depend on a whole service/adapter/domain unit, never on one of its
 * members). Many-to-many in both directions: a controller member can add
 * any number of these, and the same service unit can be the `to` of any
 * number of edges from different controllers. Idempotent on
 * (from, to, kind) so re-declaring an existing wire is a no-op, not a
 * duplicate edge.
 *
 * @returns {{id:string, record:object}} The edge's id and stored record.
 */
export function addDependency(root, feature, from, to, kind = 'dependsOn', config = loadConfig(root)) {
  if (!EDGE_KINDS.includes(kind)) throw new Error(`addDependency: unknown edge kind "${kind}"`);
  const map = loadUnitMap(root, feature, config);
  if (!endpointExists(map, from)) throw new Error(`addDependency: unknown "from" id "${from}" in feature "${feature}"`);
  if (!map.units[to]) throw new Error(`addDependency: unknown "to" unit id "${to}" in feature "${feature}"`);
  const existing = Object.entries(map.edges).find(([, e]) => e.from === from && e.to === to && e.kind === kind);
  if (existing) return { id: existing[0], record: existing[1] };
  const id = freshEdgeId(map);
  const record = { from, to, kind };
  map.edges[id] = record;
  saveUnitMap(root, feature, map, config);
  return { id, record };
}

/**
 * Remove a dependency edge. Unlike a unit/member id, an edge id is never
 * referenced by anything durable (no slot body, no file path), so removal
 * is a real delete rather than a tombstone. Reports whether removing this
 * edge just orphaned its `to` unit (no remaining live edge points at it) --
 * per LIN-155's shared-unit lifecycle requirement, that is reported back to
 * the caller rather than silently removed or silently kept.
 *
 * @returns {{orphaned:(string|null)}} The now-orphaned unit id, or null.
 */
export function removeDependency(root, feature, edgeId, config = loadConfig(root)) {
  const map = loadUnitMap(root, feature, config);
  if (!map.edges[edgeId]) throw new Error(`removeDependency: unknown edge id "${edgeId}" in feature "${feature}"`);
  const { to } = map.edges[edgeId];
  delete map.edges[edgeId];
  const stillDependedOn = Object.values(map.edges).some((e) => e.to === to);
  saveUnitMap(root, feature, map, config);
  return { orphaned: stillDependedOn ? null : to };
}

/**
 * Forward lookup: every edge declared from a given unit or member id.
 */
export function dependenciesOf(root, feature, from, config = loadConfig(root)) {
  const map = loadUnitMap(root, feature, config);
  return Object.entries(map.edges).filter(([, e]) => e.from === from).map(([id, e]) => ({ id, ...e }));
}

/**
 * Reverse lookup: every edge that depends on a given unit -- "who else uses
 * this service?" from the issue's addressability property, answered without
 * a grep.
 */
export function dependentsOf(root, feature, unitId, config = loadConfig(root)) {
  const map = loadUnitMap(root, feature, config);
  return Object.entries(map.edges).filter(([, e]) => e.to === unitId).map(([id, e]) => ({ id, ...e }));
}

/**
 * The shape a composed member's return type is built from: one entry per
 * dependency edge, each carrying a `key` LIN-153 uses as the composed
 * object's field name. `key` is derived from the dependency's OWN unit name
 * (never from the full dependency set), so it is edge-stable per the
 * issue's item 3/6 requirement -- adding a fourth service changes this
 * array's length, never an existing entry's key.
 *
 * @returns {{key:string, unitId:string, layer:string, name:string, path:string}[]}
 */
export function composedDependencyShape(root, feature, memberId, config = loadConfig(root)) {
  const map = loadUnitMap(root, feature, config);
  if (!map.members[memberId]) throw new Error(`composedDependencyShape: unknown member id "${memberId}" in feature "${feature}"`);
  return Object.values(map.edges)
    .filter((e) => e.from === memberId && e.kind === 'dependsOn')
    .map((e) => {
      const unit = map.units[e.to];
      const key = unit.unit.charAt(0).toLowerCase() + unit.unit.slice(1);
      return { key, unitId: e.to, layer: unit.layer, name: unit.name, path: unit.path };
    });
}

/**
 * Set a member's slot body -- the business logic itself, living IN the map
 * per the owner's 2026-09-30 "SLOT STORAGE -- DECIDED" note. This is the
 * only thing a human (or an AI acting on the human's behalf) ever writes on
 * a member; everything else on the record (name, ids) is generated wiring.
 * The generated file on disk is a build artifact regenerated FROM this
 * field -- LIN-153 owns that regeneration step, this module only owns
 * storing and reading the body so regeneration can never half-apply (if the
 * logic isn't in the generated file, regenerating it can't destroy it).
 */
export function setMemberSlot(root, feature, memberId, body, language = 'ts', config = loadConfig(root)) {
  const map = loadUnitMap(root, feature, config);
  if (!map.members[memberId]) throw new Error(`setMemberSlot: unknown member id "${memberId}" in feature "${feature}"`);
  map.members[memberId].slot = { body, language, updatedAt: new Date().toISOString() };
  saveUnitMap(root, feature, map, config);
  return map.members[memberId].slot;
}

/**
 * Read a member's slot body, or null if nothing has been written yet.
 */
export function getMemberSlot(root, feature, memberId, config = loadConfig(root)) {
  const map = loadUnitMap(root, feature, config);
  if (!map.members[memberId]) throw new Error(`getMemberSlot: unknown member id "${memberId}" in feature "${feature}"`);
  return map.members[memberId].slot || null;
}

/**
 * Tombstone a unit (or member) instead of freeing its id -- a stale
 * reference after deletion is a clear "this id was deleted" validate error
 * rather than a silent rebind to whatever new unit happens to reuse the id.
 *
 * Cascades to the unit's own members (a member's lifecycle is scoped to its
 * owning unit, per registerMember) and to every edge declared FROM the unit
 * or one of those members -- deleting a controller must not delete a
 * service another controller still depends on, so edges are removed, never
 * the `to` unit. Per LIN-155's shared-unit lifecycle requirement, any `to`
 * unit left with zero remaining live edges is reported back as orphaned
 * rather than silently removed or silently kept.
 *
 * @returns {{orphaned:string[]}} Dependency unit ids left with no remaining dependent.
 */
export function tombstoneUnit(root, feature, id, config = loadConfig(root)) {
  const map = loadUnitMap(root, feature, config);
  if (!map.units[id]) throw new Error(`tombstoneUnit: unknown unit id "${id}" in feature "${feature}"`);
  map.units[id].tombstoned = true;
  const memberIds = Object.entries(map.members)
    .filter(([, m]) => m.unitId === id && !m.tombstoned)
    .map(([mid]) => mid);
  for (const mid of memberIds) map.members[mid].tombstoned = true;
  const removedFrom = new Set([id, ...memberIds]);
  const removedEdgeTargets = new Set();
  for (const [eid, e] of Object.entries(map.edges)) {
    if (removedFrom.has(e.from)) {
      removedEdgeTargets.add(e.to);
      delete map.edges[eid];
    }
  }
  const stillDependedOn = new Set(Object.values(map.edges).map((e) => e.to));
  const orphaned = [...removedEdgeTargets].filter((toId) => !stillDependedOn.has(toId));
  saveUnitMap(root, feature, map, config);
  return { orphaned };
}

export function tombstoneMember(root, feature, id, config = loadConfig(root)) {
  const map = loadUnitMap(root, feature, config);
  if (!map.members[id]) throw new Error(`tombstoneMember: unknown member id "${id}" in feature "${feature}"`);
  map.members[id].tombstoned = true;
  saveUnitMap(root, feature, map, config);
}

/**
 * Resolve a unit's display name: the map first (so a later rename is a map
 * edit, never a physical rename), falling back to the derived default from
 * LIN-146's naming table only when the unit has no map entry yet.
 */
export function resolveUnitName(root, feature, layer, name, config = loadConfig(root)) {
  const map = loadUnitMap(root, feature, config);
  const hit = Object.values(map.units).find((u) => !u.tombstoned && u.feature === feature && u.layer === layer && u.unit === name);
  if (hit) return hit.name;
  return layerFileBaseName(layer, pascalCase(name, layer[0].toUpperCase() + layer.slice(1)));
}

// Round-trip check (path -> {layer, unit} -> path), asserted by
// test/unit-map.test.mjs -- proves layerFileBaseName/layerTargetFile/
// layerFromGeneratedFile together form one total, invertible naming
// function per LIN-154's "no second naming path" instruction.
export function unitFromPath(root, absFile, config = loadConfig(root)) {
  const layer = layerFromGeneratedFile(absFile);
  const base = path.basename(absFile).replace(/\.(tsx|ts|jsx|js)$/, '');
  const suffix = layer === 'page' ? 'Page' : layer === 'controller' ? 'Controller' : layer === 'viewmodel' ? 'ViewModel' : layer === 'adapter' ? 'Adapter' : '';
  const withoutPrefix = layer === 'hook' && base.startsWith('use') ? base.slice(3) : base;
  const unitCap = suffix && withoutPrefix.endsWith(suffix) ? withoutPrefix.slice(0, -suffix.length) : withoutPrefix;
  return { layer, unit: unitCap };
}

/**
 * Drift check: every live (non-tombstoned) unit's path must exist on disk,
 * and every file physically sitting in a known layer folder must have a
 * live map entry. Either direction of mismatch is a `construct validate`
 * error with a mechanical fix (regenerate the map, or regenerate the file).
 *
 * Also checks edge integrity: an edge whose `from` or `to` id no longer
 * resolves to a live (non-tombstoned) unit/member is dangling -- it
 * survives a tombstone made through some path other than tombstoneUnit's
 * own cascade (e.g. hand-edited map JSON), and is reported rather than
 * silently followed by the generator.
 *
 * @returns {{missingOnDisk:object[], missingFromMap:object[], danglingEdges:object[]}}
 */
export function validateUnitMap(root, feature, config = loadConfig(root)) {
  const map = loadUnitMap(root, feature, config);
  const missingOnDisk = [];
  for (const [id, u] of Object.entries(map.units)) {
    if (u.tombstoned) continue;
    if (!fs.existsSync(path.join(root, u.path))) missingOnDisk.push({ id, ...u });
  }
  const missingFromMap = [];
  const knownLayers = new Set(['domain', 'service', 'workflow', 'hook', 'component', 'expression', 'adapter', 'viewmodel', 'page', 'controller']);
  const liveByPath = new Set(Object.values(map.units).filter((u) => !u.tombstoned).map((u) => u.path));
  const featureDir = path.join(root, config.features?.root || 'features', feature);
  for (const layer of knownLayers) {
    const dir = path.join(featureDir, folderFor(layer));
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir)) {
      const abs = path.join(dir, entry);
      if (!fs.statSync(abs).isFile()) continue;
      const relPath = rel(root, abs);
      if (!liveByPath.has(relPath)) missingFromMap.push({ layer, path: relPath });
    }
  }
  const isLive = (id) =>
    (map.units[id] && !map.units[id].tombstoned) || (map.members[id] && !map.members[id].tombstoned);
  const danglingEdges = [];
  for (const [id, e] of Object.entries(map.edges)) {
    if (!isLive(e.from) || !isLive(e.to)) danglingEdges.push({ id, ...e });
  }
  return { missingOnDisk, missingFromMap, danglingEdges };
}

// Generated aggregation across every feature's map, for the visual tool to
// read in one shot -- NEVER hand-edited and never a source of truth; the
// per-feature files under features/<name>/unit-map.json are authoritative.
export function rootUnitMapIndex(root, config = loadConfig(root)) {
  const featuresRoot = path.join(root, config.features?.root || 'features');
  const index = { units: {}, members: {}, edges: {} };
  if (!fs.existsSync(featuresRoot)) return index;
  for (const feature of fs.readdirSync(featuresRoot)) {
    const dir = path.join(featuresRoot, feature);
    if (!fs.statSync(dir).isDirectory()) continue;
    const map = loadUnitMap(root, feature, config);
    Object.assign(index.units, map.units);
    Object.assign(index.members, map.members);
    Object.assign(index.edges, map.edges);
  }
  return index;
}

/**
 * Generate a layer file (generators.mjs's generateLayer) and register its
 * unit in the map in one step -- the entry point real callers (`construct
 * create`, the engine's generators) should use instead of calling
 * generateLayer directly, so every unit that lands on disk gets a map
 * entry the moment it's created. Kept as a thin wrapper here (rather than
 * folded into generators.mjs) to avoid a circular import: this module reads
 * generators.mjs, generators.mjs does not need to know the map exists.
 */
export function generateLayerWithUnit(root, layer, name, feature) {
  const file = generateLayer(root, layer, name, feature);
  const { id } = registerUnit(root, feature, layer, name);
  return { file, id };
}

export function writeRootUnitMapIndex(root, config = loadConfig(root)) {
  const file = path.join(root, '.construct', 'unit-map-index.json');
  ensureDir(path.dirname(file));
  write(file, `${JSON.stringify(rootUnitMapIndex(root, config), null, 2)}\n`);
  return file;
}
