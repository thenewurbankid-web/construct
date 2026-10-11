// MIRROR of the expression contract (another agent builds the real one: evaluate(facts, expr) -> failed sentences).
// Replace on merge; the op names are listed in contract.mjs EXPR_OPS. Also the slot binder every drafter part uses:
// stored forms hold slot refs (<F1>, <C1.file>); bind() fills the project's names only to show or apply.
import { SLOT_REF } from './contract.mjs';

/**
 * Replace slot refs in every string of a value with their bindings. A string that is exactly one ref takes the bound
 * value as it is (a number stays a number); a ref inside a longer string is spliced in as text.
 * @template T
 * @param {T} value
 * @param {Record<string, any>} bindings  Slot id -> value or {field: value}.
 * @returns {T}
 */
export function bind(value, bindings) {
  const look = (letter, n, field) => {
    const b = bindings[`${letter}${n}`];
    if (b === undefined) return undefined;
    if (field) return b && typeof b === 'object' ? b[field] : undefined;
    return b && typeof b === 'object' && 'id' in b ? b.id : b;
  };
  if (typeof value === 'string') {
    const whole = /^<([A-Z])(\d+)(?:\.([a-zA-Z][a-zA-Z0-9]*))?>$/.exec(value);
    if (whole) { const v = look(whole[1], whole[2], whole[3]); return /** @type {any} */ (v === undefined ? value : v); }
    return /** @type {any} */ (value.replace(SLOT_REF, (m, l, n, f) => { const v = look(l, n, f); return v === undefined ? m : String(v); }));
  }
  if (Array.isArray(value)) return /** @type {any} */ (value.map((v) => bind(v, bindings)));
  if (value && typeof value === 'object') return /** @type {any} */ (Object.fromEntries(Object.entries(value).map(([k, v]) => [k, bind(v, bindings)])));
  return value;
}

/**
 * Whether a value still holds an unbound slot ref.
 * @param {unknown} value
 * @returns {boolean}
 */
export function hasSlots(value) {
  return /<[A-Z]\d+(?:\.[a-zA-Z][a-zA-Z0-9]*)?>/.test(JSON.stringify(value));
}

const show = (v) => (typeof v === 'string' ? `"${v}"` : JSON.stringify(v));

/**
 * Evaluate a BOUND expression against a facts snapshot (mirror). Returns the sentences of what does not hold; [] = it holds.
 * @param {import('./contract.mjs').FactsSnapshot} facts
 * @param {any} expr
 * @returns {string[]}
 */
export function evaluate(facts, expr) {
  const [op] = Object.keys(expr ?? {});
  const a = expr?.[op];
  const item = (f, k, n) => facts.features.find((x) => x.name === f)?.items.find((i) => i.kind === k && i.name === n);
  switch (op) {
    case 'all': return a.flatMap((e) => evaluate(facts, e));
    case 'any': { const r = a.map((e) => evaluate(facts, e)); return r.some((x) => !x.length) ? [] : [`None of these holds: ${r.map((x) => x[0]?.replace(/[.]$/, '')).join('; ')}.`]; }
    case 'not': return evaluate(facts, a).length ? [] : ['Something that should not hold does.'];
    case 'fileExists': return a in facts.files ? [] : [`${a} does not exist.`];
    case 'fileContains': return (facts.files[a.path] ?? '').includes(a.text) ? [] : [`${a.path} does not contain ${show(a.text)}.`];
    case 'itemExists': return item(a.feature, a.kind, a.name) ? [] : [`Feature ${a.feature} has no ${a.kind} item ${a.name}.`];
    case 'itemBasedOn': { const i = item(a.feature, a.kind, a.name); return i && i.base === a.libraryId ? [] : [`${a.name} in ${a.feature} is not based on ${a.libraryId}.`]; }
    case 'libraryHas': return facts.library.includes(a) ? [] : [`The library has no ${a}.`];
    case 'propIs': {
      const part = (facts.parts[a.file] ?? []).find((p) => p.nodeId === a.nodeId);
      return part && part.props[a.prop] === a.value ? [] : [`${a.prop} on part ${a.nodeId} of ${a.file} is not ${show(a.value)}.`];
    }
    case 'findingGone': {
      const [rule, file] = String(a).split('|');
      return facts.findings.some((x) => x.key === a || (x.rule === rule && x.file === file)) ? [`The ${rule} problem in ${file} is still there.`] : [];
    }
    case 'noNewFindings': return facts.findingsNew.length ? [`The change added ${facts.findingsNew.length === 1 ? 'a problem' : `${facts.findingsNew.length} problems`}: ${facts.findingsNew.map((x) => `${x.rule} in ${x.file}`).join(', ')}.`] : [];
    default: return [`Line cannot evaluate the expression ${op ?? '(empty)'}.`];
  }
}
