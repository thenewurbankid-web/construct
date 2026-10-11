// Line Import v2 -- the import loop's ops in memory (importLoop.mjs LoopOps) for the Import agent mock (mockImportAgent.mjs,
// Cockpit's mock mode): a fixed logic map of examples/import-sample's src/alerts whose units follow the mock plan's moves,
// its FitProposal, three characterization tests that pass, and every unit covered once the tests ran. The diff is the
// real one (importV2/compare.mjs). Pure: no Node imports, so the browser runs it.
import { compareLogicMaps } from './importV2/compare.mjs';
import { mapSummary, stableHash } from './importLoop.mjs';

/** The mock app's units (examples/import-sample, src/alerts), as [file in the folder, fn, kind, detail]. */
const MOCK_UNITS = [
  ['components/AlertRow.tsx', 'AlertRow', 'export', 'function AlertRow'],
  ['components/AlertRow.tsx', 'on:onClick', 'handler', 'onClick={() => onOpen(alert.id)}'],
  ['components/SeverityBadge.tsx', 'SeverityBadge', 'export', 'function SeverityBadge'],
  ['components/SeverityBadge.tsx', 'SeverityBadge', 'branch', "severity === 'high' ? …"],
  ['components/Table.tsx', 'Table', 'export', 'function Table'],
  ['components/Table.tsx', 'Table', 'render-if', 'rows.length === 0'],
  ['pages/AlertsPage.tsx', 'AlertsPage', 'export', 'function AlertsPage'],
  ['pages/AlertsPage.tsx', 'AlertsPage', 'state', 'filter = useState(all)'],
  ['pages/AlertsPage.tsx', 'AlertsPage', 'branch', "filter === 'all' ? …"],
  ['pages/AlertDetailPage.tsx', 'AlertDetailPage', 'export', 'function AlertDetailPage'],
  ['pages/AlertDetailPage.tsx', 'AlertDetailPage', 'branch', 'if (!alert)'],
];

/** A mock unit's fingerprint: kind, function and text, never the path (so it survives a move). */
const fingerprint = (kind, fn, detail) => stableHash(`${kind}\u0000${fn}\u0000${detail}`);

/** Where a mock plan step moves a file of the folder: [from, to], or null. */
function mockMove(tool, args) {
  if (tool !== 'line.import.toLibrary' || typeof args?.from !== 'string') return null;
  const ext = args.from.slice(args.from.lastIndexOf('.'));
  return [args.from, `library/${args.kind}/${args.name}${ext}`];
}

/**
 * The import loop's ops in memory for the Import agent mock. `dropOn(stepTool, args)` plants a lost unit, for tests.
 * @param {{dropOn?: (tool: string, args: any) => boolean}} [o]
 * @returns {any}
 */
export function createMockLogic(o = {}) {
  const saved = new Map();
  /** @type {Record<string, string>} */
  const moves = {};
  const dropped = new Set();
  const unitsAt = (folder) => {
    const counter = {};
    return MOCK_UNITS.map(([file, fn, kind, detail]) => {
      const k = `${fn}:${kind}`; counter[k] = (counter[k] ?? 0) + 1;
      return { id: `${folder}/${file}#${fn}:${kind}:${counter[k]}`, fingerprint: fingerprint(kind, fn, detail), kind, file: `${folder}/${moves[file] ?? file}`, fn, line: 1, detail };
    }).filter((u) => !dropped.has(u.fingerprint));
  };
  const tests = (folder) => [
    { file: `${folder}/components/AlertRow.test.tsx`, runner: 'jest', kind: 'interaction', title: 'AlertRow opens the alert on click', unitFingerprints: unitsAt(folder).filter((u) => u.fn === 'AlertRow' || u.fn === 'on:onClick').map((u) => u.fingerprint) },
    { file: `${folder}/components/Table.test.tsx`, runner: 'jest', kind: 'render', title: 'Table and SeverityBadge render every branch', unitFingerprints: unitsAt(folder).filter((u) => u.fn === 'Table' || u.fn === 'SeverityBadge').map((u) => u.fingerprint) },
    { file: `${folder}/pages/AlertsPage.test.tsx`, runner: 'jest', kind: 'render', title: 'The alert pages render the list, the filter and a missing alert', unitFingerprints: unitsAt(folder).filter((u) => /Page$/.test(u.fn)).map((u) => u.fingerprint) },
  ];
  // The fit: each component or page file is one block of its kind (the mock has no services, domains or usecases).
  const proposalOf = (folder) => {
    const blocks = new Map();
    for (const [file, fn, kind, detail] of MOCK_UNITS) {
      const name = file.split('/').pop().replace(/\.[^.]+$/, '');
      const bk = file.startsWith('pages/') ? 'page' : 'component';
      const key = `${bk}:${name}`;
      if (!blocks.has(key)) blocks.set(key, { kind: bk, name, units: [], from: [`${folder}/${file}#${name}`], sentence: `${name} is a ${bk}: it renders JSX with its render-ifs and handlers.`, area: 'feature' });
      blocks.get(key).units.push(fingerprint(kind, fn, detail));
    }
    return { feature: folder.split('/').pop(), blocks: [...blocks.values()], unassigned: [] };
  };
  return {
    closure: async (_root, folder, route) => ({ appRoot: '/mock/import-sample', routes: route ? [{ route, entry: `${folder}/pages/AlertsPage.tsx` }] : [], files: [...new Set(MOCK_UNITS.map((u) => `${folder}/${u[0]}`))], external: [] }),
    buildMap: async (_root, folder) => { const units = unitsAt(folder); return { root: '/mock/import-sample', files: [...new Set(units.map((u) => u.file))], units, counts: mapSummary({ units }).counts }; },
    compare: async (before, after) => compareLogicMaps(before, after),
    fit: async (_root, folder) => ({ proposal: proposalOf(folder), steps: [], skipped: [] }),
    characterize: async (_root, folder) => ({ tests: tests(folder), sentence: 'Line wrote 3 characterization tests (mock).' }),
    runTests: async (_root, _folder, list) => ({ state: list.length ? 'pass' : 'skipped', passed: list.length, failed: 0, total: list.length, failures: [], sentence: list.length ? `The ${list.length} characterization tests pass.` : 'There are no characterization tests yet.' }),
    // Every moved file behaves the same in the mock (the disk check is importVerify.mjs checkBehaviour).
    behaviour: async (_root, _folder, diff) => [...new Map((diff?.moved ?? []).map((m) => [`${m.from.file}>${m.to.file}`, { from: m.from.file, to: m.to.file, verdict: 'same-behaviour' }])).values()],
    /** The mock plan's step landed: its file's units move with it (and a planted drop loses one). */
    stepLanded: (tool, args) => {
      const m = mockMove(tool, args);
      if (m) moves[m[0]] = m[1];
      if (o.dropOn && o.dropOn(tool, args)) {
        const victim = MOCK_UNITS.find(([file, , kind]) => (m ? file === m[0] : true) && kind !== 'export');
        if (victim) dropped.add(fingerprint(victim[2], victim[1], victim[3]));
      }
    },
    /** A person put the logic back. */
    restore: () => dropped.clear(),
    save: async (name, data) => { saved.set(name, JSON.parse(JSON.stringify(data))); },
    load: async (name) => (saved.has(name) ? JSON.parse(JSON.stringify(saved.get(name))) : null),
    records: [],
    record(state) { this.records.push(state); },
  };
}
