// Gold labels of the planner eval (#896, #894): the requester's hidden answer key, picked only from the drafter's
// closed sets (packages/engine/line/drafter/contract.mjs). Read-only consumer: the sets are imported, never copied.
//
//   gold = { source: "requester", intent: "<verb>.<object>", object, target: { kind, name }, layers: [...] }
//
// The gold block lives only in an item's `gold` field. The planner input and the grader input builders
// (inputs.mjs) never include it; tests assert that.
import { buildIntentCatalog, OBJECTS, LAYERS, SLOT_KINDS } from "../../../packages/engine/line/drafter/contract.mjs";

/** Every intent id of the catalog (verb × structural object), whether or not a template satisfies it yet. */
export const INTENT_IDS = Object.freeze(buildIntentCatalog([]).map((e) => e.id));
export const OBJECT_IDS = Object.freeze(Object.keys(OBJECTS));
export const LAYER_IDS = Object.freeze([...LAYERS]);
/** Target slot kinds a requirement can be about (the drafter's slot kinds minus the internal ones). */
export const TARGET_KINDS = Object.freeze([...new Set(Object.values(SLOT_KINDS))].filter((k) => !["unknown", "missing", "new", "code", "value", "fragment"].includes(k)));

/** The closed sets as the requester prompt's placeholders. */
export function closedSetPlaceholders() {
  const list = (a) => a.map((x) => `"${x}"`).join(", ");
  return { INTENT_IDS: list(INTENT_IDS), OBJECTS: list(OBJECT_IDS), SLOT_KINDS: list(TARGET_KINDS), LAYERS: list(LAYER_IDS) };
}

/**
 * Check a gold block against the closed sets. Never throws: a bad label is reported, so a requester run with one
 * bad item still records the rest.
 * @param {any} g
 * @returns {{ok: boolean, problems: string[], gold: object|null}} `gold` is the normalized block (source set).
 */
export function checkGold(g) {
  const problems = [];
  if (!g || typeof g !== "object") return { ok: false, problems: ["gold is missing"], gold: null };
  if (!INTENT_IDS.includes(g.intent)) problems.push(`intent "${g.intent}" is not in the catalog`);
  if (!OBJECT_IDS.includes(g.object)) problems.push(`object "${g.object}" is not a structural object`);
  else if (typeof g.intent === "string" && g.intent.split(".")[1] !== g.object) problems.push(`object "${g.object}" does not match intent "${g.intent}"`);
  if (!g.target || !TARGET_KINDS.includes(g.target.kind)) problems.push(`target kind "${g.target?.kind}" is not a slot kind`);
  if (!Array.isArray(g.layers) || !g.layers.length || g.layers.some((l) => !LAYER_IDS.includes(l))) problems.push(`layers ${JSON.stringify(g.layers)} must be a non-empty subset of ${LAYER_IDS.join(", ")}`);
  const gold = { source: "requester", intent: g.intent ?? null, object: g.object ?? null, target: { kind: g.target?.kind ?? null, name: String(g.target?.name ?? "") }, layers: Array.isArray(g.layers) ? [...g.layers] : [] };
  return { ok: problems.length === 0, problems, gold };
}

/**
 * Compare the planner's labels with gold (exact per closed label; layers as sets). Only report code calls this, after
 * grading: the result is shown to the owner, never to a judge.
 * @param {object|null} gold
 * @param {object|null} labels
 */
export function labelMatch(gold, labels) {
  if (!gold || !labels) return null;
  const same = (a, b) => a != null && a === b;
  const layersEq = Array.isArray(labels.layers) && labels.layers.length === gold.layers.length && gold.layers.every((l) => labels.layers.includes(l));
  return { intent: same(gold.intent, labels.intent), object: same(gold.object, labels.object), targetKind: same(gold.target?.kind, labels.target?.kind), layers: layersEq };
}
