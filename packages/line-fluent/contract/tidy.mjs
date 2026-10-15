// Fix-ups that need no model, applied to an answer before the gate: what a small model gets wrong about the C2 shape
// (field order, a missing field, an extra field, a capitalised enum) never costs it a refusal or a second turn. The
// content is never changed, with one exception: `existing` is filled when the decision is existing and there is
// exactly one candidate atom, since then there is only one thing it can name. Every change is listed in `tidied`.
import { readFileSync } from 'node:fs';

const SCHEMA = JSON.parse(readFileSync(new URL('./answer.schema.json', import.meta.url), 'utf8'));
const FIELDS = Object.keys(SCHEMA.properties);
const ENUMS = Object.fromEntries(FIELDS.filter((f) => SCHEMA.properties[f].enum).map((f) => [f, SCHEMA.properties[f].enum]));

/**
 * @param {object} answer a parsed answer object
 * @param {{candidates?: {atom: string}[]}} [context]
 * @returns {{answer: object, tidied: string[]}}
 */
export function tidyAnswer(answer, { candidates = [] } = {}) {
  if (!answer || typeof answer !== 'object' || Array.isArray(answer)) return { answer, tidied: [] };
  const tidied = [];
  const out = {};
  for (const f of FIELDS) {
    if (f in answer) out[f] = answer[f];
    else {
      out[f] = f === 'params' ? [] : null;
      tidied.push(`added ${f}`);
    }
  }
  for (const f of Object.keys(answer)) if (!FIELDS.includes(f)) tidied.push(`dropped ${f}`);
  if (Object.keys(answer).filter((f) => FIELDS.includes(f)).join() !== FIELDS.filter((f) => f in answer).join()) tidied.push('reordered');
  for (const [f, allowed] of Object.entries(ENUMS)) {
    if (typeof out[f] !== 'string' || allowed.includes(out[f])) continue;
    const fixed = allowed.find((v) => typeof v === 'string' && v === out[f].trim().toLowerCase());
    if (fixed) {
      tidied.push(`${f} ${out[f]} -> ${fixed}`);
      out[f] = fixed;
    }
  }
  if (out.decision === 'existing' && !out.existing && candidates.length === 1) {
    out.existing = candidates[0].atom;
    tidied.push(`existing -> ${out.existing} (the only candidate)`);
  }
  // The decision is the model's; the fields that only follow from it are set to match.
  const clear = (f, why) => {
    if (out[f] === null || (f === 'parts' && Array.isArray(out[f]) && !out[f].length)) return;
    out[f] = null;
    tidied.push(`${f} -> null (${why})`);
  };
  const blank = (v) => v === null || v === undefined || (typeof v === 'string' && !v.trim());
  if (out.decision === 'not-expressible') for (const f of ['existing', 'kind', 'sentence', 'js', 'parts']) clear(f, 'not-expressible');
  else clear('reason', `${out.decision}, not not-expressible`);
  if (out.decision !== 'existing' && out.decision !== 'not-expressible') clear('existing', `${out.decision}, not existing`);
  if (out.decision !== 'molecule' && out.decision !== 'not-expressible') clear('parts', `${out.decision}, not molecule`);
  // An existing atom already has its sentence and JS in the catalog.
  const named = out.decision === 'existing' && candidates.find((c) => c.atom === out.existing);
  if (named && blank(out.sentence) && named.fluent) {
    out.sentence = named.fluent;
    tidied.push(`sentence -> ${out.existing}'s catalog sentence`);
  }
  if (named && blank(out.js) && named.js?.length) {
    out.js = named.js[0];
    tidied.push(`js -> ${out.existing}'s catalog js`);
  }
  return { answer: out, tidied };
}
