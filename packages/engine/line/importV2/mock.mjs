// Fixed Import v2 values for tests and for the other iv2-* branches: a three-file map, the map after a move
// that dropped one branch and edited one condition, their diff, a closure, a test, coverage, a fit and a loop state
// (one checked step, fixed-size, as importLoop.mjs loopState writes it).
// Every value passes its assert* in contract.mjs.

/** @typedef {import('./contract.mjs').LogicUnit} LogicUnit */
/** @typedef {import('./contract.mjs').LogicMap} LogicMap */

/**
 * @param {string} file
 * @param {string} fn
 * @param {import('./contract.mjs').LogicUnitKind} kind
 * @param {number} n
 * @param {string} fingerprint
 * @param {number} line
 * @param {string} detail
 * @returns {LogicUnit}
 */
const unit = (file, fn, kind, n, fingerprint, line, detail) => ({ id: `${file}#${fn}:${kind}:${n}`, fingerprint, kind, file, fn, line, detail });

/**
 * @param {string} root
 * @param {LogicUnit[]} units
 * @returns {LogicMap}
 */
const mapOf = (root, units) => {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const u of units) counts[u.kind] = (counts[u.kind] ?? 0) + 1;
  return { root, files: [...new Set(units.map((u) => u.file))], units, counts };
};

const PAGE = 'src/app/opportunity/page.tsx';
const CLIENT = 'src/app/opportunity/OpportunityClient.tsx';
const ADAPTER = 'src/libs/adapters/opportunityAdapter.ts';
const MOVED_CLIENT = 'features/opportunity/pages/OpportunityClient.tsx';

/** The map before the import: 7 units in 3 files. */
export const MOCK_LOGIC_MAP = Object.freeze(mapOf('/mock/app', [
  unit(PAGE, 'OpportunityPage', 'export', 1, '0a1b2c3d4e5f6071', 5, 'function OpportunityPage'),
  unit(CLIENT, 'OpportunityClient', 'state', 1, '1b2c3d4e5f607182', 40, "activeTab = useState('all')"),
  unit(CLIENT, 'OpportunityClient', 'url-read', 1, '2c3d4e5f60718293', 42, "searchParams.get('category')"),
  unit(CLIENT, 'buildOpportunityUrlParams', 'branch', 1, '3d4e5f60718293a4', 65, 'if (selectedCategory)'),
  unit(CLIENT, 'buildOpportunityUrlParams', 'branch', 2, '4e5f60718293a4b5', 66, "if (activeTab !== 'all')"),
  unit(CLIENT, 'OpportunityClient', 'handler', 1, '5f60718293a4b5c6', 120, 'onClick=handleTabChange'),
  unit(ADAPTER, 'toOpportunity', 'export', 1, '60718293a4b5c6d7', 3, 'function toOpportunity'),
]));

/** The map after moving OpportunityClient.tsx: the first branch is gone and the second condition changed. */
export const MOCK_LOGIC_MAP_AFTER = Object.freeze(mapOf('/mock/app', [
  unit(PAGE, 'OpportunityPage', 'export', 1, '0a1b2c3d4e5f6071', 5, 'function OpportunityPage'),
  unit(MOVED_CLIENT, 'OpportunityClient', 'state', 1, '1b2c3d4e5f607182', 40, "activeTab = useState('all')"),
  unit(MOVED_CLIENT, 'OpportunityClient', 'url-read', 1, '2c3d4e5f60718293', 42, "searchParams.get('category')"),
  unit(MOVED_CLIENT, 'buildOpportunityUrlParams', 'branch', 1, '7a8b9c0d1e2f3a4b', 65, "if (activeTab !== 'recent')"),
  unit(MOVED_CLIENT, 'OpportunityClient', 'handler', 1, '5f60718293a4b5c6', 118, 'onClick=handleTabChange'),
  unit(ADAPTER, 'toOpportunity', 'export', 1, '60718293a4b5c6d7', 3, 'function toOpportunity'),
]));

const before = MOCK_LOGIC_MAP.units;
const after = MOCK_LOGIC_MAP_AFTER.units;

/** The diff from MOCK_LOGIC_MAP to MOCK_LOGIC_MAP_AFTER, as compareLogicMaps returns it. */
export const MOCK_MAP_DIFF = Object.freeze({
  kept: [after[0], after[5]],
  moved: [{ from: before[1], to: after[1] }, { from: before[2], to: after[2] }, { from: before[5], to: after[4] }],
  missing: [{ ...before[3], sentence: `The branch "if (selectedCategory)" in buildOpportunityUrlParams (${CLIENT}:65) is missing after the import.` }],
  changed: [{ before: before[4], after: after[3], sentence: `The branch in buildOpportunityUrlParams changed from "if (activeTab !== 'all')" to "if (activeTab !== 'recent')".` }],
  added: [],
});

/** The /opportunity route family. */
export const MOCK_ROUTE_CLOSURE = Object.freeze({
  appRoot: '/mock/app',
  routes: [{ route: '/opportunity', entry: PAGE }],
  files: [PAGE, CLIENT, ADAPTER],
  external: ['@subframe/core', 'next/navigation'],
});

/** One interaction test pinning the two url-param branches. */
export const MOCK_CHAR_TEST = Object.freeze({
  file: 'src/app/opportunity/__characterization__/OpportunityClient.test.tsx',
  runner: /** @type {'jest'} */ ('jest'),
  kind: /** @type {'interaction'} */ ('interaction'),
  unitFingerprints: ['3d4e5f60718293a4', '4e5f60718293a4b5'],
  title: 'buildOpportunityUrlParams keeps the category and the non-default tab',
});

/** Coverage of MOCK_LOGIC_MAP by MOCK_CHAR_TEST, with one owner waiver. */
export const MOCK_UNIT_COVERAGE = Object.freeze({
  covered: ['3d4e5f60718293a4', '4e5f60718293a4b5'],
  uncovered: ['1b2c3d4e5f607182', '2c3d4e5f60718293', '5f60718293a4b5c6', '60718293a4b5c6d7'],
  waived: [{ fingerprint: '0a1b2c3d4e5f6071', by: /** @type {'owner'} */ ('owner'), why: 'The page export only renders the client and has no logic of its own.' }],
  byKind: { branch: { covered: 2, total: 2 }, state: { covered: 0, total: 1 }, 'url-read': { covered: 0, total: 1 }, handler: { covered: 0, total: 1 }, export: { covered: 0, total: 1 } },
  details: [{ fingerprint: '5f60718293a4b5c6', id: `${CLIENT}#OpportunityClient:handler:1`, kind: 'handler', file: CLIENT, line: 120, cause: 'not-rendered', why: 'The element carrying the handler never rendered in a test.' }],
});

/** Where each unit of MOCK_LOGIC_MAP goes. */
export const MOCK_FIT_PROPOSAL = Object.freeze({
  feature: 'opportunity',
  blocks: [
    { kind: /** @type {'service'} */ ('service'), name: 'opportunityService', units: ['60718293a4b5c6d7'], from: [`${ADAPTER}#toOpportunity`], sentence: 'The adapter shapes API data, so it becomes a service.', area: /** @type {'library'} */ ('library') },
    { kind: /** @type {'workflow'} */ ('workflow'), name: 'opportunityFilters', units: ['1b2c3d4e5f607182', '2c3d4e5f60718293', '3d4e5f60718293a4'], from: [`${CLIENT}#buildOpportunityUrlParams`, `${CLIENT}#OpportunityClient`], sentence: 'The tab and category live in the URL, so they become a workflow.', area: /** @type {'feature'} */ ('feature') },
    { kind: /** @type {'page'} */ ('page'), name: 'Opportunity', units: ['0a1b2c3d4e5f6071', '5f60718293a4b5c6'], from: [`${PAGE}#OpportunityPage`, `${CLIENT}#OpportunityClient`], sentence: 'The route entry and its click handler become the page.', area: /** @type {'feature'} */ ('feature') },
  ],
  unassigned: [{ unit: '4e5f60718293a4b5', sentence: 'buildOpportunityUrlParams in OpportunityClient.tsx is a function that none of the fitting rules claims for its branch, so a person decides where it goes.' }],
});

/** The loop after the import step that produced MOCK_MAP_DIFF: stopped, because one unit is missing. */
export const MOCK_IMPORT_LOOP_STATE = Object.freeze({
  step: 'import-3-lib-OpportunityClient',
  n: 3,
  at: '2026-10-11T09:00:00.000Z',
  tool: 'line.import.toLibrary',
  mapBefore: { units: MOCK_LOGIC_MAP.units.length, counts: MOCK_LOGIC_MAP.counts, hash: '0123456789abcdef' },
  mapAfter: { units: MOCK_LOGIC_MAP_AFTER.units.length, counts: MOCK_LOGIC_MAP_AFTER.counts, hash: 'fedcba9876543210' },
  diff: { kept: 2, moved: 3, added: 0, changed: 1, missingCount: 1, missing: [{ ...MOCK_MAP_DIFF.missing[0], block: 'workflow:opportunityFilters', waived: false }] },
  tests: { passed: 0, failed: 1, total: 1, state: 'fail' },
  coverage: { covered: 2, uncovered: 4, waived: 1, total: 7 },
  behaviour: [{ from: CLIENT, to: MOVED_CLIENT, verdict: 'changed' }],
  checks: [{ id: 'char-tests', state: 'fail', sentence: '1 of 1 characterization test fails.' }, { id: 'logic-map', state: 'fail', sentence: 'One logic unit went missing.' }],
  status: /** @type {'stopped'} */ ('stopped'),
  sentence: 'One branch went missing in the move, so the import stopped before the next step.',
  fixes: [
    { id: 'put-back', fingerprint: '3d4e5f60718293a4', block: 'workflow:opportunityFilters', step: { tool: 'line.import.extractWorkflow', args: { folder: 'src', from: 'features/opportunity/pages/OpportunityClient.tsx', component: 'OpportunityClient', name: 'opportunityFilters', feature: 'opportunity' } }, sentence: 'Put the branch "if (selectedCategory)" back: makes the workflow opportunityFilters.' },
    { id: 'waive', ownerOnly: true, fingerprints: ['3d4e5f60718293a4'], sentence: 'Waive it: you accept that this logic is gone (owner only).' },
  ],
});
