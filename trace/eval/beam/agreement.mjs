// Agreement between the Opus-Grader and the owner (#896). Pure functions over items; no I/O.
//
//   per item   per rubric line {grader, owner, diff = owner - grader, agree = equal}; overall {grader, owner, diff}
//              (sums over the lines both scored); disagree2 = |overall diff| >= 2 or any line |diff| >= 2
//   summary    mean total per judge (each over the items that judge scored), per-line means, agreement rate = equal
//              line scores / line scores both judges gave, and the number of disagree2 items
//   order      disagree2 first (largest |diff| first), then items the owner has not graded, then the rest, by id

/**
 * @param {{grader?: {scores?: Record<string, number|null>}, owner?: {scores?: Record<string, number|null>}}} item
 * @param {{id: string, max: number}[]} lines
 */
export function itemAgreement(item, lines) {
  const g = item.grader?.scores ?? null;
  const o = item.owner?.scores ?? null;
  const per = {};
  let gSum = 0, oSum = 0, both = 0, maxLine = 0;
  for (const l of lines) {
    const gv = g && Number.isInteger(g[l.id]) ? g[l.id] : null;
    const ov = o && Number.isInteger(o[l.id]) ? o[l.id] : null;
    const has = gv !== null && ov !== null;
    per[l.id] = { grader: gv, owner: ov, diff: has ? ov - gv : null, agree: has ? ov === gv : null };
    if (has) { gSum += gv; oSum += ov; both++; maxLine = Math.max(maxLine, Math.abs(ov - gv)); }
  }
  if (!both) return { lines: per, overall: null, disagree2: false, compared: 0 };
  const diff = oSum - gSum;
  return { lines: per, overall: { grader: gSum, owner: oSum, diff }, disagree2: Math.abs(diff) >= 2 || maxLine >= 2, compared: both };
}

const total = (scores, lines) => {
  if (!scores) return null;
  const vals = lines.map((l) => scores[l.id]);
  return vals.every(Number.isInteger) ? vals.reduce((a, b) => a + b, 0) : null;
};
const mean = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null);

/**
 * @param {any[]} items
 * @param {{id: string, max: number}[]} lines
 */
export function summarize(items, lines) {
  const gTotals = items.map((i) => total(i.grader?.scores, lines)).filter((x) => x !== null);
  const oTotals = items.map((i) => total(i.owner?.scores, lines)).filter((x) => x !== null);
  const perLine = {};
  for (const l of lines) {
    perLine[l.id] = {
      max: l.max,
      grader: mean(items.map((i) => i.grader?.scores?.[l.id]).filter(Number.isInteger)),
      owner: mean(items.map((i) => i.owner?.scores?.[l.id]).filter(Number.isInteger)),
    };
  }
  let agree = 0, compared = 0, disagree2 = 0, ownerGraded = 0;
  for (const i of items) {
    const a = itemAgreement(i, lines);
    if (a.compared) ownerGraded++;
    for (const l of lines) if (a.lines[l.id].agree !== null) { compared++; if (a.lines[l.id].agree) agree++; }
    if (a.disagree2) disagree2++;
  }
  return {
    items: items.length,
    maxTotal: lines.reduce((a, l) => a + l.max, 0),
    mean: { grader: mean(gTotals), owner: mean(oTotals) },
    graded: { grader: gTotals.length, owner: oTotals.length, both: ownerGraded },
    perLine,
    agreementRate: compared ? Math.round((agree / compared) * 1000) / 1000 : null,
    disagree2,
  };
}

/**
 * Items in review order (see the header). Returns new objects with `agreement` filled in.
 * @param {any[]} items
 * @param {{id: string, max: number}[]} lines
 */
export function reviewOrder(items, lines) {
  const withA = items.map((i) => ({ ...i, agreement: itemAgreement(i, lines) }));
  const rank = (i) => (i.agreement.disagree2 ? 0 : i.agreement.compared ? 2 : 1);
  return withA.sort((a, b) => rank(a) - rank(b)
    || Math.abs(b.agreement.overall?.diff ?? 0) - Math.abs(a.agreement.overall?.diff ?? 0)
    || String(a.id).localeCompare(String(b.id), "en", { numeric: true }));
}
