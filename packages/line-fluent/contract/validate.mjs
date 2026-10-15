// Contract C2 validator (docs/line/FLUENT-PLAN-2026-10-15.md). No dependencies: the rules of
// answer.schema.json are implemented by hand; validate.test.mjs checks the lists below against the schema.
// Each error is one plain-English sentence naming the field and the fix; it becomes C3 checks.schema and
// the refusal text fed back to the model.

export const FIELDS = ['entry', 'decision', 'atom', 'existing', 'kind', 'sentence', 'js', 'params', 'parts', 'reason'];
export const DECISIONS = ['new-atom', 'existing', 'molecule', 'not-expressible'];
export const KINDS = ['question', 'copy', 'in-place', 'value', 'effect'];
export const ATOM_ID = /^[a-z][A-Za-z0-9]*$/;

const isText = (v) => typeof v === 'string' && v.trim().length > 0;
const show = (v) => JSON.stringify(v);

export function validateAnswer(answer) {
  const errors = [];
  if (answer === null || typeof answer !== 'object' || Array.isArray(answer)) {
    errors.push(`The answer must be one JSON object with the fields ${FIELDS.join(', ')}; got ${show(answer)}.`);
    return done(errors);
  }

  const keys = Object.keys(answer);
  for (const k of keys) {
    if (!FIELDS.includes(k)) errors.push(`Field \`${k}\` is not part of the answer; remove it (allowed fields: ${FIELDS.join(', ')}).`);
  }
  const missing = FIELDS.filter((f) => !keys.includes(f));
  for (const f of missing) errors.push(`Field \`${f}\` is missing; add it (use null when it does not apply).`);
  const known = keys.filter((k) => FIELDS.includes(k));
  if (missing.length === 0 && known.join() !== FIELDS.join()) {
    errors.push(`The fields are out of order; write them as ${FIELDS.join(', ')}.`);
  }

  const { entry, decision, atom, existing, kind, sentence, js, params, parts, reason } = answer;

  if (!isText(entry)) errors.push('Field `entry` must be the reference entry id as a non-empty string, e.g. "Array.prototype.flatMap".');

  if (!DECISIONS.includes(decision)) {
    errors.push(`Field \`decision\` is ${show(decision)}; use one of ${DECISIONS.join(', ')}.`);
  }
  const notExpressible = decision === 'not-expressible';

  if (atom !== null && atom !== undefined && !(typeof atom === 'string' && ATOM_ID.test(atom))) {
    errors.push(`Field \`atom\` is ${show(atom)}; use a camelCase atom id such as "flatMapped", or null.`);
  }
  if ((decision === 'new-atom' || decision === 'molecule') && atom === null) {
    errors.push(`Field \`atom\` is empty; a ${decision} answer needs a camelCase atom id such as "flatMapped".`);
  }

  if (decision === 'existing') {
    if (!isText(existing)) errors.push('Field `existing` is empty; when `decision` is existing, set it to the catalog atom id that already does this.');
  } else if (existing !== null && existing !== undefined) {
    errors.push(`Field \`existing\` must be null unless \`decision\` is existing; set it to null or change \`decision\` to existing.`);
  }

  if (kind === null) {
    if (DECISIONS.includes(decision) && !notExpressible) errors.push(`Field \`kind\` is null; use one of ${KINDS.join(', ')}.`);
  } else if (kind !== undefined && !KINDS.includes(kind)) {
    errors.push(`Field \`kind\` is ${show(kind)}; use one of ${KINDS.join(', ')}, or null only when \`decision\` is not-expressible.`);
  }

  for (const [name, value] of [['sentence', sentence], ['js', js]]) {
    if (value === undefined) continue;
    if (notExpressible) {
      if (value !== null) errors.push(`Field \`${name}\` must be null when \`decision\` is not-expressible; set it to null.`);
    } else if (DECISIONS.includes(decision) && !isText(value)) {
      errors.push(`Field \`${name}\` is empty; write the ${name === 'sentence' ? 'Atomic English sentence' : 'JS it stands for'} as a non-empty string.`);
    }
  }

  if (params !== undefined) {
    if (!Array.isArray(params)) {
      errors.push('Field `params` must be a list of [name, type] pairs, e.g. [["xs", "list"], ["f", "fn"]].');
    } else {
      params.forEach((p, i) => {
        if (!Array.isArray(p) || p.length !== 2 || !isText(p[0]) || !isText(p[1])) {
          errors.push(`Field \`params\` item ${i} is ${show(p)}; write it as a [name, type] pair of two non-empty strings.`);
        }
      });
    }
  }

  if (parts !== undefined) {
    if (parts !== null && !Array.isArray(parts)) {
      errors.push('Field `parts` must be a list of catalog atom ids, or null.');
    } else if (Array.isArray(parts)) {
      parts.forEach((p, i) => {
        if (!isText(p)) errors.push(`Field \`parts\` item ${i} is ${show(p)}; write it as a catalog atom id string.`);
      });
    }
    const filled = Array.isArray(parts) && parts.length > 0;
    if (decision === 'molecule' && !filled) {
      errors.push('Field `parts` is empty; when `decision` is molecule, list the catalog atoms it is built from.');
    } else if (decision !== 'molecule' && DECISIONS.includes(decision) && filled) {
      errors.push('Field `parts` must be null or [] unless `decision` is molecule; clear it or change `decision` to molecule.');
    }
  }

  if (reason !== undefined) {
    if (notExpressible) {
      if (!isText(reason)) errors.push('Field `reason` is empty; when `decision` is not-expressible, give one plain sentence saying why.');
    } else if (reason !== null) {
      errors.push('Field `reason` must be null unless `decision` is not-expressible; set it to null.');
    }
  }

  return done(errors);
}

function done(errors) {
  const pass = errors.length === 0;
  return { pass, check: pass ? 'pass' : 'fail', errors };
}
