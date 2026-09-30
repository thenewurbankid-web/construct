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
/**
 * The absolute path of a feature's unit-map JSON file (one per feature -- never a single root file or
 * one file per unit, per the module-level format/granularity note above). The file may not exist yet;
 * loadUnitMap already handles that case, so most callers should reach for it instead of stat-ing this
 * path themselves.
 *
 * @param {string} root Project root.
 * @param {string} feature Feature name that owns the map.
 * @param {object} [config] The project's already-loaded architecture.yml config (defaults to loading it).
 * @returns {string} Absolute path to `<features root>/<feature>/unit-map.json`.
 */
export function unitMapPath(root, feature, config = loadConfig(root)) {
  return path.join(root, config.features?.root || 'features', feature, 'unit-map.json');
}

function emptyMap() {
  return { units: {}, members: {}, edges: {} };
}

/**
 * Read a feature's unit map from disk, or a fresh empty map (`{units:{}, members:{}, edges:{}}`) when
 * its file doesn't exist yet -- callers never need to special-case a brand-new feature. Each top-level
 * key is independently defaulted to `{}` on the way out, so a map file written before the LIN-155 edge
 * set existed (no `edges` key at all) still loads cleanly instead of returning `edges: undefined`.
 *
 * @param {string} root Project root.
 * @param {string} feature Feature name that owns the map.
 * @param {object} [config] The project's already-loaded architecture.yml config (defaults to loading it).
 * @returns {{units:object, members:object, edges:object}} The feature's unit map.
 */
export function loadUnitMap(root, feature, config = loadConfig(root)) {
  const file = unitMapPath(root, feature, config);
  if (!fs.existsSync(file)) return emptyMap();
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { units: parsed.units || {}, members: parsed.members || {}, edges: parsed.edges || {} };
}

/**
 * Write a feature's unit map back to disk as pretty-printed JSON (2-space indent, trailing newline),
 * creating the feature's directory first if it doesn't exist. Always serializes `map` in its own
 * current key order -- never re-sorts -- so an untouched key's lines never move and a concurrent edit
 * to a different key in the same file merges cleanly via a plain line-based git merge (see the
 * module-level merge-behaviour note above). Every mutating function in this module ends by calling
 * this; there is no separate "commit" step.
 *
 * @param {string} root Project root.
 * @param {string} feature Feature name that owns the map.
 * @param {{units:object, members:object, edges:object}} map The map to persist.
 * @param {object} [config] The project's already-loaded architecture.yml config (defaults to loading it).
 * @returns {string} Absolute path of the file written.
 */
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
 * @param {string} root Project root.
 * @param {string} feature Feature name that owns the unit.
 * @param {string} layer Layer the unit belongs to.
 * @param {string} name Unit name as passed to the generator (not yet cased/suffixed).
 * @param {object} [config] The project's already-loaded architecture.yml config (defaults to loading it).
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
 *
 * @param {string} root Project root.
 * @param {string} feature Feature name that owns the unit.
 * @param {string} unitId The owning unit's id; must already exist in the map (an unknown id throws).
 * @param {string} defaultName Initial display name for the member.
 * @param {object} [config] The project's already-loaded architecture.yml config (defaults to loading it).
 * @returns {{id:string, record:object}} The assigned member id and its stored record.
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
 * @param {string} root Project root.
 * @param {string} feature Feature name that owns the map.
 * @param {string} from The dependent id -- a unit id, or a member id for a composed function inside a unit.
 * @param {string} to The depended-on unit's id (always a unit id, never a member id).
 * @param {string} [kind] Edge kind; must be one of EDGE_KINDS (defaults to `'dependsOn'`).
 * @param {object} [config] The project's already-loaded architecture.yml config (defaults to loading it).
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
 * @param {string} root Project root.
 * @param {string} feature Feature name that owns the map.
 * @param {string} edgeId The edge id to remove; must already exist (an unknown id throws).
 * @param {object} [config] The project's already-loaded architecture.yml config (defaults to loading it).
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
 *
 * @param {string} root Project root.
 * @param {string} feature Feature name that owns the map.
 * @param {string} from A unit id or member id to look up outgoing edges for.
 * @param {object} [config] The project's already-loaded architecture.yml config (defaults to loading it).
 * @returns {{id:string, from:string, to:string, kind:string}[]} Every edge declared from `from`, each merged with its own id.
 */
export function dependenciesOf(root, feature, from, config = loadConfig(root)) {
  const map = loadUnitMap(root, feature, config);
  return Object.entries(map.edges).filter(([, e]) => e.from === from).map(([id, e]) => ({ id, ...e }));
}

/**
 * Reverse lookup: every edge that depends on a given unit -- "who else uses
 * this service?" from the issue's addressability property, answered without
 * a grep.
 *
 * @param {string} root Project root.
 * @param {string} feature Feature name that owns the map.
 * @param {string} unitId The unit id to look up incoming edges for.
 * @param {object} [config] The project's already-loaded architecture.yml config (defaults to loading it).
 * @returns {{id:string, from:string, to:string, kind:string}[]} Every edge whose `to` is `unitId`, each merged with its own id.
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
 * @param {string} root Project root.
 * @param {string} feature Feature name that owns the map.
 * @param {string} memberId The composed member id whose dependency shape to build; must already exist (an unknown id throws).
 * @param {object} [config] The project's already-loaded architecture.yml config (defaults to loading it).
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
 *
 * @param {string} root Project root.
 * @param {string} feature Feature name that owns the map.
 * @param {string} memberId The member id whose slot to set; must already exist (an unknown id throws).
 * @param {string} body The slot's source text -- the business logic itself.
 * @param {string} [language] Language tag stored alongside the body (defaults to `'ts'`).
 * @param {object} [config] The project's already-loaded architecture.yml config (defaults to loading it).
 * @returns {{body:string, language:string, updatedAt:string}} The stored slot record, including a fresh `updatedAt` ISO timestamp.
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
 *
 * @param {string} root Project root.
 * @param {string} feature Feature name that owns the map.
 * @param {string} memberId The member id whose slot to read; must already exist (an unknown id throws).
 * @param {object} [config] The project's already-loaded architecture.yml config (defaults to loading it).
 * @returns {{body:string, language:string, updatedAt:string}|null} The stored slot, or `null` if setMemberSlot was never called for this member.
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
 * @param {string} root Project root.
 * @param {string} feature Feature name that owns the map.
 * @param {string} id The unit id to tombstone; must already exist (an unknown id throws).
 * @param {object} [config] The project's already-loaded architecture.yml config (defaults to loading it).
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

/**
 * Tombstone a single member without touching its owning unit or any other member of that unit -- the
 * member-level counterpart to tombstoneUnit, for deleting one composed function while the unit it lives
 * on stays live. Unlike tombstoneUnit, this does NOT cascade to the member's own dependency edges: an
 * edge whose `from` is this member is left in place and becomes dangling, surfaced later by
 * validateUnitMap's `danglingEdges` check. A caller that also needs those edges gone should remove them
 * itself (removeDependency) before or after calling this.
 *
 * @param {string} root Project root.
 * @param {string} feature Feature name that owns the map.
 * @param {string} id The member id to tombstone; must already exist (an unknown id throws).
 * @param {object} [config] The project's already-loaded architecture.yml config (defaults to loading it).
 */
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
 *
 * @param {string} root Project root.
 * @param {string} feature Feature name that owns the unit.
 * @param {string} layer Layer the unit belongs to.
 * @param {string} name Unit name as passed to the generator (not yet cased/suffixed).
 * @param {object} [config] The project's already-loaded architecture.yml config (defaults to loading it).
 * @returns {string} The live map entry's `name` for this feature/layer/unit, or the derived default filename base when there is no live entry yet.
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
/**
 * The inverse of layerTargetFile: given an absolute generated file path, recover the `{layer, unit}` it
 * was generated for. `layer` comes from the containing folder name (layerFromGeneratedFile); `unit`
 * strips the layer's PascalCase suffix (`Page`, `Controller`, `ViewModel`, `Adapter` -- domain, service,
 * workflow, component and expression have none) and, for a hook, its `use` prefix, from the file's
 * basename. `root` and `config` are accepted only for call-site symmetry with the rest of this module
 * (every other exported function here takes `root`/`config` first); this function is pure over
 * `absFile` alone and reads neither of them.
 *
 * @param {string} root Project root. Unused by this function.
 * @param {string} absFile Absolute path of a generated layer file.
 * @param {object} [config] The project's already-loaded architecture.yml config (defaults to loading it). Unused by this function.
 * @returns {{layer:string, unit:string}} The layer and unit name the file was generated for.
 */
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
 * @param {string} root Project root.
 * @param {string} feature Feature name to validate.
 * @param {object} [config] The project's already-loaded architecture.yml config (defaults to loading it).
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
/**
 * Aggregate every feature's unit map into a single in-memory index (`{units, members, edges}`, each
 * merged by id across all features) for a whole-repo read in one shot, e.g. the visual tool. Purely
 * generated from the per-feature files each time it's called -- never itself hand-edited or treated as
 * a source of truth (writeRootUnitMapIndex persists this to disk as a cache, not a second copy of the
 * data). Returns an empty index when the features root doesn't exist yet, and silently skips any
 * non-directory entry under it.
 *
 * @param {string} root Project root.
 * @param {object} [config] The project's already-loaded architecture.yml config (defaults to loading it).
 * @returns {{units:object, members:object, edges:object}} The combined index across every feature's map.
 */
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
 *
 * @param {string} root Project root.
 * @param {string} layer Layer name to generate (see generateLayer/LAYER_ORDER for the supported values).
 * @param {string} name Unit name (turned into a valid identifier).
 * @param {string} feature Feature that owns the file.
 * @returns {{file:string, id:string}} Absolute path of the generated file and the id registered for it.
 */
export function generateLayerWithUnit(root, layer, name, feature) {
  const file = generateLayer(root, layer, name, feature);
  const { id } = registerUnit(root, feature, layer, name);
  return { file, id };
}

/**
 * Persist rootUnitMapIndex's aggregation to `.construct/unit-map-index.json` as pretty-printed JSON, so
 * a consumer that wants the whole-repo index off disk (e.g. the cockpit UI) can read a file instead of
 * recomputing it in-process. A generated cache only -- regenerate it whenever the underlying per-feature
 * maps change; nothing treats this file as authoritative.
 *
 * @param {string} root Project root.
 * @param {object} [config] The project's already-loaded architecture.yml config (defaults to loading it).
 * @returns {string} Absolute path of the index file written.
 */
export function writeRootUnitMapIndex(root, config = loadConfig(root)) {
  const file = path.join(root, '.construct', 'unit-map-index.json');
  ensureDir(path.dirname(file));
  write(file, `${JSON.stringify(rootUnitMapIndex(root, config), null, 2)}\n`);
  return file;
}
