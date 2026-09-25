// #627 (part of epic #616) -- the `dashboard` shape: a titled overview screen that COMPOSES components into a row of tiles and a few panels, all
// fed by props from ONE typed summary. Its unit names, its `types.ts` declarations and the typed template of every file (domain, service, hook,
// component, page + expression, controller). Registered in shapes.mjs, which owns the request, the checks and the writing. Every unit is built with
// the factory of its layer and named `Name.layer.ext` (READ-004).
//
//   construct create layer OrdersDashboard --feature orders-dashboard --layers domain,service,hook,component,page,controller \
//     --shape dashboard --entity Order --fields id:string,name:string,total:number
//
// The summary is what the service answers: `count` (how many rows), for each number field its `sum`, `average` and `max`, and for each yes or no
// field how many are yes. A pure domain unit turns it into tiles (the count, then one per number and yes or no field, at most MAX_TILES) and panels
// (one per number field, at most MAX_PANELS, listing sum, average and highest); the hook holds loading, ready and error in tracked state; the page
// composes the tile row and the panels from props, and imports no service. Nothing is charted, stored or routed between panels.
import { cap, importLine, labelOf, lines, lowerFirst, operationComment, rowText, sampleRows, ts, words } from './shape-kit.mjs';

/** Most tiles a dashboard shows: the count and up to three more (one per number field, then one per yes or no field). */
export const MAX_TILES = 4;

/** Most panels a dashboard shows: one per number field, in field order. */
export const MAX_PANELS = 3;

/** The words a dashboard unit name may end with, which are not part of its entity name (`OrdersDashboard` is about `Order`). */
export const DASHBOARD_WORDS = Object.freeze(['dashboard', 'overview', 'summary', 'report', 'statistics', 'stats']);

/**
 * The identifiers of a dashboard shape, from its unit name and its entity: `OrdersDashboard` and `Order` give `useOrdersDashboard`,
 * `fetchOrdersDashboard`, `OrdersDashboardPage`, `OrdersDashboardState` and `OrderSummary`.
 *
 * @param {string} Name The PascalCase unit name of the screen (`OrdersDashboard`).
 * @param {string} Entity The PascalCase entity it summarises (`Order`).
 * @returns {Record<string, string>} Every generated identifier, by role.
 *
 * @example
 * dashboardNames('OrdersDashboard', 'Order').summary; // => 'OrderSummary'
 */
export function dashboardNames(Name, Entity) {
  return {
    Name, Entity,
    summary: `${Entity}Summary`, tileItem: `${Name}TileItem`, lineItem: `${Name}LineItem`, panelItem: `${Name}PanelItem`, view: `${Name}View`,
    state: `${Name}State`, result: `${Name}Result`,
    fetch: `fetch${Name}`, describe: `describe${Name}`, hook: `use${Name}`,
    page: `${Name}Page`, pageProps: `${Name}PageProps`, controller: `${Name}Controller`,
    expression: `${Name}ByStatus`, expressionProps: `${Name}ByStatusProps`,
    tileRow: `${Name}TileRow`, tileRowProps: `${Name}TileRowProps`, panelList: `${Name}PanelList`, panelListProps: `${Name}PanelListProps`,
    tile: `${Name}Tile`, tileProps: `${Name}TileProps`, tiles: `${Name}Tiles`, tilesProps: `${Name}TilesProps`,
    panel: `${Name}Panel`, panelProps: `${Name}PanelProps`, line: `${Name}Line`, lineProps: `${Name}LineProps`,
    notice: `${Name}Notice`, noticeProps: `${Name}NoticeProps`,
  };
}

/**
 * What a dashboard measures in the fields of its entity: the number fields (summed, averaged, maxed) and the yes or no fields (counted), never
 * the `id`. The tiles and panels of the screen are worked out from these, at generation time, so every one is a fixed line of the template.
 *
 * @param {{ name: string, type: string }[]} fields The parsed `--fields`.
 * @returns {{ numbers: { name: string, type: string }[], flags: { name: string, type: string }[] }} The number fields and the yes or no fields, in field order.
 *
 * @example
 * measuresOf([{ name: 'id', type: 'string' }, { name: 'total', type: 'number' }, { name: 'paid', type: 'boolean' }]).numbers[0].name; // => 'total'
 */
export function measuresOf(fields) {
  const rest = fields.filter((f) => f.name !== 'id');
  return { numbers: rest.filter((f) => f.type === 'number'), flags: rest.filter((f) => f.type === 'boolean') };
}

/**
 * The tiles and panels a dashboard shows for its fields, as data (`key`, `label`/`title` and where the value comes from): the count tile first,
 * then a tile for each number field (its sum) and each yes or no field (how many), at most MAX_TILES; a panel per number field, at most MAX_PANELS.
 * The template writes them into the domain unit, and the proof uses the same list to check every one is shown.
 *
 * @param {object} ctx The shape context (`names`, `fields`).
 * @returns {{ tiles: { key: string, label: string, from: string }[], panels: { key: string, title: string, field: string }[] }} The tiles and panels.
 *
 * @example
 * layoutOf(ctx).tiles.map((t) => t.label); // => ['Orders', 'Sum of total']
 */
export function layoutOf(ctx) {
  const { numbers, flags } = measuresOf(ctx.fields);
  const count = { key: 'count', label: cap(ctx.entityPlural), from: 'count' };
  const rest = [
    ...numbers.map((f) => ({ key: f.name, label: `Sum of ${labelOf(f.name).toLowerCase()}`, from: `${f.name}.sum` })),
    ...flags.map((f) => ({ key: f.name, label: labelOf(f.name), from: f.name })),
  ];
  return { tiles: [count, ...rest].slice(0, MAX_TILES), panels: numbers.slice(0, MAX_PANELS).map((f) => ({ key: f.name, title: labelOf(f.name), field: f.name })) };
}

/**
 * The declarations the dashboard shape adds to the feature's `types.ts`: the entity, its summary, a tile, a line, a panel, the view of the
 * screen (tiles and panels), the state of the screen and the answer of the service. `shapes.mjs` appends the ones the file does not declare yet.
 *
 * @param {object} ctx The shape context (`names`, `fields`, `singular`, `entityPlural`).
 * @returns {{ declares: string, text: string }[]} Each declaration and the name it declares.
 *
 * @example
 * dashboardTypes(ctx).map((b) => b.declares); // => ['Order', 'OrderSummary', 'OrdersDashboardTileItem', 'OrdersDashboardLineItem', 'OrdersDashboardPanelItem', 'OrdersDashboardView', 'OrdersDashboardState', 'OrdersDashboardResult']
 */
export function dashboardTypes(ctx) {
  const { names, fields, singular, entityPlural, plural } = ctx;
  const { numbers, flags } = measuresOf(fields);
  return [
    { declares: names.Entity, text: lines(`/** One ${singular}: what the ${entityPlural} are summed up from (the local store holds these). */`, `export interface ${names.Entity} {`, fields.map((f) => `  ${f.name}: ${ts(f)};`), '}') },
    {
      declares: names.summary,
      text: lines(
        `/** The summary of the ${entityPlural}: how many there are, the sum, average and highest of each number field, and how many are yes for each yes or no field. */`,
        `export interface ${names.summary} {`, '  count: number;', numbers.map((f) => `  ${f.name}: { sum: number; average: number; max: number };`), flags.map((f) => `  ${f.name}: number;`), '}',
      ),
    },
    { declares: names.tileItem, text: lines(`/** One tile of the ${plural} screen: a headline number with its label. */`, `export interface ${names.tileItem} {`, '  key: string;', '  label: string;', '  value: string;', '}') },
    { declares: names.lineItem, text: lines(`/** One line of a panel: a label and its value. */`, `export interface ${names.lineItem} {`, '  label: string;', '  value: string;', '}') },
    { declares: names.panelItem, text: lines(`/** One panel of the ${plural} screen: a title and its lines. */`, `export interface ${names.panelItem} {`, '  key: string;', '  title: string;', `  lines: ${names.lineItem}[];`, '}') },
    { declares: names.view, text: lines(`/** What the ${plural} screen shows of a summary: its tiles and its panels. */`, `export interface ${names.view} {`, `  tiles: ${names.tileItem}[];`, `  panels: ${names.panelItem}[];`, '}') },
    { declares: names.state, text: lines(`/** What the ${plural} screen is doing: loading, showing the summary (with its tiles and panels) or failed. */`, `export type ${names.state} =`, `  | { status: 'loading' }`, `  | { status: 'ready'; summary: ${names.summary}; tiles: ${names.tileItem}[]; panels: ${names.panelItem}[] }`, `  | { status: 'error'; message: string };`) },
    { declares: names.result, text: lines(`/** What the ${plural} service answers: the summary, or an error with its message. */`, `export type ${names.result} =`, `  | { status: 'ready'; summary: ${names.summary} }`, `  | { status: 'error'; message: string };`) },
  ];
}

const round = 'const show = (value: number): string => String(Math.round(value * 100) / 100);';

/** @returns {string} `domain/<Name>.domain.ts`: the tiles and the panels of a summary, as text. */
function domainFile(ctx) {
  const { names, plural } = ctx;
  const layout = layoutOf(ctx);
  const flagNames = new Set(measuresOf(ctx.fields).flags.map((f) => f.name));
  // A count and a yes or no count are whole numbers (`String`); a sum, average or highest shows to two decimals (`show`).
  const valueOf = (t) => (t.key === 'count' || flagNames.has(t.key) ? `String(summary.${t.from})` : `show(summary.${t.from})`);
  const tile = (t) => `    { key: '${t.key}', label: '${t.label}', value: ${valueOf(t)} },`;
  const panel = (p) => [
    '    {', `      key: '${p.key}', title: '${p.title}',`,
    '      lines: [', `        { label: 'Sum', value: show(summary.${p.field}.sum) },`, `        { label: 'Average', value: show(summary.${p.field}.average) },`, `        { label: 'Highest', value: show(summary.${p.field}.max) },`, '      ],',
    '    },',
  ];
  return lines(
    importLine('defineDomain'), `import type { ${names.panelItem}, ${names.summary}, ${names.tileItem}, ${names.view} } from '../types';`, '',
    `/** The tiles and panels of the ${plural} screen from its summary: a tile for the count and for each number and yes or no field (at most ${MAX_TILES}), and a panel of sum, average and highest for each number field (at most ${MAX_PANELS}). Numbers show to two decimals. Pure. */`,
    `export const ${names.describe} = defineDomain<{ summary: ${names.summary} }, ${names.view}>('${names.describe}', ({ summary }) => {`,
    `  ${round}`,
    `  const tiles: ${names.tileItem}[] = [`, layout.tiles.map(tile), '  ];',
    `  const panels: ${names.panelItem}[] = [`, layout.panels.flatMap(panel), '  ];',
    '  return { tiles, panels };', '});',
  );
}

/** @returns {string} `services/<Name>.service.ts`: fetch the summary; a bad status, a wrong shape and a failed request are error results. */
function serviceFile(ctx) {
  const { names, fields, endpoint, plural } = ctx;
  const { numbers, flags } = measuresOf(fields);
  const checks = ['typeof body.count === \'number\'', ...numbers.map((f) => `stats(body.${f.name})`), ...flags.map((f) => `typeof body.${f.name} === 'number'`)].join(' && ');
  return lines(
    importLine('defineService'), `import type { ${names.summary}, ${names.result} } from '../types';`, operationComment(ctx.operation), '',
    ...(numbers.length ? [
      `function stats(value: unknown): boolean {`,
      `  if (typeof value !== 'object' || value === null) return false;`,
      `  const part = value as Record<string, unknown>;`,
      `  return typeof part.sum === 'number' && typeof part.average === 'number' && typeof part.max === 'number';`, '}', '',
    ] : []),
    `function is${names.summary}(value: unknown): value is ${names.summary} {`,
    `  if (typeof value !== 'object' || value === null) return false;`,
    `  const body = value as Record<string, unknown>;`,
    `  return ${checks};`, '}', '',
    `/** Fetches the ${plural} summary. Forwards the caller's AbortSignal and answers with a typed result: a failed request, a bad status or a wrong shape is an error result, never a throw. */`,
    `export const ${names.fetch} = defineService('${names.fetch}', async ({ signal }: { signal: AbortSignal }): Promise<${names.result}> => {`,
    '  try {',
    `    const response = await fetch('${endpoint}', { signal });`,
    `    if (!response.ok) return { status: 'error', message: \`The server answered \${response.status}.\` };`,
    '    const body: unknown = await response.json();',
    `    if (!is${names.summary}(body)) return { status: 'error', message: 'The server did not answer with a ${ctx.singular} summary.' };`,
    `    return { status: 'ready', summary: body };`,
    '  } catch (error) {',
    `    return { status: 'error', message: error instanceof Error ? error.message : 'The request failed.' };`,
    '  }', '});',
  );
}

/** @returns {string} `domain/<Name>Store.domain.ts` (the `local` source): the seed rows and the pure summary of a set of rows, as the result the service answers. */
function storeFile(ctx) {
  const { names, store, entityPlural, fields } = ctx;
  const { numbers, flags } = measuresOf(fields);
  const parts = [
    'count,',
    ...numbers.map((f) => `${f.name}: { sum: ${f.name}Sum, average: count === 0 ? 0 : ${f.name}Sum / count, max: count === 0 ? 0 : Math.max(...${f.name}Values) },`),
    ...flags.map((f) => `${f.name}: rows.filter((row) => row.${f.name}).length,`),
  ];
  return lines(
    importLine('defineDomain'), `import type { ${names.Entity}, ${names.result} } from '../types';`, '',
    `/** The seed rows of the local ${ctx.singular} store: what the dashboard sums up until it reads from a real source. Pure. */`,
    `export const ${store.seed} = defineDomain<Record<string, never>, ${names.Entity}[]>('${store.seed}', () => [`,
    sampleRows(names.Entity, fields).map((row) => `  ${rowText(row)},`), ']);', '',
    `/** Sums up a set of ${entityPlural} rows as the result the ${ctx.plural} service answers: how many, and the sum, average and highest of each number field. Pure. */`,
    `export const ${store.op} = defineDomain<{ rows: readonly ${names.Entity}[] }, ${names.result}>('${store.op}', ({ rows }) => {`,
    '  const count = rows.length;',
    numbers.flatMap((f) => [`  const ${f.name}Values = rows.map((row) => row.${f.name});`, `  const ${f.name}Sum = ${f.name}Values.reduce((sum, value) => sum + value, 0);`]),
    `  return { status: 'ready', summary: {`, parts.map((p) => `    ${p}`), '  } };', '});',
  );
}

/** @returns {string} `services/<Name>.service.ts` (the `local` source): the same typed result as the network service, summed from the store in memory. */
function localServiceFile(ctx) {
  const { names, store, plural } = ctx;
  return lines(
    importLine('defineService'), `import { ${store.op}, ${store.seed} } from '../domain/${store.file}.domain';`, `import type { ${names.Entity}, ${names.result} } from '../types';`, '',
    `/** The rows of the local ${ctx.singular} store: the seed rows, held in memory. It is this screen's whole backend until a real source replaces it. */`,
    `const rows: ${names.Entity}[] = ${store.seed}({});`, '',
    `/** Sums up the ${plural} of the local store and answers with the same typed result as a network source. Takes the caller's AbortSignal like one: a cancelled request is an error result, never a throw. */`,
    `export const ${names.fetch} = defineService('${names.fetch}', async ({ signal }: { signal: AbortSignal }): Promise<${names.result}> => {`,
    `  if (signal.aborted) return { status: 'error', message: 'The request was cancelled.' };`,
    `  return ${store.op}({ rows });`, '});',
  );
}

/** @returns {string} `hooks/use<Name>.state.ts`: the summary request and the status union in tracked state, with the tiles and panels worked out. */
function hookFile(ctx) {
  const { names, plural } = ctx;
  return lines(
    ctx.useClient ? ["'use client';", ''] : [],
    `import { useEffect } from 'react';`, importLine('useTrackedState'),
    `import { ${names.describe} } from '../domain/${names.Name}.domain';`, `import { ${names.fetch} } from '../services/${names.Name}.service';`, `import type { ${names.state} } from '../types';`, '',
    `/** Loads the ${plural} summary once, and holds what the screen shows: loading, the summary with its tiles and panels, or an error. The request is aborted when the screen goes away. */`,
    `export function ${names.hook}(): ${names.state} {`,
    `  const [state, setState] = useTrackedState<${names.state}>('${lowerFirst(names.Name)}', { status: 'loading' });`,
    '  useEffect(() => {', '    const controller = new AbortController();',
    `    ${names.fetch}({ signal: controller.signal }).then((result) => {`,
    '      if (controller.signal.aborted) return;',
    `      setState(result.status === 'ready' ? { status: 'ready', summary: result.summary, ...${names.describe}({ summary: result.summary }) } : result);`,
    '    });', '    return () => controller.abort();', '  }, [setState]);', '  return state;', '}',
  );
}

/** @returns {string} `components/<Name>Tile.component.tsx`: one headline number with its label. */
function tileFile(ctx) {
  const { names } = ctx;
  return lines(
    importLine('defineComponent'), '',
    `export interface ${names.tileProps} {`, '  label: string;', '  value: string;', '}', '',
    `/** One tile of the ${ctx.plural} screen: a label and its number. */`,
    `export const ${names.tile} = defineComponent<${names.tileProps}>('${names.tile}', ({ label, value }) => (`,
    '  <li>', '    <span>{label}</span>', '    <strong>{value}</strong>', '  </li>', '));',
  );
}

/** @returns {string} `components/<Name>Tiles.component.tsx`: the row the tiles sit in. */
function tilesFile(ctx) {
  const { names, heading } = ctx;
  return lines(
    `import type { ReactNode } from 'react';`, importLine('defineComponent'), '',
    `export interface ${names.tilesProps} {`, '  children?: ReactNode;', '}', '',
    `/** The row of tiles at the top of the ${ctx.plural} screen. */`,
    `export const ${names.tiles} = defineComponent<${names.tilesProps}>('${names.tiles}', ({ children }) => <ul aria-label="${heading} totals">{children}</ul>);`,
  );
}

/** @returns {string} `components/<Name>Panel.component.tsx`: a titled section that holds lines. */
function panelFile(ctx) {
  const { names } = ctx;
  return lines(
    `import type { ReactNode } from 'react';`, importLine('defineComponent'), '',
    `export interface ${names.panelProps} {`, '  title: string;', '  children?: ReactNode;', '}', '',
    `/** One panel of the ${ctx.plural} screen: a title and the lines it is given. */`,
    `export const ${names.panel} = defineComponent<${names.panelProps}>('${names.panel}', ({ title, children }) => (`,
    '  <section aria-label={title}>', '    <h2>{title}</h2>', '    <dl>{children}</dl>', '  </section>', '));',
  );
}

/** @returns {string} `components/<Name>Line.component.tsx`: one label and value of a panel. */
function lineFile(ctx) {
  const { names } = ctx;
  return lines(
    importLine('defineComponent'), '',
    `export interface ${names.lineProps} {`, '  label: string;', '  value: string;', '}', '',
    `/** One line of a panel: a label and its value. */`,
    `export const ${names.line} = defineComponent<${names.lineProps}>('${names.line}', ({ label, value }) => (`,
    '  <div>', '    <dt>{label}</dt>', '    <dd>{value}</dd>', '  </div>', '));',
  );
}

/** @returns {string} `components/<Name>Notice.component.tsx`: a short message in place of the overview. */
function noticeFile(ctx) {
  const { names, plural } = ctx;
  return lines(
    importLine('defineComponent'), '',
    `export interface ${names.noticeProps} {`, `  role: 'status' | 'alert';`, '  text: string;', '}', '',
    `/** A short message in place of the ${plural} overview: loading or an error. */`,
    `export const ${names.notice} = defineComponent<${names.noticeProps}>('${names.notice}', ({ role, text }) => <p role={role}>{text}</p>);`,
  );
}

/** @returns {string} `expressions/<Name>TileRow.expression.tsx`: the row of tiles, one tile per item. */
function tileRowFile(ctx) {
  const { names, plural } = ctx;
  return lines(
    importLine('defineExpression'),
    `import { ${names.tile} } from '../components/${names.tile}.component';`, `import { ${names.tiles} } from '../components/${names.tiles}.component';`,
    `import type { ${names.tileItem} } from '../types';`, '',
    `export interface ${names.tileRowProps} {`, `  tiles: ${names.tileItem}[];`, '}', '',
    `/** The row of tiles of the ${plural} screen: one tile for each item, then its children. */`,
    `export const ${names.tileRow} = defineExpression<${names.tileRowProps}>('${names.tileRow}', ({ tiles, children }) => (`,
    `  <${names.tiles}>`, `    {tiles.map((tile) => <${names.tile} key={tile.key} label={tile.label} value={tile.value} />)}`, '    {children}', `  </${names.tiles}>`, '));',
  );
}

/** @returns {string} `expressions/<Name>PanelList.expression.tsx`: the panels, one panel per item with a line for each of its lines. */
function panelListFile(ctx) {
  const { names, plural } = ctx;
  return lines(
    importLine('defineExpression'),
    `import { ${names.line} } from '../components/${names.line}.component';`, `import { ${names.panel} } from '../components/${names.panel}.component';`,
    `import type { ${names.panelItem} } from '../types';`, '',
    `export interface ${names.panelListProps} {`, `  panels: ${names.panelItem}[];`, '}', '',
    `/** The panels of the ${plural} screen: one panel for each item, each with a line for each of its lines, then its children. */`,
    `export const ${names.panelList} = defineExpression<${names.panelListProps}>('${names.panelList}', ({ panels, children }) => (`,
    '  <>',
    `    {panels.map((panel) => (`, `      <${names.panel} key={panel.key} title={panel.title}>`,
    `        {panel.lines.map((line) => <${names.line} key={line.label} label={line.label} value={line.value} />)}`, `      </${names.panel}>`, '    ))}',
    '    {children}', '  </>', '));',
  );
}

/** @returns {string} `expressions/<Name>ByStatus.expression.tsx`: the branches (loading, error, ready with its tiles and panels). */
function expressionFile(ctx) {
  const { names, plural } = ctx;
  return lines(
    importLine('defineExpression'),
    `import { ${names.notice} } from '../components/${names.notice}.component';`, `import { ${names.panelList} } from './${names.panelList}.expression';`, `import { ${names.tileRow} } from './${names.tileRow}.expression';`,
    `import type { ${names.state} } from '../types';`, '',
    `export interface ${names.expressionProps} {`, `  state: ${names.state};`, '}', '',
    `/** Decides what the ${plural} screen shows: a loading or error notice, else the row of tiles and the panels, then its children. */`,
    `export const ${names.expression} = defineExpression<${names.expressionProps}>('${names.expression}', ({ state, children }) => {`,
    `  if (state.status === 'loading') return <${names.notice} role="status" text="Loading ${plural}..." />;`,
    `  if (state.status === 'error') return <${names.notice} role="alert" text={state.message} />;`,
    '  return (', '    <>', `      <${names.tileRow} tiles={state.tiles} />`, `      <${names.panelList} panels={state.panels} />`, '      {children}', '    </>', '  );', '});',
  );
}

/** @returns {string} `pages/<Name>Page.page.tsx`: the title and the overview, from props. */
function pageFile(ctx) {
  const { names, plural, heading } = ctx;
  return lines(
    importLine('definePage'),
    `import { ${names.expression} } from '../expressions/${names.expression}.expression';`, `import type { ${names.state} } from '../types';`, '',
    `export interface ${names.pageProps} {`, `  state: ${names.state};`, '}', '',
    `/** The ${plural} screen, from props: a title, and the tiles and panels of the overview with their loading and error states. */`,
    `export const ${names.page} = definePage<${names.pageProps}>('${names.page}', ({ state }) => (`,
    '  <main>', `    <h1>${heading}</h1>`, `    <${names.expression} state={state} />`, '  </main>', '));',
  );
}

/** @returns {string} `controllers/<Name>Controller.controller.tsx`: the hook wired to the page, no logic of its own. */
function controllerFile(ctx) {
  const { names, plural } = ctx;
  return lines(
    ctx.useClient ? ["'use client';", ''] : [],
    importLine('defineController'), `import { ${names.hook} } from '../hooks/${names.hook}.state';`, `import { ${names.page} } from '../pages/${names.page}.page';`, '',
    `/** Wires the ${plural} hook to the ${plural} page: no logic of its own. */`,
    `export const ${names.controller} = defineController<Record<string, never>>('${names.controller}', () => {`,
    `  const state = ${names.hook}();`, `  return <${names.page} state={state} />;`, '});',
  );
}

/**
 * The entity of a dashboard unit name when none is given: the name without its trailing Dashboard word (`OrdersDashboard` is `Orders`), which
 * shapes.mjs then singularises (`Order`). A name with no such word is used as it is.
 *
 * @param {string} Name The PascalCase unit name.
 * @returns {string} The name without its trailing dashboard word.
 *
 * @example
 * dashboardBaseOf('OrdersDashboard'); // => 'Orders'
 */
export function dashboardBaseOf(Name) {
  const parts = words(Name);
  const last = parts.at(-1)?.toLowerCase();
  return parts.length > 1 && DASHBOARD_WORDS.includes(last) ? parts.slice(0, -1).map(cap).join('') : Name;
}

/**
 * The dashboard shape's definition: the layers it writes, what each imports, and the files of each layer (`{ folder, base, content }`).
 * Registered as `SHAPES.dashboard` in shapes.mjs.
 */
export const DASHBOARD_SHAPE = Object.freeze({
  summary: 'A titled overview: a row of tiles and a few panels composed from one typed summary, with loading and error states.',
  layers: Object.freeze(['domain', 'service', 'hook', 'component', 'page', 'controller']),
  requires: Object.freeze({ service: ['domain'], hook: ['service', 'domain'], component: ['domain'], page: ['component', 'domain'], controller: ['hook', 'page'] }),
  names: dashboardNames,
  types: dashboardTypes,
  files: (ctx) => ({
    domain: [{ folder: 'domain', base: `${ctx.names.Name}.domain.ts`, content: domainFile(ctx) }, ...(ctx.source === 'local' ? [{ folder: 'domain', base: `${ctx.store.file}.domain.ts`, content: storeFile(ctx) }] : [])],
    service: [{ folder: 'services', base: `${ctx.names.Name}.service.ts`, content: ctx.source === 'local' ? localServiceFile(ctx) : serviceFile(ctx) }],
    hook: [{ folder: 'hooks', base: `${ctx.names.hook}.state.ts`, content: hookFile(ctx) }],
    component: [
      { folder: 'components', base: `${ctx.names.tile}.component.tsx`, content: tileFile(ctx) },
      { folder: 'components', base: `${ctx.names.tiles}.component.tsx`, content: tilesFile(ctx) },
      { folder: 'components', base: `${ctx.names.panel}.component.tsx`, content: panelFile(ctx) },
      { folder: 'components', base: `${ctx.names.line}.component.tsx`, content: lineFile(ctx) },
      { folder: 'components', base: `${ctx.names.notice}.component.tsx`, content: noticeFile(ctx) },
    ],
    page: [
      { folder: 'pages', base: `${ctx.names.page}.page.tsx`, content: pageFile(ctx) },
      { folder: 'expressions', base: `${ctx.names.expression}.expression.tsx`, content: expressionFile(ctx) },
      { folder: 'expressions', base: `${ctx.names.tileRow}.expression.tsx`, content: tileRowFile(ctx) },
      { folder: 'expressions', base: `${ctx.names.panelList}.expression.tsx`, content: panelListFile(ctx) },
    ],
    controller: [{ folder: 'controllers', base: `${ctx.names.controller}.controller.tsx`, content: controllerFile(ctx) }],
  }),
});
