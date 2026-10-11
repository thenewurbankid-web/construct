// Line Import mock (contract.mjs ImportScan / ImportPlan / ImportApplyResult): an in-memory stand-in for import.mjs over
// examples/import-sample's folder src/alerts, so the Import screen (ui/client/features/line-import, ?line=mock) and the
// contract test run with no server and no disk. Same rules as the real engine: one question (Table, where two rules
// disagree), plan steps change with the answer, and apply refuses a folder outside the project in one sentence.
import { LineOpError } from './contract.mjs';

const FOLDER = 'src/alerts';
const ROOT = '/mock/import-sample';
const TABLE_Q = `generic-name:${FOLDER}/components/Table.tsx`;

const found = (file, kind, name, proposal, rules, usedBy, confidence = 'sure') => ({ file: `${FOLDER}/${file}`, kind, name, proposal, confidence, rules, usedBy });

function scanOf(answers = {}) {
  const tableFeature = answers[TABLE_Q] === 'feature:alerts';
  return {
    sourceRoot: ROOT,
    folder: FOLDER,
    found: [
      found('fixtures/alerts.json', 'fixtures', 'alerts', { target: 'library', sentence: 'alerts goes to the library, because 2 pages use it.' }, ['used-by-pages'], [`${FOLDER}/hooks/useAlerts.ts`]),
      found('components/AlertRow.tsx', 'components', 'AlertRow', { target: 'feature', feature: 'alerts', base: 'components/AlertRow', sentence: 'AlertRow goes to feature alerts; its full code goes to the library and the feature gets a component based on it.' }, ['one-page'], [`${FOLDER}/pages/AlertsPage.tsx`]),
      found('components/SeverityBadge.tsx', 'components', 'SeverityBadge', { target: 'library', level: 'atom', sentence: 'SeverityBadge goes to the library as an atom, because 2 pages use it.' }, ['used-by-pages'], [`${FOLDER}/components/AlertRow.tsx`, `${FOLDER}/pages/AlertDetailPage.tsx`, `${FOLDER}/pages/AlertsPage.tsx`]),
      tableFeature
        ? found('components/Table.tsx', 'components', 'Table', { target: 'feature', feature: 'alerts', base: 'components/Table', sentence: 'Table goes to feature alerts; its full code goes to the library and the feature gets a component based on it.' }, ['generic-name', 'answer'], [`${FOLDER}/pages/AlertsPage.tsx`], 'ask')
        : found('components/Table.tsx', 'components', 'Table', { target: 'library', level: 'atom', sentence: `Table goes to the library as an atom${answers[TABLE_Q] ? ', as you chose' : ' unless you choose otherwise'}.` }, ['generic-name', 'answer'], [`${FOLDER}/pages/AlertsPage.tsx`], 'ask'),
      found('pages/AlertDetailPage.tsx', 'pages', 'AlertDetailPage', { target: 'feature', feature: 'alerts', base: 'pages/AlertDetailPage', route: '/alerts/:id', sentence: 'AlertDetailPage goes to feature alerts, served at /alerts/:id; its full code goes to the library and the feature gets a page based on it.' }, ['kind-page', 'folder'], ['src/App.tsx']),
      found('pages/AlertsPage.tsx', 'pages', 'AlertsPage', { target: 'feature', feature: 'alerts', base: 'pages/AlertsPage', route: '/alerts', sentence: 'AlertsPage goes to feature alerts, served at /alerts; its full code goes to the library and the feature gets a page based on it.' }, ['kind-page', 'folder'], ['src/App.tsx']),
    ],
    questions: [{
      id: TABLE_Q, file: `${FOLDER}/components/Table.tsx`,
      sentence: 'Table sounds like general UI, so it could go to the library, but only one page uses it; where should it go?',
      options: [{ id: 'library', sentence: 'Put Table in the library, so every feature can use it.' }, { id: 'feature:alerts', sentence: 'Keep Table in feature alerts, where it is used.' }],
      recommended: 'library',
    }],
    unchanged: [
      { file: `${FOLDER}/hooks/useAlerts.ts`, sentence: 'useAlerts.ts is a React hook, and a Line workflow holds plain logic without React, so it stays where it is for now.' },
      { file: `${FOLDER}/types.ts`, sentence: 'types.ts holds only types or constants, so it stays where it is.' },
    ],
    routes: [`/alerts -> ${FOLDER}/pages/AlertsPage.tsx`, `/alerts/:id -> ${FOLDER}/pages/AlertDetailPage.tsx`],
  };
}

function check(folder) {
  if (folder !== FOLDER) throw new LineOpError(`The project has no folder "${folder}"; pick one of its folders.`, 'BAD_FOLDER');
}

function planOf(answers = {}) {
  const tableFeature = answers[TABLE_Q] === 'feature:alerts';
  const steps = [];
  const add = (tool, args, sentence, slug) => steps.push({ id: `import-${steps.length + 1}-${slug}`, tool, args: { folder: FOLDER, ...args }, sentence });
  add('line.import.mark', { features: ['alerts'] }, `Marks ${FOLDER} as a Line folder, with a library and the feature alerts.`, 'mark');
  add('line.import.toLibrary', { from: 'fixtures/alerts.json', kind: 'fixtures', name: 'alerts', keepShim: false }, 'Moves alerts into the library and points its users at it.', 'lib-alerts');
  add('line.import.toLibrary', { from: 'components/AlertRow.tsx', kind: 'components', name: 'AlertRow', keepShim: false }, 'Moves AlertRow into the library and points its users at it.', 'lib-AlertRow');
  add('line.import.toLibrary', { from: 'components/SeverityBadge.tsx', kind: 'components', name: 'SeverityBadge', level: 'atom', keepShim: false }, 'Moves SeverityBadge into the library as an atom and points its users at it.', 'lib-SeverityBadge');
  add('line.import.toLibrary', { from: 'components/Table.tsx', kind: 'components', name: 'Table', ...(tableFeature ? {} : { level: 'atom' }), keepShim: false }, `Moves Table into the library${tableFeature ? '' : ' as an atom'} and points its users at it.`, 'lib-Table');
  add('line.import.toLibrary', { from: 'pages/AlertDetailPage.tsx', kind: 'pages', name: 'AlertDetailPage', keepShim: true }, 'Moves AlertDetailPage into the library and points its users at it. Its old file stays as a one-line link, because App.tsx outside the folder uses it.', 'lib-AlertDetailPage');
  add('line.import.toLibrary', { from: 'pages/AlertsPage.tsx', kind: 'pages', name: 'AlertsPage', keepShim: true }, 'Moves AlertsPage into the library and points its users at it. Its old file stays as a one-line link, because App.tsx outside the folder uses it.', 'lib-AlertsPage');
  add('line.import.toFeature', { mode: 'wrap', kind: 'components', name: 'AlertRow', feature: 'alerts', base: 'components/AlertRow' }, 'Adds AlertRow to feature alerts, based on the library AlertRow.', 'feature-AlertRow');
  if (tableFeature) add('line.import.toFeature', { mode: 'wrap', kind: 'components', name: 'Table', feature: 'alerts', base: 'components/Table' }, 'Adds Table to feature alerts, based on the library Table.', 'feature-Table');
  add('line.import.toFeature', { mode: 'wrap', kind: 'pages', name: 'AlertDetailPage', feature: 'alerts', base: 'pages/AlertDetailPage', route: '/alerts/:id' }, 'Adds AlertDetailPage to feature alerts, based on the library AlertDetailPage, serving /alerts/:id.', 'feature-AlertDetailPage');
  add('line.import.toFeature', { mode: 'wrap', kind: 'pages', name: 'AlertsPage', feature: 'alerts', base: 'pages/AlertsPage', route: '/alerts' }, 'Adds AlertsPage to feature alerts, based on the library AlertsPage, serving /alerts.', 'feature-AlertsPage');
  const lib = tableFeature ? 2 : 3;
  return { folder: FOLDER, summary: `Brings 6 items of ${FOLDER} into Line in ${steps.length} steps: ${lib} to the library and ${6 - lib} to feature alerts; nothing outside ${FOLDER} changes.`, steps };
}

/** A fresh mock of the import API (each instance remembers whether it applied). */
export function createMockImport() {
  let applied = false;
  return {
    folders: () => ({ sourceRoot: ROOT, folders: [{ path: 'src', files: 12 }, { path: FOLDER, files: 9 }, { path: 'src/ui', files: 1 }] }),
    scan: ({ folder } = /** @type {any} */ ({})) => { check(folder); return scanOf({}); },
    plan: ({ folder, answers = {} } = /** @type {any} */ ({})) => { check(folder); return planOf(answers); },
    apply: ({ folder, answers = {} } = /** @type {any} */ ({})) => {
      check(folder);
      const plan = planOf(answers);
      if (applied) return { ok: false, sentence: `Stopped at "${plan.steps[0].sentence.replace(/\.$/, '')}": ${FOLDER} is already marked as a Line folder.`, files: [], findings: [], steps: [{ id: plan.steps[0].id, ok: false, sentence: `Not done: ${FOLDER} is already marked as a Line folder.` }] };
      applied = true;
      return { ok: true, sentence: `Saved. ${plan.summary}`, files: [`${FOLDER}/architecture.yml`, `${FOLDER}/library/pages/AlertsPage.tsx`, `${FOLDER}/features/alerts/pages/AlertsPage.tsx`], findings: [], steps: plan.steps.map((s) => ({ id: s.id, ok: true, sentence: s.sentence })) };
    },
  };
}
