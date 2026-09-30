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
// Scope note (LIN-155 cardinality correction, 2026-09-30): this module
// specs NODES only -- one entry per unit, one per member. It deliberately
// carries no dependency/edge field (no "composedOf", no single "parent"),
// because the real shape is a graph (one controller -> N services, one
// service shared by N controllers), not a 1:1 chain. Typed edges
// (dependsOn, many-to-many) are LIN-155's own deliverable, added as a
// separate edge set alongside these nodes -- do not bolt an edge field onto
// a unit/member record here.

// Opaque, short, stable under every operation including a move between
// features (the id itself never encodes feature/layer/name, so moving a
// unit is a field edit on its record, never an id change).
const UNIT_ID_PREFIX = 'u_';
const MEMBER_ID_PREFIX = 'm_';
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
  return { units: {}, members: {} };
}

export function loadUnitMap(root, feature, config = loadConfig(root)) {
  const file = unitMapPath(root, feature, config);
  if (!fs.existsSync(file)) return emptyMap();
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { units: parsed.units || {}, members: parsed.members || {} };
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
 * Tombstone a unit (or member) instead of freeing its id -- a stale
 * reference after deletion is a clear "this id was deleted" validate error
 * rather than a silent rebind to whatever new unit happens to reuse the id.
 */
export function tombstoneUnit(root, feature, id, config = loadConfig(root)) {
  const map = loadUnitMap(root, feature, config);
  if (!map.units[id]) throw new Error(`tombstoneUnit: unknown unit id "${id}" in feature "${feature}"`);
  map.units[id].tombstoned = true;
  saveUnitMap(root, feature, map, config);
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
 * @returns {{missingOnDisk:object[], missingFromMap:object[]}}
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
  return { missingOnDisk, missingFromMap };
}

// Generated aggregation across every feature's map, for the visual tool to
// read in one shot -- NEVER hand-edited and never a source of truth; the
// per-feature files under features/<name>/unit-map.json are authoritative.
export function rootUnitMapIndex(root, config = loadConfig(root)) {
  const featuresRoot = path.join(root, config.features?.root || 'features');
  const index = { units: {}, members: {} };
  if (!fs.existsSync(featuresRoot)) return index;
  for (const feature of fs.readdirSync(featuresRoot)) {
    const dir = path.join(featuresRoot, feature);
    if (!fs.statSync(dir).isDirectory()) continue;
    const map = loadUnitMap(root, feature, config);
    Object.assign(index.units, map.units);
    Object.assign(index.members, map.members);
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
