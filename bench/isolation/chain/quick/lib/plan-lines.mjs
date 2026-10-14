// Constrained Trace plan lines (#942, audit rule: fixed input, constrained output, one unit per request).
// A plan is written one function per request. Each line is not free text: it is one of the Smith template
// sentences (TEMPLATES, an enum) plus its named slots, forced through Ollama `format` (JSON schema anyOf, one
// branch per template), and rendered here into the sentence form matchPlan reads.
//
//   templateForms() -> [{ id, form, slots }]          one per TEMPLATES entry
//   planLineSchema() / planSchemaFor()                 the `format` schema for one function's plan
//   renderLine({ template, ...slots }) -> string       e.g. { template: 'return X', X: "'On loan'" } -> "return 'On loan'"
import { TEMPLATES } from '../tasks.mjs';

export const OPS = Object.freeze(['+', '-', '*', '/', '===', '!==', '<', '<=', '>', '>=']);

// 'SUBJECT VERB ARG and ARG   (a method call ...)' -> form 'SUBJECT VERB ARG and ARG2', slots [SUBJECT, VERB, ARG, ARG2].
export function templateForms() {
  return TEMPLATES.map((raw) => {
    const form0 = raw.replace(/\s{2,}\(.*\)\s*$/, '').trim();
    const seen = {};
    const slots = [];
    const form = form0.replace(/\b[A-Z][A-Z]+\b|\b[AB]\b|\bX\b/g, (w) => {
      seen[w] = (seen[w] ?? 0) + 1;
      const name = seen[w] > 1 ? `${w}${seen[w]}` : w;
      slots.push(name);
      return name;
    });
    return { id: form0, form, slots };
  });
}

const slotSchema = (name) => (name === 'OP' ? { type: 'string', enum: OPS } : { type: 'string', minLength: 1 });

export function planLineSchema() {
  return {
    anyOf: templateForms().map((t) => ({
      type: 'object',
      properties: { template: { type: 'string', enum: [t.id] }, ...Object.fromEntries(t.slots.map((s) => [s, slotSchema(s)])) },
      required: ['template', ...t.slots.filter((s) => s !== 'ARG2')],
    })),
  };
}

// One function's plan: { lines: [line, ...] }.
export const planSchemaFor = () => ({ type: 'object', properties: { lines: { type: 'array', minItems: 1, items: planLineSchema() } }, required: ['lines'] });

export function renderLine(line) {
  const t = templateForms().find((x) => x.id === line?.template);
  if (!t) return null;
  let out = t.form;
  if (t.slots.includes('ARG2') && !String(line.ARG2 ?? '').trim()) out = out.replace(/ and ARG2\b/, '');
  // One pass, so a slot value is never rewritten by a later slot.
  const re = new RegExp(`\\b(${[...t.slots].sort((a, b) => b.length - a.length).join('|')})\\b`, 'g');
  return out.replace(re, (s) => String(line[s] ?? '').trim());
}

// The one-function plan request: the examples, the spec and ONLY this function's signature.
export function planRequestUser(t, fn, examples) {
  const ex = examples.map((e) => `${e.signature}\n${e.plan.map((l) => `  ${l}`).join('\n')}`).join('\n\n');
  const sig = t.stub.split('\n').find((l) => new RegExp(`^export function ${fn}\\(`).test(l));
  if (!sig) throw new Error(`no stub signature for ${fn}`);
  return `Examples:\n${ex}\n\nSpec:\n${t.spec}\n\nStub:\n${sig.replace(/^export /, '').replace(/\s*\{$/, '')}\n\nPlan:`;
}
