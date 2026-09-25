// #620 (part of epic #616) -- the `detail` shape: a read-only screen bound to ONE item. Its unit names, its `types.ts` declarations and
// the typed template of every file (domain, service, hook, component, page + expression, controller). Registered in shapes.mjs, which
// owns the request, the checks and the writing. Every unit is built with the factory of its layer and named `Name.layer.ext` (READ-004).
//
//   construct create layer Product --feature products --layers domain,service,hook,component,page,controller \
//     --shape detail --entity Product --fields id:string,name:string,price:number
//
// The item is fetched by id (`GET /api/products/<id>`); the id comes from the controller's `id` prop, else from `?id=` in the address,
// so the route entry (which renders the controller and nothing else) needs no route parameter. States: loading, not-found, ready, error.
import { cap, importLine, labelOf, lines, lowerFirst, ts } from './shape-kit.mjs';

/**
 * The identifiers of a detail shape, from its unit name and its entity: `Product` and `Product` give `useProduct`, `fetchProduct`,
 * `ProductPage`, `ProductDetailState` and so on. The unit name may equal the entity name (the screen of one product is called Product).
 *
 * @param {string} Name The PascalCase unit name of the screen.
 * @param {string} Entity The PascalCase entity it shows.
 * @returns {Record<string, string>} Every generated identifier, by role.
 *
 * @example
 * detailNames('Product', 'Product').hook; // => 'useProduct'
 */
export function detailNames(Name, Entity) {
  return {
    Name, Entity,
    entry: `${Entity}DetailEntry`, state: `${Name}DetailState`, result: `${Name}DetailResult`,
    fetch: `fetch${Name}`, describe: `describe${Name}`, hook: `use${Name}`,
    page: `${Name}Page`, pageProps: `${Name}PageProps`, controller: `${Name}Controller`, controllerProps: `${Name}ControllerProps`,
    expression: `${Name}ByStatus`, expressionProps: `${Name}ByStatusProps`,
    row: `${Name}DetailRow`, rowProps: `${Name}DetailRowProps`, details: `${Name}Details`, detailsProps: `${Name}DetailsProps`,
    notice: `${Name}Notice`, noticeProps: `${Name}NoticeProps`,
  };
}

/**
 * The declarations the detail shape adds to the feature's `types.ts`: the entity, one line of its details, the state of the screen and
 * the answer of the service. `shapes.mjs` appends the ones the file does not declare yet.
 *
 * @param {object} ctx The shape context (`names`, `fields`, `singular`).
 * @returns {{ declares: string, text: string }[]} Each declaration and the name it declares.
 *
 * @example
 * detailTypes(ctx).map((b) => b.declares); // => ['Product', 'ProductDetailEntry', 'ProductDetailState', 'ProductDetailResult']
 */
export function detailTypes(ctx) {
  const { names, fields, singular } = ctx;
  return [
    { declares: names.Entity, text: lines(`/** One ${singular}, as its details screen shows it. */`, `export interface ${names.Entity} {`, fields.map((f) => `  ${f.name}: ${ts(f)};`), '}') },
    { declares: names.entry, text: lines(`/** One line of a ${singular}'s details: the field, its label and its text. */`, `export interface ${names.entry} {`, '  field: string;', '  label: string;', '  value: string;', '}') },
    { declares: names.state, text: lines(`/** What the ${singular} screen is doing: loading, not found, showing the ${singular} (with its lines), or failed. */`, `export type ${names.state} =`, `  | { status: 'loading' }`, `  | { status: 'not-found' }`, `  | { status: 'ready'; item: ${names.Entity}; rows: ${names.entry}[] }`, `  | { status: 'error'; message: string };`) },
    { declares: names.result, text: lines(`/** What the ${singular} service answers: the ${singular}, that there is none, or an error. */`, `export type ${names.result} =`, `  | { status: 'ready'; item: ${names.Entity} }`, `  | { status: 'not-found' }`, `  | { status: 'error'; message: string };`) },
  ];
}

const valueText = (f) => (f.type === 'boolean' ? `item.${f.name} ? 'Yes' : 'No'` : f.type === 'string' ? `item.${f.name}` : `String(item.${f.name})`);

/** @returns {string} `domain/<Name>.domain.ts`: the lines of the details, in field order. */
function domainFile(ctx) {
  const { names, fields, singular } = ctx;
  return lines(
    importLine('defineDomain'), `import type { ${names.Entity}, ${names.entry} } from '../types';`, '',
    `/** The lines of a ${singular}'s details in field order: each field with its label and its text (a yes or no field reads Yes or No). */`,
    `export const ${names.describe} = defineDomain<{ item: ${names.Entity} }, ${names.entry}[]>('${names.describe}', ({ item }) => [`,
    fields.map((f) => `  { field: '${f.name}', label: '${labelOf(f.name)}', value: ${valueText(f)} },`), ']);',
  );
}

/** @returns {string} `services/<Name>.service.ts`: fetch the item by id; not found, a bad status and a wrong shape are typed results. */
function serviceFile(ctx) {
  const { names, fields, endpoint, singular } = ctx;
  const checks = fields.map((f) => `typeof row.${f.name} === '${f.type}'`).join(' && ');
  return lines(
    importLine('defineService'), `import type { ${names.Entity}, ${names.result} } from '../types';`, '',
    `function is${names.Entity}(value: unknown): value is ${names.Entity} {`,
    `  if (typeof value !== 'object' || value === null) return false;`,
    `  const row = value as Record<string, unknown>;`,
    `  return ${checks};`, '}', '',
    `/** Fetches one ${singular} by id. Forwards the caller's AbortSignal and answers with a typed result: a 404 is not-found, and a failed request, a bad status or a wrong shape is an error result, never a throw. */`,
    `export const ${names.fetch} = defineService('${names.fetch}', async ({ id, signal }: { id: string; signal: AbortSignal }): Promise<${names.result}> => {`,
    '  try {',
    `    const response = await fetch(\`${endpoint}/\${encodeURIComponent(id)}\`, { signal });`,
    `    if (response.status === 404) return { status: 'not-found' };`,
    `    if (!response.ok) return { status: 'error', message: \`The server answered \${response.status}.\` };`,
    '    const body: unknown = await response.json();',
    `    if (!is${names.Entity}(body)) return { status: 'error', message: 'The server did not answer with a ${singular}.' };`,
    `    return { status: 'ready', item: body };`,
    '  } catch (error) {',
    `    return { status: 'error', message: error instanceof Error ? error.message : 'The request failed.' };`,
    '  }', '});',
  );
}

/** @returns {string} `hooks/use<Name>.state.ts`: the id from the argument or `?id=`, the request, and the status union in tracked state. */
function hookFile(ctx) {
  const { names, singular } = ctx;
  return lines(
    ctx.useClient ? ["'use client';", ''] : [],
    `import { useEffect } from 'react';`, importLine('useTrackedState'),
    `import { ${names.describe} } from '../domain/${names.Name}.domain';`, `import { ${names.fetch} } from '../services/${names.Name}.service';`, `import type { ${names.state} } from '../types';`, '',
    `/** Loads one ${singular} and holds what the screen shows: loading, not found, the ${singular} with its lines, or an error. The id is the argument, else \`?id=\` of the address; with neither, the ${singular} is not found. The request is aborted when the screen goes away. */`,
    `export function ${names.hook}(id?: string): ${names.state} {`,
    `  const [state, setState] = useTrackedState<${names.state}>('${lowerFirst(names.Name)}', { status: 'loading' });`,
    '  useEffect(() => {',
    `    const wanted = id ?? new URLSearchParams(window.location.search).get('id');`,
    `    if (!wanted) {`, `      setState({ status: 'not-found' });`, '      return undefined;', '    }',
    `    setState({ status: 'loading' });`,
    '    const controller = new AbortController();',
    `    ${names.fetch}({ id: wanted, signal: controller.signal }).then((result) => {`,
    '      if (controller.signal.aborted) return;',
    `      setState(result.status === 'ready' ? { status: 'ready', item: result.item, rows: ${names.describe}({ item: result.item }) } : result);`,
    '    });', '    return () => controller.abort();', '  }, [id, setState]);', '  return state;', '}',
  );
}

/** @returns {string} `components/<Name>DetailRow.component.tsx`: one field as a term and its description. */
function rowFile(ctx) {
  const { names, singular } = ctx;
  return lines(
    importLine('defineComponent'), `import type { ${names.entry} } from '../types';`, '',
    `export interface ${names.rowProps} {`, `  entry: ${names.entry};`, '}', '',
    `/** One field of the ${singular}: its label and its text. */`,
    `export const ${names.row} = defineComponent<${names.rowProps}>('${names.row}', ({ entry }) => (`,
    '  <div>', '    <dt>{entry.label}</dt>', '    <dd>{entry.value}</dd>', '  </div>', '));',
  );
}

/** @returns {string} `components/<Name>Details.component.tsx`: the description list the field rows sit in. */
function detailsFile(ctx) {
  const { names, singular } = ctx;
  return lines(
    `import type { ReactNode } from 'react';`, importLine('defineComponent'), '',
    `export interface ${names.detailsProps} {`, '  children?: ReactNode;', '}', '',
    `/** The list the ${singular}'s field rows sit in. */`,
    `export const ${names.details} = defineComponent<${names.detailsProps}>('${names.details}', ({ children }) => <dl aria-label="${cap(singular)} details">{children}</dl>);`,
  );
}

/** @returns {string} `components/<Name>Notice.component.tsx`: a short message in place of the details. */
function noticeFile(ctx) {
  const { names, singular } = ctx;
  return lines(
    importLine('defineComponent'), '',
    `export interface ${names.noticeProps} {`, `  role: 'status' | 'alert';`, '  text: string;', '}', '',
    `/** A short message in place of the ${singular}'s details: loading, not found or an error. */`,
    `export const ${names.notice} = defineComponent<${names.noticeProps}>('${names.notice}', ({ role, text }) => <p role={role}>{text}</p>);`,
  );
}

/** @returns {string} `expressions/<Name>ByStatus.expression.tsx`: the branches (loading, not found, error, ready). */
function expressionFile(ctx) {
  const { names, singular } = ctx;
  return lines(
    importLine('defineExpression'),
    `import { ${names.details} } from '../components/${names.details}.component';`, `import { ${names.row} } from '../components/${names.row}.component';`, `import { ${names.notice} } from '../components/${names.notice}.component';`,
    `import type { ${names.state} } from '../types';`, '',
    `export interface ${names.expressionProps} {`, `  state: ${names.state};`, '}', '',
    `/** Decides what the ${singular} screen shows: a loading or error notice, its children when the ${singular} is not found, else the ${singular}'s fields. */`,
    `export const ${names.expression} = defineExpression<${names.expressionProps}>('${names.expression}', ({ state, children }) => {`,
    `  if (state.status === 'loading') return <${names.notice} role="status" text="Loading ${singular}..." />;`,
    `  if (state.status === 'not-found') return <>{children}</>;`,
    `  if (state.status === 'error') return <${names.notice} role="alert" text={state.message} />;`,
    `  const rows = state.rows.map((entry) => <${names.row} key={entry.field} entry={entry} />);`,
    `  return <${names.details}>{rows}</${names.details}>;`, '});',
  );
}

/** @returns {string} `pages/<Name>Page.page.tsx`: the heading and the states, from props. */
function pageFile(ctx) {
  const { names, singular } = ctx;
  return lines(
    importLine('definePage'),
    `import { ${names.notice} } from '../components/${names.notice}.component';`, `import { ${names.expression} } from '../expressions/${names.expression}.expression';`, `import type { ${names.state} } from '../types';`, '',
    `export interface ${names.pageProps} {`, `  state: ${names.state};`, '}', '',
    `/** The ${singular} screen, from props: a heading, and the ${singular} with its loading, not-found and error states. */`,
    `export const ${names.page} = definePage<${names.pageProps}>('${names.page}', ({ state }) => (`,
    '  <main>', `    <h1>${cap(singular)} details</h1>`, `    <${names.expression} state={state}>`, `      <${names.notice} role="status" text="${cap(singular)} not found." />`, `    </${names.expression}>`, '  </main>', '));',
  );
}

/** @returns {string} `controllers/<Name>Controller.controller.tsx`: the hook wired to the page, no logic of its own. */
function controllerFile(ctx) {
  const { names, singular } = ctx;
  return lines(
    ctx.useClient ? ["'use client';", ''] : [],
    importLine('defineController'), `import { ${names.hook} } from '../hooks/${names.hook}.state';`, `import { ${names.page} } from '../pages/${names.page}.page';`, '',
    `export interface ${names.controllerProps} {`, '  id?: string;', '}', '',
    `/** Wires the ${singular} hook to the ${singular} page: no logic of its own. The id is the prop, else \`?id=\` of the address. */`,
    `export const ${names.controller} = defineController<${names.controllerProps}>('${names.controller}', ({ id }) => {`,
    `  const state = ${names.hook}(id);`, `  return <${names.page} state={state} />;`, '});',
  );
}

/**
 * The detail shape's definition: the layers it writes, what each imports, and the files of each layer (`{ folder, base, content }`).
 * Registered as `SHAPES.detail` in shapes.mjs.
 */
export const DETAIL_SHAPE = Object.freeze({
  summary: 'A read-only screen bound to one item: fetched by id, with loading, not-found, ready and error states.',
  layers: Object.freeze(['domain', 'service', 'hook', 'component', 'page', 'controller']),
  requires: Object.freeze({ service: ['domain'], hook: ['service', 'domain'], component: ['domain'], page: ['component', 'domain'], controller: ['hook', 'page'] }),
  names: detailNames,
  types: detailTypes,
  files: (ctx) => ({
    domain: [{ folder: 'domain', base: `${ctx.names.Name}.domain.ts`, content: domainFile(ctx) }],
    service: [{ folder: 'services', base: `${ctx.names.Name}.service.ts`, content: serviceFile(ctx) }],
    hook: [{ folder: 'hooks', base: `${ctx.names.hook}.state.ts`, content: hookFile(ctx) }],
    component: [
      { folder: 'components', base: `${ctx.names.row}.component.tsx`, content: rowFile(ctx) },
      { folder: 'components', base: `${ctx.names.details}.component.tsx`, content: detailsFile(ctx) },
      { folder: 'components', base: `${ctx.names.notice}.component.tsx`, content: noticeFile(ctx) },
    ],
    page: [
      { folder: 'pages', base: `${ctx.names.page}.page.tsx`, content: pageFile(ctx) },
      { folder: 'expressions', base: `${ctx.names.expression}.expression.tsx`, content: expressionFile(ctx) },
    ],
    controller: [{ folder: 'controllers', base: `${ctx.names.controller}.controller.tsx`, content: controllerFile(ctx) }],
  }),
});
