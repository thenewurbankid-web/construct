// Comparator (contract C4, docs/line/FLUENT-PLAN-2026-10-15.md, task T3.1).
// Pure module, no dependencies: turns a gold C2 answer, a student C2 answer and the
// student's C3 gate result into a verdict with one plain-English reason.
//
// Choices the contract left open:
// - `same` also requires the student's gate to pass. A student that copies gold but
//   whose gate failed is `wrong` (the gate is the source of truth, not gold).
// - A missing studentGate counts as a failed gate.
// - Molecule `parts` are compared in order: a molecule composes its parts in sequence,
//   so a reordered list is not `same` (it can still be `equivalent` via behavesSame).
// - `not-expressible` on both sides is `same` regardless of the reason wording; against
//   any other decision it is always `wrong` (no JS, so nothing for behavesSame to run).
// - `kind`, `js` and `params` do not affect `same`; behaviour differences there are the
//   job of behavesSame.

const norm = (s) => (s == null ? null : String(s).replace(/\s+/g, ' ').trim().replace(/\s*([().,])\s*/g, '$1'));

const show = (v) => (v == null ? 'none' : Array.isArray(v) ? `[${v.join(', ')}]` : `\`${v}\``);

function idOf(a) {
  return a.decision === 'existing' ? a.existing : a.atom;
}

// First difference between gold and student, as a clause, or null when they match.
function firstDifference(gold, student) {
  if (gold.decision !== student.decision) {
    return `the student decided ${show(student.decision)} where gold decided ${show(gold.decision)}`;
  }
  if (gold.decision === 'not-expressible') return null;
  if (gold.decision === 'molecule') {
    const g = gold.parts ?? [];
    const s = student.parts ?? [];
    if (g.length !== s.length || g.some((p, i) => p !== s[i])) {
      return `the student's molecule parts ${show(s)} differ from gold's ${show(g)}`;
    }
  } else if (idOf(gold) !== idOf(student)) {
    const field = gold.decision === 'existing' ? 'existing atom' : 'atom';
    return `the student's ${field} ${show(idOf(student))} differs from gold's ${show(idOf(gold))}`;
  }
  if (norm(gold.sentence) !== norm(student.sentence)) {
    return `the student's sentence ${show(norm(student.sentence))} differs from gold's ${show(norm(gold.sentence))}`;
  }
  return null;
}

// Why the gate failed, as a clause naming the first failed check.
function gateFailure(gate) {
  if (!gate) return 'the student has no gate result';
  const failed = Object.entries(gate.checks ?? {}).find(([, v]) => v === 'fail');
  return failed ? `the student's ${failed[0]} check failed` : "the student's gate did not pass";
}

const sentence = (clause) => `${clause[0].toUpperCase()}${clause.slice(1)}.`;

export function compare(gold, student, studentGate, opts = {}) {
  const entry = gold?.entry ?? student?.entry ?? studentGate?.entry ?? null;
  const result = (verdict, clause) => ({ entry, verdict, reason: sentence(clause), gold, student, studentGate });
  const gatePass = studentGate?.pass === true;
  const diff = firstDifference(gold, student);

  if (diff === null) {
    return gatePass
      ? result('same', 'the student matches gold and its gate passed')
      : result('wrong', `the student matches gold, but ${gateFailure(studentGate)}`);
  }
  if (!gatePass) return result('wrong', `${diff}, and ${gateFailure(studentGate)}`);
  if (gold.decision === 'not-expressible' || student.decision === 'not-expressible') {
    return result('wrong', `${diff}, and a not-expressible answer has no behaviour to compare`);
  }
  if (typeof opts.behavesSame !== 'function') return result('wrong', `${diff}, and no equivalence check was given`);
  return opts.behavesSame(gold, student) === true
    ? result('equivalent', `${diff}, but its gate passed and it behaves the same`)
    : result('wrong', `${diff}, and it does not behave the same`);
}

export function summarize(results) {
  const counts = { same: 0, equivalent: 0, wrong: 0 };
  for (const r of results) counts[r.verdict] += 1;
  const total = results.length;
  return { ...counts, total, rightRate: total === 0 ? 0 : (counts.same + counts.equivalent) / total };
}
