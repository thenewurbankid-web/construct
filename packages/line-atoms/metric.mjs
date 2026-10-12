// Line logic atoms, the north-star metric: how much of a feature's logic map (Import v2 LogicUnit rows) maps onto
// atoms. Static and transparent: each unit is matched by the ordered rules below against "<fn> <detail>"; the
// first rule that matches names the role, and the role names an atom when one is built (else the unit counts toward a
// planned atom, or toward no atom at all). Every unit's rule is kept, so a reviewer can see why it counted.
//
//   node packages/line-atoms/metric.mjs            prints the report for the opportunity feature and the bench shop
//   node packages/line-atoms/metric.mjs --json     the same as JSON
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listAtoms } from './index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..');

/** The two maps the metric reports on. */
export const MAPS = Object.freeze({
  opportunity: path.join(REPO, 'docs', 'line', 'import-v2', 'opportunity-logicmap.prototype.jsonl'),
  'bench-shop': path.join(HERE, 'metric', 'bench-shop-logicmap.jsonl'),
});

/** Unit kinds that are declarations or rendering, not behaviour; the "logic only" figure leaves them out. */
export const PRESENTATION_KINDS = Object.freeze(['export', 'render-if']);

/**
 * The ordered rules: role, the pattern over "<fn> <detail>", and why it means that role.
 * Roles without a built atom (nav.searchParams, state.persist, ui.notify) are the next atoms (survey.json `atom: null`).
 * @type {ReadonlyArray<{role: string|null, kinds?: string[], re: RegExp, why: string}>}
 */
export const RULES = Object.freeze([
  { role: null, kinds: ['analytics'], re: /./, why: 'Sends an analytics event: a side effect, not an atom\'s job.' },
  { role: 'state.persist', kinds: ['storage'], re: /./, why: 'Reads or writes browser storage: the persisted-store pattern.' },
  { role: 'ui.notify', kinds: ['toast'], re: /./, why: 'Shows or dismisses a toast: feedback, owned by the primitive library.' },
  { role: 'query.infinite', re: /hasMore|LoadMore|loadMore|isFetchingMore|accumulated|InfiniteScroll|isIntersecting|sentinel|\bsetPage\b|\[page, setPage\]|Data, page\]/, why: 'Loads more items as the list is scrolled.' },
  { role: 'list.filterSort', re: /\bfilters\b|setFilters|Filter|sortBy|SortOption|\bsort\b|categorySearch|searchCategories|SearchMatch|compareText|splitMatch|filteredCategories|\bquery\b|setQuery|\bshown\b|\[category, setCategory\]|onValueChange=setCategory/, why: 'Filters, searches or sorts a list.' },
  { role: 'query.loading', re: /isFetching|isLoading|isSummaryLoading|isError|isStatusError|isRecomputing|refetch|statusFulfilled|use\w+Query\(/, why: 'Loads data and tracks loading and errors.' },
  { role: 'form.submit', re: /validate|Validation|\bsubmit\b|onSubmit|setErrors|\[errors, |\[form, setForm\]|\bfield\(|setForm\(|handleSave/, why: 'Holds form values, validates them and submits them.' },
  { role: 'auth.permission', re: /[Ss]ubscription|isAdmin|[Pp]ermission|\.roles\b|\brole\s*===/, why: 'Gates what a person may see or do.' },
  { role: 'query.poll', re: /refetchInterval|setInterval|\bpoll/i, why: 'Loads data again on a timer.' },
  { role: 'input.debounce', re: /debounce|setTimeout/, why: 'Waits for typing to stop.' },
  { role: 'list.paginate', re: /pageSize|perPage|\bpageIndex\b/, why: 'Splits a list into pages.' },
  { role: 'flow.step', re: /\bsetStep\b|\bwizard\b|\bcurrentStep\b/, why: 'Walks through the steps of a flow.' },
  { role: 'date.range', re: /startDate|endDate|dateRange|isWithinInterval/, why: 'Picks or checks a date range.' },
  { role: 'data.exportCsv', re: /\bcsv\b|text\/csv/i, why: 'Exports rows as CSV.' },
  { role: 'state.undo', re: /\bundo\b|\bredo\b/i, why: 'Undoes and redoes changes.' },
  { role: 'data.optimistic', re: /optimistic|rollback/i, why: 'Shows a change before it is saved.' },
  { role: 'nav.searchParams', re: /searchParams|UrlParams|router\.replace|useSearchParams/, why: 'Keeps view state in the URL.' },
]);

/**
 * Read a logic map stored as JSONL (one LogicUnit per line).
 * @param {string} file
 * @returns {{id: string, kind: string, file: string, fn: string, detail: string}[]}
 */
export function readUnits(file) {
  return fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}

/**
 * The atom (or planned role) one unit maps onto.
 * @param {{id: string, kind: string, file: string, fn: string, detail: string}} unit
 * @param {import('./contract.mjs').AtomDescriptor[]} [atoms]
 * @returns {import('./contract.mjs').UnitAtom}
 */
export function unitAtom(unit, atoms = listAtoms()) {
  const text = `${unit.fn} ${unit.detail}`;
  const rule = RULES.find((r) => (!r.kinds || r.kinds.includes(unit.kind)) && r.re.test(text));
  if (!rule || rule.role === null) return { id: unit.id, kind: unit.kind, atom: null, role: null, via: 'no rule' };
  const atom = atoms.find((a) => a.role === rule.role) ?? null;
  return { id: unit.id, kind: unit.kind, atom: atom?.id ?? null, role: rule.role, via: rule.why };
}

const pct = (n, d) => (d === 0 ? 0 : Math.round((n / d) * 1000) / 10);

/**
 * The metric for one map: the share of units on a built atom, on a planned atom, and on none, overall and for logic
 * units only (PRESENTATION_KINDS left out), with the count per atom.
 * @param {{id: string, kind: string, file: string, fn: string, detail: string}[]} units
 * @returns {{units: number, onAtoms: number, onAtomsPct: number, onPlanned: number, onPlannedPct: number, logicUnits: number, logicOnAtoms: number, logicOnAtomsPct: number, byAtom: Record<string, number>, byPlanned: Record<string, number>, mapped: import('./contract.mjs').UnitAtom[]}}
 */
export function atomCoverage(units) {
  const mapped = units.map((u) => unitAtom(u));
  const on = mapped.filter((m) => m.atom !== null);
  const planned = mapped.filter((m) => m.atom === null && m.role !== null);
  const logic = mapped.filter((m) => !PRESENTATION_KINDS.includes(m.kind));
  const logicOn = logic.filter((m) => m.atom !== null);
  const count = (list, key) => list.reduce((acc, m) => ({ ...acc, [m[key]]: (acc[m[key]] ?? 0) + 1 }), /** @type {Record<string, number>} */ ({}));
  return {
    units: units.length, onAtoms: on.length, onAtomsPct: pct(on.length, units.length),
    onPlanned: planned.length, onPlannedPct: pct(planned.length, units.length),
    logicUnits: logic.length, logicOnAtoms: logicOn.length, logicOnAtomsPct: pct(logicOn.length, logic.length),
    byAtom: count(on, 'atom'), byPlanned: count(planned, 'role'), mapped,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = Object.fromEntries(Object.entries(MAPS).map(([name, file]) => {
    const { mapped: _m, ...r } = atomCoverage(readUnits(file));
    return [name, r];
  }));
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    for (const [name, r] of Object.entries(report)) {
      process.stdout.write(`${name}: ${r.onAtoms}/${r.units} units on atoms (${r.onAtomsPct}%), logic only ${r.logicOnAtoms}/${r.logicUnits} (${r.logicOnAtomsPct}%), ${r.onPlanned} more on planned atoms (${r.onPlannedPct}%)\n`);
      process.stdout.write(`  atoms: ${JSON.stringify(r.byAtom)}\n  planned: ${JSON.stringify(r.byPlanned)}\n`);
    }
  }
}
