// LIN-90 §5: adapter creation — a closed, deterministic set of field transforms for when a Tie has no
// directly compatible endpoint field (`compatibleEndpoints()`, parts.mjs, returns []). Per
// docs/design/run-api-panel-and-wires.md §5: "Transform choices are a closed set determined by the two types
// involved... nothing free-text or code-eval." No model call, no arbitrary expression evaluation — every
// transform here is a small, reviewable, pure function (AI-READY: deterministic core, no unverified pick).
//
// Persistence is runtime-only (docs/ADAPTER-PERSISTENCE.md, decided 2026-09-30, Option A): this module never
// touches a contract file; src/adapter-store.mjs stores the saved mapping alongside the example's own run
// state (adapters.json, next to answers.json), never inside openapi.json/yaml.

/** @typedef {{id: string, label: string}} TransformKind */

// Every transform this module knows, with the type pair(s) it applies to (`from`/`to` are runtime `typeof`
// results, or "any" to match every type). Order here is the order offered in the picker.
const TRANSFORMS = [
  { id: "passthrough", label: "Use as-is", from: "any", to: "any", sameType: true },
  { id: "stringify", label: "Convert to text", from: "any", to: "string", excludeSameType: true },
  { id: "map", label: "Map specific values", from: "any", to: "any", sameType: false },
  { id: "substring", label: "Take part of the text", from: "string", to: "string", sameType: false },
  { id: "regex", label: "Find and replace (pattern)", from: "string", to: "string", sameType: false },
];

/**
 * The closed set of transforms that make sense for a field of runtime type `fromType` feeding a part that
 * expects `toType`. Pure, deterministic — the picker in the adapter dialog renders exactly this list, in
 * order, with nothing else offered (no free-text, no generated code).
 *
 * @param {string|null} fromType The source field's inferred type (parts.mjs's `typeof`-based inference).
 * @param {string|null} toType The part's expected `dataType` (tree/model.mjs's `dataTypeOf`).
 * @returns {TransformKind[]}
 */
export function transformKindsFor(fromType, toType) {
  if (!fromType || !toType) return [];
  return TRANSFORMS.filter((t) => {
    if (t.sameType && fromType !== toType) return false;
    if (t.excludeSameType && fromType === toType) return false;
    if (t.from !== "any" && t.from !== fromType) return false;
    if (t.to !== "any" && t.to !== toType) return false;
    return true;
  }).map(({ id, label }) => ({ id, label }));
}

/**
 * Apply one transform to a value. Throws a plain `Error` with a user-facing message on invalid input or
 * params — never silently coerces to something the mapping didn't ask for.
 *
 * @param {string} kind One of `TRANSFORMS`' ids.
 * @param {object} params Transform-specific parameters (see each case).
 * @param {*} value The source field's example value.
 * @returns {*} The transformed value.
 */
export function applyTransform(kind, params, value) {
  switch (kind) {
    case "passthrough":
      return value;
    case "stringify":
      return String(value);
    case "map": {
      const table = params?.table ?? {};
      const key = String(value);
      if (Object.prototype.hasOwnProperty.call(table, key)) return table[key];
      if (params && Object.prototype.hasOwnProperty.call(params, "default")) return params.default;
      throw new Error(`no mapping for value ${JSON.stringify(value)}`);
    }
    case "substring": {
      if (typeof value !== "string") throw new Error("substring needs a text value");
      const start = Number.isInteger(params?.start) ? params.start : 0;
      const end = Number.isInteger(params?.end) ? params.end : undefined;
      return value.slice(start, end);
    }
    case "regex": {
      if (typeof value !== "string") throw new Error("find-and-replace needs a text value");
      if (!params?.pattern) throw new Error("a pattern is required");
      let re;
      try { re = new RegExp(params.pattern, params.flags ?? "g"); } catch { throw new Error("that pattern isn't a valid regular expression"); }
      return value.replace(re, params.replacement ?? "");
    }
    default:
      throw new Error(`unknown adapter mapping "${kind}"`);
  }
}

/**
 * The plain-language label for a saved transform id — the same word the picker offered when it was chosen
 * (LIN-117 §7: the persistent adapter chip's expanded view names the mapping this way, not by its raw id).
 *
 * @param {string} id
 * @returns {string}
 */
export function transformLabel(id) {
  return TRANSFORMS.find((t) => t.id === id)?.label ?? id;
}

/**
 * Preview a transform against a real example value before it's saved (design §5/§6: "a live preview evaluates
 * the transform against the endpoint's actual example value... so the mapping is checked before saving").
 *
 * @param {string} kind
 * @param {object} params
 * @param {*} value
 * @returns {{ok: true, value: *}|{ok: false, error: string}}
 */
export function previewTransform(kind, params, value) {
  try {
    return { ok: true, value: applyTransform(kind, params, value) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
