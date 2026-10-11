// Line Import v2 (docs/line/import-v2/CONTRACT.md) -- PURE stand-ins for the pieces other branches own, so the import
// loop (importLoop.mjs) runs and is tested today. Each mirrors the contract's shape and is replaced at merge:
//
//   stableHash(text)               a 16-hex fingerprint hash (no Node crypto, so Cockpit's mock mode runs it too)
//   unitFingerprint(kind, fn, text, n)   LogicUnit.fingerprint: kind + enclosing function + normalized text (+ which
//                                  identical occurrence), never the file path, so it survives a move   [iv2-map]
//   compareLogicMaps(before, after, renames?)   -> MapDiff {kept, moved, missing, changed, added}       [iv2-map]
//   mapSummary(map)                the fixed-size reference a loop record keeps instead of the whole map
//   createMockLogic()              the import loop's ops in memory for the Import agent mock (src/alerts of
//                                  examples/import-sample): a fixed logic map whose units follow the mock plan's moves
//
// Pure: no Node imports.

/** The kinds a logic unit can be (CONTRACT.md LogicUnit.kind). */
export const LOGIC_UNIT_KINDS = Object.freeze(['branch', 'render-if', 'state', 'effect', 'derived', 'data', 'navigation', 'url-read', 'handler', 'toast', 'analytics', 'storage', 'io', 'export']);

/** How each kind reads in a sentence. */
export const UNIT_WORDS = Object.freeze({
  branch: 'branch', 'render-if': 'conditional render', state: 'piece of state', effect: 'effect', derived: 'derived value', data: 'data call',
  navigation: 'navigation', 'url-read': 'URL read', handler: 'event handler', toast: 'toast', analytics: 'analytics call', storage: 'storage call', io: 'network call', export: 'export',
});

/**
 * A stable 16-hex hash of a text (two 32-bit FNV-1a passes with different seeds).
 * @param {string} text
 * @returns {string}
 */
export function stableHash(text) {
  const pass = (seed) => {
    let h = seed >>> 0;
    for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, '0');
  };
  const s = String(text);
  return `${pass(0x811c9dc5)}${pass(0x050c5d1f ^ s.length)}`;
}

/**
 * Whitespace collapsed, so formatting never changes a fingerprint.
 * @param {unknown} text
 * @returns {string}
 */
export function normalizeText(text) { return String(text ?? '').replace(/\s+/g, ' ').trim(); }

/**
 * LogicUnit.fingerprint: kind, enclosing function (through the rename table) and normalized text; `n` tells identical
 * occurrences in one function apart. Never the file path.
 * @param {string} kind
 * @param {string} fn
 * @param {string} text
 * @param {number} [n]
 * @returns {string}
 */
export function unitFingerprint(kind, fn, text, n = 1) {
  return stableHash(`${kind}\u0000${fn}\u0000${normalizeText(text)}\u0000${n}`);
}

/**
 * The fixed-size reference to a map that a loop record keeps: how many units, per kind, and a hash of the fingerprints.
 * @param {any} map A LogicMap.
 * @returns {{units: number, counts: Record<string, number>, hash: string}}
 */
export function mapSummary(map) {
  const units = Array.isArray(map?.units) ? map.units : [];
  const counts = {};
  for (const u of units) counts[u.kind] = (counts[u.kind] ?? 0) + 1;
  return { units: units.length, counts, hash: stableHash(units.map((u) => u.fingerprint).sort().join(',')) };
}

/**
 * The sentence for a unit that went missing.
 * @param {any} u A LogicUnit.
 * @returns {string}
 */
export function missingSentence(u) {
  const detail = normalizeText(u.detail).slice(0, 80);
  return `The ${UNIT_WORDS[u.kind] ?? u.kind} "${detail}" in ${u.fn} (${u.file}) is gone.`;
}

/**
 * MapDiff between two logic maps, matched by fingerprint (so a move is `moved`, not missing). A unit with no match whose
 * kind and function still have an unmatched unit on the other side is `changed` (same place, different logic); the rest
 * of the old units are `missing` and the rest of the new ones `added`. `renames` maps an old function name to its new one.
 * @param {any} before
 * @param {any} after
 * @param {Record<string, string>} [renames]
 * @returns {{kept: any[], moved: {from: any, to: any}[], missing: any[], changed: {before: any, after: any, sentence: string}[], added: any[]}}
 */
export function compareLogicMaps(before, after, renames = {}) {
  const left = [...(after?.units ?? [])];
  const byFp = new Map();
  left.forEach((u, i) => { if (!byFp.has(u.fingerprint)) byFp.set(u.fingerprint, []); byFp.get(u.fingerprint).push(i); });
  const used = new Set();
  const kept = []; const moved = []; const unmatched = [];
  for (const u of before?.units ?? []) {
    const fp = renames[u.fn] ? unitFingerprint(u.kind, renames[u.fn], u.text ?? u.detail, u.n ?? 1) : u.fingerprint;
    const idx = (byFp.get(fp) ?? []).find((i) => !used.has(i));
    if (idx === undefined) { unmatched.push(u); continue; }
    used.add(idx);
    if (left[idx].file === u.file) kept.push(u); else moved.push({ from: u, to: left[idx] });
  }
  const rest = left.filter((_, i) => !used.has(i));
  const changed = []; const missing = [];
  for (const u of unmatched) {
    const fn = renames[u.fn] ?? u.fn;
    const j = rest.findIndex((a) => a.kind === u.kind && a.fn === fn);
    if (j < 0) { missing.push(u); continue; }
    const [a] = rest.splice(j, 1);
    changed.push({ before: u, after: a, sentence: `The ${UNIT_WORDS[u.kind] ?? u.kind} "${normalizeText(u.detail).slice(0, 60)}" in ${u.fn} now reads "${normalizeText(a.detail).slice(0, 60)}".` });
  }
  return { kept, moved, missing, changed, added: rest };
}

// ------------------------------------------------------------------------------------------------- the mock's logic
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

/** Where a mock plan step moves a file of the folder: [from, to], or null. */
function mockMove(tool, args) {
  if (tool !== 'line.import.toLibrary' || typeof args?.from !== 'string') return null;
  const ext = args.from.slice(args.from.lastIndexOf('.'));
  return [args.from, `library/${args.kind}/${args.name}${ext}`];
}

/**
 * The import loop's ops in memory (importLoop.mjs LoopOps) for the Import agent mock: a fixed logic map of src/alerts
 * whose units move with each landed `line.import.toLibrary` step, three characterization tests that pass, and every unit
 * covered once it sits in a block. `dropOn(stepTool, args)` plants a lost unit, for tests.
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
      return { id: `${folder}/${file}#${fn}:${kind}:${counter[k]}`, fingerprint: unitFingerprint(kind, fn, detail, 1), kind, file: `${folder}/${moves[file] ?? file}`, fn, line: 1, detail };
    }).filter((u) => !dropped.has(u.fingerprint));
  };
  const tests = (folder) => [
    { file: `${folder}/components/AlertRow.test.tsx`, runner: 'jest', kind: 'interaction', title: 'AlertRow opens the alert on click', unitFingerprints: unitsAt(folder).filter((u) => u.fn === 'AlertRow' || u.fn === 'on:onClick').map((u) => u.fingerprint) },
    { file: `${folder}/components/Table.test.tsx`, runner: 'jest', kind: 'render', title: 'Table and SeverityBadge render every branch', unitFingerprints: unitsAt(folder).filter((u) => u.fn === 'Table' || u.fn === 'SeverityBadge').map((u) => u.fingerprint) },
    { file: `${folder}/pages/AlertsPage.test.tsx`, runner: 'jest', kind: 'render', title: 'The alert pages render the list, the filter and a missing alert', unitFingerprints: unitsAt(folder).filter((u) => /Page$/.test(u.fn)).map((u) => u.fingerprint) },
  ];
  return {
    standIn: 'mock',
    closure: async (_root, folder, route) => ({ appRoot: '/mock/import-sample', routes: route ? [{ route, entry: `${folder}/pages/AlertsPage.tsx` }] : [], files: [...new Set(MOCK_UNITS.map((u) => `${folder}/${u[0]}`))], external: [] }),
    buildMap: async (_root, folder) => { const units = unitsAt(folder); return { root: '/mock/import-sample', files: [...new Set(units.map((u) => u.file))], units, counts: mapSummary({ units }).counts }; },
    compare: async (before, after) => compareLogicMaps(before, after),
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
        if (victim) dropped.add(unitFingerprint(victim[2], victim[1], victim[3], 1));
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
