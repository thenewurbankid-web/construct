// Gate runner (docs/line/FLUENT-PLAN-2026-10-15.md, C3 and Wave 2 leaf t1-2c-assemble).
// schema comes from contract/validate.mjs; grammar, equivalence and types are injected functions
// (answer) -> CheckResult so this module never imports its sibling gate folders.

import { validateAnswer } from '../contract/validate.mjs';

export const CHECKS = ['schema', 'grammar', 'equivalence', 'types'];

const SKIP = Object.freeze({ check: 'skip', errors: [], fixes: [] });
const skip = () => ({ check: 'skip', errors: [], fixes: [] });

function schemaCheck(answer) {
  const { check, errors } = validateAnswer(answer);
  return { check, errors, fixes: [] };
}

export function runGate(answer, { grammar = skip, equivalence = skip, types = skip } = {}) {
  const results = { schema: schemaCheck(answer) };
  const injected = { grammar, equivalence, types };
  for (const name of CHECKS.slice(1)) {
    results[name] = results.schema.check === 'fail' ? SKIP : injected[name](answer);
  }

  const failed = CHECKS.filter((name) => results[name].check === 'fail');
  const first = failed[0];
  const refusal = first === undefined ? null : results[first].errors?.[0] ?? `The ${first} check failed.`;

  const seen = new Set();
  const fixes = [];
  for (const name of failed) {
    for (const fix of results[name].fixes ?? []) {
      const key = JSON.stringify(fix);
      if (!seen.has(key)) {
        seen.add(key);
        fixes.push(fix);
      }
    }
  }

  return {
    entry: answer?.entry ?? null,
    pass: failed.length === 0,
    checks: Object.fromEntries(CHECKS.map((name) => [name, results[name].check])),
    refusal,
    fixes,
  };
}
