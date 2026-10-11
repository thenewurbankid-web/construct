// Train Line: for every intent of the catalog, its request wordings (paraphrases, slotted), the slot choices a world
// offers, and every valid route (slotted). The generator (generate.mjs) uses all three; the drafter mirror uses the
// wordings and routes. Nothing here names a project or domain word: names are slots (slots.mjs).
const NO_NEW = { noNewFindings: true };
const ROLES = ['status', 'summary', 'primary', 'compact', 'header'];
const TEXT_ROLES = ['all', 'open', 'recent', 'my'];
/**
 * Whether a wording fits a slot set's shape ('any' fits every shape).
 * @param {{shape: string}} wording @param {string} shape
 * @returns {boolean}
 */
export const fitsShape = (wording, shape) => wording.shape === 'any' || wording.shape === shape;
const MISSING_PARTS = ['tooltip', 'carousel', 'stepper', 'slider'];
const MISSING_FEATURES = ['archive', 'insights', 'settings'];

/** @param {string} id @param {string} label @param {any[]} steps @param {any[]} expect @param {object} [o] */
function route(id, label, steps, expect, o = {}) {
  return {
    id, label, steps, expect,
    scope: o.scope ?? { layers: [...new Set(steps.map((s) => s.layer).filter(Boolean))], features: o.features ?? [], library: Boolean(o.library) },
    cost: steps.length,
    risk: o.risk ?? (o.library ? 'medium' : 'low'),
    outcome: o.outcome ?? 'change',
    ...(o.refusal ? { refusal: o.refusal } : {}),
    ...(o.question ? { question: o.question } : {}),
  };
}
const strip = (steps) => steps.map(({ layer: _l, ...s }) => s);
const finish = (r) => ({ ...r, steps: strip(r.steps), scope: { ...r.scope, layers: r.scope.layers.length ? r.scope.layers : layersOf(r) } });
const layersOf = (r) => [...new Set(JSON.stringify(r.expect).match(/\/(components|pages|workflows|fixtures)\//g)?.map((m) => m.slice(1, -1)) ?? [])];
const baseOn = (L, F, N, layer) => ({ tool: 'line.baseOn', args: { libraryId: `<library:${L}>`, feature: `<feature:${F}>`, name: `<name:${N}>` }, layer });
const made = (F, kind, N, L) => [{ hasItem: `<feature:${F}>/${kind}/<name:${N}>` }, { basedOn: [`<feature:${F}>/${kind}/<name:${N}>`, `<library:${L}>`] }];

/** Refs of a world (refTable keys) grouped for choosing slots. */
function choicesOf(facts) {
  const features = facts.features.map((f, i) => ({ i, f }));
  const lib = (kind) => facts.library.filter((l) => l.kind === kind).map((l, j) => ({ ref: `library:${kind}#${j}`, l }));
  const items = (fi, kind) => facts.features[fi].items.filter((it) => it.kind === kind).map((it, j) => ({ ref: `item:feature#${fi}/${kind}#${j}`, it }));
  return { features, lib, items };
}

/**
 * Every intent: request wordings, the slot sets a world offers (each a separate case), and the valid routes.
 * `variants` says which world variants the intent is generated on.
 */
export const INTENT_DEFS = Object.freeze({
  'add.component': {
    variants: ['clean'],
    wordings: [
      { text: 'Make <name:N1> in <feature:F1>, based on <library:L1>.', shape: 'single' },
      { text: 'Add a <library:L1> called <name:N1> to <feature:F1>.', shape: 'single' },
      { text: 'Create <name:N1> for <feature:F1> using the library <library:L1>.', shape: 'single' },
      { text: '<feature:F1> needs a <name:N1> built from <library:L1>.', shape: 'single' },
      { text: 'Make <name:N1> for <feature:F1> from <library:L1>; other features will want it too.', shape: 'shared' },
      { text: 'Build a reusable <name:N1> on <library:L1>, starting in <feature:F1>.', shape: 'shared' },
    ],
    slotSets(facts) {
      const c = choicesOf(facts);
      const comps = c.lib('components');
      return c.features.slice(0, 2).flatMap(({ i }) => comps.slice(i, i + 2).map((L, k) => ({
        F1: { type: 'feature', ref: `feature#${i}` }, L1: { type: 'library', ref: L.ref, kind: 'components' }, N1: { type: 'name', role: ROLES[(i + k) % ROLES.length], of: 'L1' },
      })));
    },
    routes(shape) {
      const inside = route('inside', 'Inside <feature:F1> only', [baseOn('L1', 'F1', 'N1', 'components')], [...made('F1', 'components', 'N1', 'L1'), NO_NEW], { features: ['F1'] });
      if (shape !== 'shared') return { routes: [inside], preferred: 'inside' };
      const shared = route('via-library', 'Make it in <feature:F1>, then move it into the library for every feature', [baseOn('L1', 'F1', 'N1', 'components'), { tool: 'line.promote', args: { featureItemId: '<feature:F1>/components/<name:N1>' }, layer: 'components' }],
        [{ hasLibrary: 'components/<name:N1>' }, { not: { hasItem: '<feature:F1>/components/<name:N1>' } }, NO_NEW], { features: ['F1'], library: true });
      return { routes: [shared, { ...inside, label: 'Inside <feature:F1> only for now' }], preferred: 'via-library' };
    },
  },
  'add.page': {
    variants: ['clean'],
    wordings: [
      { text: 'Add a <name:N1> page to <feature:F1>, based on <library:L1>.', shape: 'single' },
      { text: '<feature:F1> needs a new page <name:N1> on top of <library:L1>.', shape: 'single' },
      { text: 'Create the page <name:N1> in <feature:F1> from the library <library:L1>.', shape: 'single' },
      { text: 'Add a <name:N1> page to <feature:F1> built on <library:L1>, showing a <library:L2>.', shape: 'with-part' },
      { text: '<feature:F1> needs a page <name:N1> from <library:L1> that shows a <library:L2>.', shape: 'with-part' },
    ],
    slotSets(facts) {
      const c = choicesOf(facts);
      const pages = c.lib('pages');
      const atoms = c.lib('components');
      return c.features.slice(0, 2).flatMap(({ i }) => pages.slice(0, 2).map((P, k) => ({
        F1: { type: 'feature', ref: `feature#${i}` }, L1: { type: 'library', ref: P.ref, kind: 'pages' }, N1: { type: 'name', role: ['overview', 'archive', 'search'][(i + k) % 3], of: 'L1' },
        L2: { type: 'library', ref: atoms[(i + k) % atoms.length].ref, kind: 'components' }, N2: { type: 'name', role: ['overview', 'archive', 'search'][(i + k) % 3], of: 'L2' },
      })));
    },
    routes(shape) {
      const pageOnly = route('page-only', 'A page in <feature:F1> only', [baseOn('L1', 'F1', 'N1', 'pages')], [...made('F1', 'pages', 'N1', 'L1'), NO_NEW], { features: ['F1'] });
      if (shape !== 'with-part') return { routes: [pageOnly], preferred: 'page-only' };
      const withPart = route('page-and-part', 'A page and its own <library:L2> in <feature:F1>', [baseOn('L1', 'F1', 'N1', 'pages'), baseOn('L2', 'F1', 'N2', 'components')],
        [...made('F1', 'pages', 'N1', 'L1'), ...made('F1', 'components', 'N2', 'L2'), NO_NEW], { features: ['F1'] });
      return { routes: [withPart, { ...pageOnly, label: 'A page only; it uses the library <library:L2> as it is' }], preferred: 'page-and-part' };
    },
  },
  'add.flow': {
    variants: ['clean'],
    wordings: [
      { text: 'Add a <name:N1> flow to <feature:F1>, based on <library:L1>.', shape: 'single' },
      { text: '<feature:F1> needs its own <library:L1> flow called <name:N1>.', shape: 'single' },
      { text: 'Start a <name:N1> flow in <feature:F1> from the library <library:L1>.', shape: 'single' },
    ],
    slotSets(facts) {
      const c = choicesOf(facts);
      return c.features.slice(0, 2).flatMap(({ i }) => c.lib('workflows').slice(0, 2).map((W, k) => ({
        F1: { type: 'feature', ref: `feature#${i}` }, L1: { type: 'library', ref: W.ref, kind: 'workflows' }, N1: { type: 'name', role: ['express', 'fast', 'quick'][(i + k) % 3], of: 'L1' },
      })));
    },
    routes: () => ({ routes: [route('inside', 'A flow inside <feature:F1> only', [baseOn('L1', 'F1', 'N1', 'workflows')], [...made('F1', 'workflows', 'N1', 'L1'), NO_NEW], { features: ['F1'] })], preferred: 'inside' }),
  },
  'add.sample-data': {
    variants: ['clean'],
    wordings: [
      { text: 'Add sample data <name:N1> to <feature:F1>, based on <library:L1>.', shape: 'single' },
      { text: '<feature:F1> needs test data <name:N1> shaped like <library:L1>.', shape: 'single' },
    ],
    slotSets(facts) {
      const c = choicesOf(facts);
      const fx = c.lib('fixtures')[0];
      return fx ? c.features.slice(0, 2).map(({ i }) => ({ F1: { type: 'feature', ref: `feature#${i}` }, L1: { type: 'library', ref: fx.ref, kind: 'fixtures' }, N1: { type: 'name', role: ['demo', 'empty'][i % 2], of: 'L1' } })) : [];
    },
    routes: () => ({ routes: [route('inside', 'Sample data inside <feature:F1> only', [baseOn('L1', 'F1', 'N1', 'fixtures')], [...made('F1', 'fixtures', 'N1', 'L1'), NO_NEW], { features: ['F1'] })], preferred: 'inside' }),
  },
  'share.item': {
    variants: ['clean'],
    wordings: [
      { text: '<feature:F2> should use <item:I1> from <feature:F1> too.', shape: 'single' },
      { text: 'Share <item:I1> of <feature:F1> with <feature:F2>.', shape: 'single' },
      { text: 'Let <feature:F2> show <item:I1>, which lives in <feature:F1>.', shape: 'single' },
    ],
    slotSets(facts) {
      const c = choicesOf(facts);
      return c.features.slice(0, 2).flatMap(({ i }) => c.items(i, 'components').slice(0, 1).map((I) => ({
        I1: { type: 'item', ref: I.ref, kind: 'components' }, F1: { type: 'feature', ref: `feature#${i}` }, F2: { type: 'feature', ref: `feature#${(i + 1) % facts.features.length}` },
        L1: { type: 'library', of: 'I1' }, N1: { type: 'name', of: 'I1' },
      })));
    },
    routes: () => ({
      routes: [
        route('via-library', 'Through the library: move <item:I1> there so every feature can use it', [{ tool: 'line.promote', args: { featureItemId: '<item:I1>' }, layer: 'components' }],
          [{ hasLibrary: 'components/<name:N1>' }, { not: { hasItem: '<item:I1>' } }, NO_NEW], { features: ['F1', 'F2'], library: true }),
        route('copy', '<feature:F2> gets its own copy, based on <library:L1>', [baseOn('L1', 'F2', 'N1', 'components')], [...made('F2', 'components', 'N1', 'L1'), NO_NEW], { features: ['F2'] }),
      ],
      preferred: 'via-library',
    }),
  },
  'move.item-to-library': {
    variants: ['clean'],
    wordings: [
      { text: 'Move <item:I1> from <feature:F1> into the library.', shape: 'single' },
      { text: '<item:I1> is useful everywhere; make it a library item.', shape: 'single' },
      { text: 'Promote <item:I1> of <feature:F1> to the library.', shape: 'single' },
    ],
    slotSets(facts) {
      const c = choicesOf(facts);
      return c.features.slice(1, 3).flatMap(({ i }) => c.items(i, 'components').slice(0, 1).map((I) => ({ I1: { type: 'item', ref: I.ref, kind: 'components' }, F1: { type: 'feature', ref: `feature#${i}` }, N1: { type: 'name', of: 'I1' } })));
    },
    routes: () => ({ routes: [route('promote', 'Move <item:I1> into the library', [{ tool: 'line.promote', args: { featureItemId: '<item:I1>' }, layer: 'components' }], [{ hasLibrary: 'components/<name:N1>' }, { not: { hasItem: '<item:I1>' } }, NO_NEW], { features: ['F1'], library: true })], preferred: 'promote' }),
  },
  'update.page-text': {
    variants: ['clean'],
    wordings: [
      { text: 'Change the title of <item:I1> to "<text:T1>".', shape: 'single' },
      { text: '<item:I1> should be titled "<text:T1>".', shape: 'single' },
      { text: 'Rename the heading on <item:I1> in <feature:F1> to "<text:T1>".', shape: 'single' },
    ],
    slotSets(facts, words) {
      const c = choicesOf(facts);
      return c.features.slice(0, 3).flatMap(({ i }) => c.items(i, 'pages').slice(0, 1).map((I) => ({
        I1: { type: 'item', ref: I.ref, kind: 'pages' }, F1: { type: 'feature', ref: `feature#${i}` }, T1: { type: 'text', of: 'F1', role: TEXT_ROLES[i % TEXT_ROLES.length] },
      })));
    },
    routes: () => ({ routes: [route('set-title', 'Set the title on <item:I1>', [{ tool: 'line.setPageProp', args: { file: '<file:I1>', nodeId: 'n0', prop: 'title', kind: 'string', value: '<text:T1>' }, layer: 'pages' }], [{ fileContains: ['<file:I1>', 'title="<text:T1>"'] }, NO_NEW], { features: ['F1'] })], preferred: 'set-title' }),
  },
  'update.variable': {
    variants: ['clean'],
    wordings: [
      { text: 'Show <number:V1> at a time on <item:I1>.', shape: 'single' },
      { text: 'Set the page size of <item:I1> to <number:V1>.', shape: 'single' },
      { text: '<item:I1> in <feature:F1> should list <number:V1> per page.', shape: 'single' },
    ],
    slotSets(facts) {
      const c = choicesOf(facts);
      return c.features.slice(0, 3).flatMap(({ i }) => c.items(i, 'pages').slice(0, 1).map((I) => ({ I1: { type: 'item', ref: I.ref, kind: 'pages' }, F1: { type: 'feature', ref: `feature#${i}` }, V1: { type: 'number', literal: [25, 50, 100][i % 3] } })));
    },
    routes: () => ({ routes: [route('set-size', 'Set the page size on <item:I1>', [{ tool: 'line.setPageProp', args: { file: '<file:I1>', nodeId: 'n0', prop: 'size', kind: 'number', value: '<number:V1>' }, layer: 'pages' }], [{ fileContains: ['<file:I1>', 'size={<number:V1>}'] }, NO_NEW], { features: ['F1'] })], preferred: 'set-size' }),
  },
  'update.feature-flow': {
    variants: ['clean'],
    wordings: [
      { text: 'When <item:I1> asks for more, log "<text:T1>" instead.', shape: 'single' },
      { text: 'Change what happens when <item:I1> in <feature:F1> asks for more: log "<text:T1>".', shape: 'single' },
      { text: 'On <item:I1>, the show-more action should log "<text:T1>".', shape: 'single' },
    ],
    slotSets(facts, words) {
      const c = choicesOf(facts);
      return c.features.slice(0, 3).flatMap(({ i }) => c.items(i, 'pages').slice(0, 1).filter((I) => (facts.fragments?.[I.it.file] ?? []).length).map((I) => ({
        I1: { type: 'item', ref: I.ref, kind: 'pages' }, F1: { type: 'feature', ref: `feature#${i}` }, G1: { type: 'fragment', of: 'I1', ref: 'fragment#0' },
        T1: { type: 'text', of: 'F1', role: 'more' }, C1: { type: 'code', of: 'T1' },
      })));
    },
    routes: () => ({ routes: [route('on-page', 'On <item:I1> only', [{ tool: 'line.setFragment', args: { file: '<file:I1>', fragmentId: '<fragment:G1>', code: '<code:C1>', contentHash: '<hash:I1>' }, layer: 'pages' }], [{ fileContains: ['<file:I1>', '<text:T1>'] }, NO_NEW], { features: ['F1'] })], preferred: 'on-page' }),
  },
  'fix.problem': {
    variants: ['cross-feature', 'missing-base'],
    wordings: [
      { text: 'Fix the problem in <finding:P1>.', shape: 'any' },
      { text: 'Clear the reported problem on <finding:P1>.', shape: 'any' },
      { text: '<feature:F2> uses <item:I1> from <feature:F1>, which is not allowed; fix it.', shape: 'cross-feature' },
      { text: '<item:I1> has no base; fix it.', shape: 'missing-base' },
      { text: '<item:I1> is not based on anything in the library; fix it.', shape: 'missing-base-one' },
    ],
    slotSets(facts) {
      const fi = (name) => facts.features.findIndex((f) => f.name === name);
      return facts.findings.flatMap((p, k) => {
        const P1 = { type: 'finding', ref: `finding#${k}` };
        if (p.rule === 'LINE-DIR') {
          const used = p.fixes[0]?.step?.args?.featureItemId;
          if (!used) return [];
          const owner = fi(String(used).split('/')[0]);
          const user = fi(p.file.split('/')[1]);
          const j = facts.features[owner].items.filter((it) => it.kind === 'components').findIndex((it) => it.id === used);
          return [{ shape: 'cross-feature', slots: { P1, X1: { type: 'fix', of: 'P1', rank: 1 }, I1: { type: 'item', ref: `item:feature#${owner}/components#${j}`, kind: 'components' }, F1: { type: 'feature', ref: `feature#${owner}` }, F2: { type: 'feature', ref: `feature#${user}` }, N1: { type: 'name', of: 'I1' } } }];
        }
        if (p.rule === 'LINE-BASE') {
          const f = fi(p.file.split('/')[1]);
          const j = facts.features[f].items.filter((it) => it.kind === 'components').findIndex((it) => it.file === p.file);
          const base = { P1, X1: { type: 'fix', of: 'P1', rank: 1 }, I1: { type: 'item', ref: `item:feature#${f}/components#${j}`, kind: 'components' }, F1: { type: 'feature', ref: `feature#${f}` } };
          const setBases = p.fixes.filter((x) => x.id.startsWith('LINE-BASE/set-base:') && x.step).length;
          const promote = p.fixes.some((x) => x.id === 'LINE-BASE/promote' && x.step);
          if (setBases >= 2 && promote) return [{ shape: 'missing-base', slots: { ...base, X2: { type: 'fix', of: 'P1', rank: 2 }, X3: { type: 'fix', of: 'P1', fixId: 'LINE-BASE/promote' } } }];
          return p.fixes[0]?.step ? [{ shape: 'missing-base-one', slots: base }] : [];
        }
        return [];
      });
    },
    routes(shape) {
      const fix = (X) => ({ tool: 'line.fix', args: { findingKey: '<finding:P1>', fixId: `<fix:${X}>` }, layer: 'components' });
      if (shape === 'cross-feature') {
        return {
          routes: [
            route('fix-1', 'Apply the recommended fix: <fix:X1>', [fix('X1')], [{ noFinding: { rule: 'LINE-DIR' } }, { hasLibrary: 'components/<name:N1>' }, NO_NEW], { features: ['F1', 'F2'], library: true }),
            route('promote', 'Move <item:I1> into the library directly', [{ tool: 'line.promote', args: { featureItemId: '<item:I1>' }, layer: 'components' }], [{ noFinding: { rule: 'LINE-DIR' } }, { hasLibrary: 'components/<name:N1>' }, NO_NEW], { features: ['F1', 'F2'], library: true }),
          ],
          preferred: 'fix-1',
        };
      }
      if (shape === 'missing-base-one') {
        return { routes: [route('fix-1', 'Apply the fix: <fix:X1>', [fix('X1')], [{ noFinding: { rule: 'LINE-BASE', file: '<file:I1>' } }, NO_NEW], { features: ['F1'] })], preferred: 'fix-1' };
      }
      return {
        routes: [
          route('fix-1', 'Apply the recommended fix: <fix:X1>', [fix('X1')], [{ noFinding: { rule: 'LINE-BASE' } }, NO_NEW], { features: ['F1'] }),
          route('fix-2', 'Apply the other fix: <fix:X2>', [fix('X2')], [{ noFinding: { rule: 'LINE-BASE' } }, NO_NEW], { features: ['F1'] }),
          route('fix-promote', 'Apply the fix that needs no base: <fix:X3>', [fix('X3')], [{ noFinding: { rule: 'LINE-BASE' } }, NO_NEW], { features: ['F1'], library: true }),
        ],
        preferred: 'fix-1',
      };
    },
  },
  'refuse.not-possible': {
    variants: ['clean'],
    wordings: [
      { text: 'Make <name:N1> in <feature:F1>, based on <missing:M1>.', shape: 'missing-library' },
      { text: 'Add a <missing:M1> called <name:N1> to <feature:F1>.', shape: 'missing-library' },
      { text: 'Make another <item:I1> in <feature:F1>, based on <library:L1>.', shape: 'name-taken' },
      { text: 'Make <name:N1> in <missing:M1>, based on <library:L1>.', shape: 'missing-feature' },
    ],
    slotSets(facts, words, shape) {
      const c = choicesOf(facts);
      const libNames = new Set(facts.library.map((l) => l.name.toLowerCase()));
      const featNames = new Set(facts.features.map((f) => f.name));
      return c.features.slice(0, 2).flatMap(({ i }) => {
        if (shape === 'missing-library') {
          const role = MISSING_PARTS.find((m, k) => k >= i % MISSING_PARTS.length && !libNames.has(m)) ?? MISSING_PARTS.find((m) => !libNames.has(m));
          return [{ F1: { type: 'feature', ref: `feature#${i}` }, M1: { type: 'missing', kind: 'components', role }, N1: { type: 'name', role: 'status', of: 'M1' } }];
        }
        if (shape === 'name-taken') {
          const I = c.items(i, 'components')[0];
          return I ? [{ F1: { type: 'feature', ref: `feature#${i}` }, I1: { type: 'item', ref: I.ref, kind: 'components' }, L1: { type: 'library', of: 'I1' }, N1: { type: 'name', of: 'I1' } }] : [];
        }
        const role = MISSING_FEATURES.find((m) => !featNames.has(m));
        const comps = c.lib('components');
        return [{ M1: { type: 'missing', kind: 'feature', role }, L1: { type: 'library', ref: comps[i % comps.length].ref, kind: 'components' }, N1: { type: 'name', role: 'status', of: 'L1' } }];
      });
    },
    routes(shape) {
      if (shape === 'missing-library') {
        return { routes: [route('refuse', 'Refuse: the library has no <missing:M1>', [{ tool: 'line.baseOn', args: { libraryId: '<missing:M1>', feature: '<feature:F1>', name: '<name:N1>' } }], [{ refused: { code: 'UNKNOWN_ITEM' } }], { outcome: 'refusal', refusal: { code: 'UNKNOWN_ITEM' }, features: ['F1'] })], preferred: 'refuse' };
      }
      if (shape === 'name-taken') {
        return { routes: [route('refuse', 'Refuse: <feature:F1> already has <item:I1>', [{ tool: 'line.baseOn', args: { libraryId: '<library:L1>', feature: '<feature:F1>', name: '<name:N1>' } }], [{ refused: { code: 'NAME_TAKEN' } }], { outcome: 'refusal', refusal: { code: 'NAME_TAKEN' }, features: ['F1'] })], preferred: 'refuse' };
      }
      return { routes: [route('refuse', 'Refuse: there is no feature <missing:M1>', [{ tool: 'line.baseOn', args: { libraryId: '<library:L1>', feature: '<missing:M1>', name: '<name:N1>' } }], [{ refused: { code: 'UNKNOWN_FEATURE' } }], { outcome: 'refusal', refusal: { code: 'UNKNOWN_FEATURE' } })], preferred: 'refuse' };
    },
  },
  'ask.missing-detail': {
    variants: ['clean'],
    wordings: [
      { text: 'Add a <library:L1> to <feature:F1>.', shape: 'no-name' },
      { text: '<feature:F1> needs a <library:L1>.', shape: 'no-name' },
      { text: 'Make something new for <feature:F1>.', shape: 'no-library' },
      { text: 'Add a part to <feature:F1>.', shape: 'no-library' },
    ],
    slotSets(facts, words, shape) {
      const c = choicesOf(facts);
      const comps = c.lib('components');
      return c.features.slice(0, 2).map(({ i }) => (shape === 'no-name'
        ? { F1: { type: 'feature', ref: `feature#${i}` }, L1: { type: 'library', ref: comps[i % comps.length].ref, kind: 'components' } }
        : { F1: { type: 'feature', ref: `feature#${i}` } }));
    },
    routes(shape) {
      if (shape === 'no-name') {
        return { routes: [route('ask', 'Ask what to call it', [], [], { outcome: 'question', features: ['F1'], question: { about: 'name', sentence: 'What should the new <library:L1> in <feature:F1> be called?', tool: 'line.baseOn', args: { libraryId: '<library:L1>', feature: '<feature:F1>' } } })], preferred: 'ask' };
      }
      return { routes: [route('ask', 'Ask which library item to start from', [], [], { outcome: 'question', features: ['F1'], question: { about: 'library', sentence: 'Which library item should the new part of <feature:F1> be based on?', tool: 'line.baseOn', args: { feature: '<feature:F1>' } } })], preferred: 'ask' };
    },
  },
});

/**
 * The gold of one intent and wording shape, with the plan-only `layer` hints removed.
 * @param {string} intent @param {string} shape
 * @returns {{routes: any[], preferred: string}}
 */
export function goldFor(intent, shape) {
  const g = INTENT_DEFS[intent].routes(shape);
  return { routes: g.routes.map(finish), preferred: g.preferred };
}
