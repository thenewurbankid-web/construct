// #626 (part of epic #616) -- the `form` shape: a screen with one typed input per field, validation in a pure domain unit, and a submit
// service. Its unit names, its `types.ts` declarations and the typed template of every file (domain, service, hook, component, page +
// expression, controller). Registered in shapes.mjs, which owns the request, the checks and the writing.
//
//   construct create layer AddProduct --feature add-product --layers domain,service,hook,component,page,controller \
//     --shape form --entity Product --fields id:string,name:string,price:number
//
// The form has an input for every field except `id` (the server assigns it). A string field is required; a number field is required and
// must be a number; a boolean field is a checkbox. The typed values are POSTed as JSON to `/api/<entities>` and the answer is a typed
// result. States: editing (with per-field messages after a failed check), submitting, submitted, error.
import { cap, importLine, kebab, labelOf, lines, lowerFirst, operationComment, rowText, sampleRows, ts } from './shape-kit.mjs';

/**
 * The identifiers of a form shape, from its unit name and its entity: `AddProduct` and `Product` give `useAddProduct`, `validateAddProduct`,
 * `submitAddProduct`, `AddProductForm`, `AddProductState` and `ProductInput`.
 *
 * @param {string} Name The PascalCase unit name of the screen (`AddProduct`).
 * @param {string} Entity The PascalCase entity it writes (`Product`).
 * @returns {Record<string, string>} Every generated identifier, by role.
 *
 * @example
 * formNames('AddProduct', 'Product').validate; // => 'validateAddProduct'
 */
export function formNames(Name, Entity) {
  return {
    Name, Entity,
    input: `${Entity}Input`, values: `${Name}Values`, errors: `${Name}Errors`, validation: `${Name}Validation`, state: `${Name}State`, result: `${Name}Result`,
    validate: `validate${Name}`, submit: `submit${Name}`, hook: `use${Name}`,
    page: `${Name}Page`, pageProps: `${Name}PageProps`, controller: `${Name}Controller`,
    expression: `${Name}ByStatus`, expressionProps: `${Name}ByStatusProps`,
    field: `${Name}Field`, fieldProps: `${Name}FieldProps`, form: `${Name}Form`, formProps: `${Name}FormProps`,
    notice: `${Name}Notice`, noticeProps: `${Name}NoticeProps`, again: `${Name}Again`, againProps: `${Name}AgainProps`,
  };
}

/**
 * The fields the form has an input for: every field except `id` (the server assigns it).
 *
 * @param {{ name: string, type: string }[]} fields The parsed `--fields`.
 * @returns {{ name: string, type: string }[]} The fields of the form, in order.
 *
 * @example
 * inputFieldsOf([{ name: 'id', type: 'string' }, { name: 'name', type: 'string' }]); // => [{ name: 'name', type: 'string' }]
 */
export const inputFieldsOf = (fields) => fields.filter((f) => f.name !== 'id');

/** What a person types for a field: text for a string or a number, a tick for a boolean. */
const valueType = (f) => (f.type === 'boolean' ? 'boolean' : 'string');
const emptyValue = (f) => (f.type === 'boolean' ? 'false' : "''");
const idOf = (ctx, f) => `${kebab(ctx.names.Name)}-${kebab(f.name)}`;

/**
 * The declarations the form shape adds to the feature's `types.ts`: the typed input, what is typed, the messages, the check result, the
 * state and the answer. `shapes.mjs` appends the ones the file does not declare yet.
 *
 * @param {object} ctx The shape context (`names`, `fields`, `singular`).
 * @returns {{ declares: string, text: string }[]} Each declaration and the name it declares.
 *
 * @example
 * formTypes(ctx).map((b) => b.declares); // => ['ProductInput', 'AddProductValues', 'AddProductErrors', 'AddProductValidation', 'AddProductState', 'AddProductResult']
 */
export function formTypes(ctx) {
  const { names, singular } = ctx;
  const inputs = inputFieldsOf(ctx.fields);
  return [
    ...(ctx.source === 'local' ? [{ declares: names.Entity, text: lines(`/** One ${singular}, as the local store holds it: the form's typed values and the id the store gives it. */`, `export interface ${names.Entity} {`, ctx.fields.map((f) => `  ${f.name}: ${ts(f)};`), '}') }] : []),
    { declares: names.input, text: lines(`/** The values of a ${singular} as the form submits them, typed. */`, `export interface ${names.input} {`, inputs.map((f) => `  ${f.name}: ${ts(f)};`), '}') },
    { declares: names.values, text: lines(`/** What a person has typed in the ${singular} form: text for a string or a number field, a tick for a yes or no field. */`, `export interface ${names.values} {`, inputs.map((f) => `  ${f.name}: ${valueType(f)};`), '}') },
    { declares: names.errors, text: lines(`/** The message for each field of the ${singular} form that failed its check. */`, `export interface ${names.errors} {`, inputs.map((f) => `  ${f.name}?: string;`), '}') },
    { declares: names.validation, text: lines(`/** The check of the ${singular} form: the typed values, or a message per field. */`, `export type ${names.validation} =`, `  | { ok: true; input: ${names.input} }`, `  | { ok: false; errors: ${names.errors} };`) },
    { declares: names.state, text: lines(`/** What the ${singular} form is doing: editing (with the messages of a failed check), submitting, submitted, or failed. */`, `export type ${names.state} =`, `  | { status: 'editing'; values: ${names.values}; errors: ${names.errors} }`, `  | { status: 'submitting'; values: ${names.values} }`, `  | { status: 'submitted' }`, `  | { status: 'error'; values: ${names.values}; message: string };`) },
    { declares: names.result, text: lines(`/** What the ${singular} service answers: submitted, or an error with its message. */`, `export type ${names.result} =`, `  | { status: 'submitted' }`, `  | { status: 'error'; message: string };`) },
  ];
}

/** The check of one field, as the statements that add its message: a string is required, a number is required and must be a number, a boolean has none. */
function checkLines(f) {
  const label = labelOf(f.name);
  if (f.type === 'string') return [`  if (values.${f.name}.trim() === '') errors.${f.name} = '${label} is required.';`];
  if (f.type === 'number') return [`  if (values.${f.name}.trim() === '') errors.${f.name} = '${label} is required.';`, `  else if (!Number.isFinite(Number(values.${f.name}))) errors.${f.name} = '${label} must be a number.';`];
  return [];
}

const typedValue = (f) => (f.type === 'string' ? `values.${f.name}.trim()` : f.type === 'number' ? `Number(values.${f.name})` : `values.${f.name}`);

/** @returns {string} `domain/<Name>.domain.ts`: the pure check, with a message per field and the typed values. */
function domainFile(ctx) {
  const { names, singular } = ctx;
  const inputs = inputFieldsOf(ctx.fields);
  return lines(
    importLine('defineDomain'), `import type { ${names.errors}, ${names.validation}, ${names.values} } from '../types';`, '',
    `/** Checks the ${singular} form: a string is required, a number is required and must be a number. Answers the typed values, or a message per field. Pure. */`,
    `export const ${names.validate} = defineDomain<${names.values}, ${names.validation}>('${names.validate}', (values) => {`,
    `  const errors: ${names.errors} = {};`, inputs.flatMap(checkLines),
    '  if (Object.keys(errors).length > 0) return { ok: false, errors };',
    `  return { ok: true, input: { ${inputs.map((f) => `${f.name}: ${typedValue(f)}`).join(', ')} } };`, '});',
  );
}

/** @returns {string} `services/<Name>.service.ts`: POST the typed values as JSON; a bad status or a failed request is an error result. */
function serviceFile(ctx) {
  const { names, endpoint, singular } = ctx;
  return lines(
    importLine('defineService'), `import type { ${names.input}, ${names.result} } from '../types';`, operationComment(ctx.operation), '',
    `/** Submits a ${singular}: POSTs the typed values as JSON to ${endpoint}. Forwards the caller's AbortSignal and answers with a typed result: a bad status or a failed request is an error result, never a throw. */`,
    `export const ${names.submit} = defineService('${names.submit}', async ({ input, signal }: { input: ${names.input}; signal: AbortSignal }): Promise<${names.result}> => {`,
    '  try {',
    `    const response = await fetch('${endpoint}', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal });`,
    `    if (!response.ok) return { status: 'error', message: \`The server answered \${response.status}.\` };`,
    `    return { status: 'submitted' };`,
    '  } catch (error) {',
    `    return { status: 'error', message: error instanceof Error ? error.message : 'The request failed.' };`,
    '  }', '});',
  );
}

/** @returns {string} `domain/<Name>Store.domain.ts` (the `local` source): the seed rows and the pure save of one more row, whose id is the next one. */
function storeFile(ctx) {
  const { names, store, singular } = ctx;
  const idField = ctx.fields.find((f) => f.name === 'id');
  const nextId = idField.type === 'number' ? 'rows.length + 1' : `\`${kebab(names.Entity)}-\${rows.length + 1}\``;
  return lines(
    importLine('defineDomain'), `import type { ${names.Entity}, ${names.input} } from '../types';`, '',
    `/** The seed rows of the local ${singular} store: what it holds before anything is submitted. Pure. */`,
    `export const ${store.seed} = defineDomain<Record<string, never>, ${names.Entity}[]>('${store.seed}', () => [`,
    sampleRows(names.Entity, ctx.fields).map((row) => `  ${rowText(row)},`), ']);', '',
    `/** Saves a ${singular}: the rows plus one more, given the next id (the server's job once there is one). Does not change the rows it is given. Pure. */`,
    `export const ${store.op} = defineDomain<{ rows: readonly ${names.Entity}[]; input: ${names.input} }, ${names.Entity}[]>('${store.op}', ({ rows, input }) => [`,
    `  ...rows,`, `  { id: ${nextId}, ...input },`, ']);',
  );
}

/** @returns {string} `services/<Name>.service.ts` (the `local` source): the same typed result as the network service, saving into the store in memory. */
function localServiceFile(ctx) {
  const { names, store, singular } = ctx;
  return lines(
    importLine('defineService'), `import { ${store.op}, ${store.seed} } from '../domain/${store.file}.domain';`, `import type { ${names.Entity}, ${names.input}, ${names.result} } from '../types';`, '',
    `/** The ${singular} rows of the local store: the seed rows, then whatever was submitted, held in memory. It is this screen's whole backend until a real source replaces it. */`,
    `let rows: ${names.Entity}[] = ${store.seed}({});`, '',
    `/** Submits a ${singular} to the local store and answers with the same typed result as a network source. Takes the caller's AbortSignal like one: a cancelled request is an error result, never a throw. */`,
    `export const ${names.submit} = defineService('${names.submit}', async ({ input, signal }: { input: ${names.input}; signal: AbortSignal }): Promise<${names.result}> => {`,
    `  if (signal.aborted) return { status: 'error', message: 'The request was cancelled.' };`,
    `  rows = ${store.op}({ rows, input });`, `  return { status: 'submitted' };`, '});',
  );
}

/** @returns {string} `hooks/use<Name>.state.ts`: the values, the messages and the submit state in tracked state, with change, submit and reset. */
function hookFile(ctx) {
  const { names } = ctx;
  const inputs = inputFieldsOf(ctx.fields);
  return lines(
    ctx.useClient ? ["'use client';", ''] : [],
    `import { useEffect, useRef } from 'react';`, importLine('useTrackedState'),
    `import { ${names.validate} } from '../domain/${names.Name}.domain';`, `import { ${names.submit} } from '../services/${names.Name}.service';`, `import type { ${names.state}, ${names.values} } from '../types';`, '',
    `const EMPTY: ${names.values} = { ${inputs.map((f) => `${f.name}: ${emptyValue(f)}`).join(', ')} };`, '',
    `/** Holds the ${ctx.singular} form: what is typed, the messages of a failed check, and whether it is submitting, submitted or failed. \`submit\` checks the values, then POSTs them; the request is aborted when the screen goes away. */`,
    `export function ${names.hook}() {`,
    `  const [state, setState] = useTrackedState<${names.state}>('${lowerFirst(names.Name)}', { status: 'editing', values: EMPTY, errors: {} });`,
    '  const pending = useRef<AbortController | null>(null);',
    '  useEffect(() => () => pending.current?.abort(), []);', '',
    `  const change = (field: keyof ${names.values}, value: string | boolean) => {`,
    `    setState((current) => (current.status === 'submitting' || current.status === 'submitted' ? current : { status: 'editing', values: { ...current.values, [field]: value }, errors: {} }));`,
    '  };', '',
    '  const submit = () => {',
    `    if (state.status !== 'editing' && state.status !== 'error') return;`,
    '    const { values } = state;',
    `    const checked = ${names.validate}(values);`,
    `    if (!checked.ok) {`, `      setState({ status: 'editing', values, errors: checked.errors });`, '      return;', '    }',
    '    const controller = new AbortController();', '    pending.current = controller;',
    `    setState({ status: 'submitting', values });`,
    `    ${names.submit}({ input: checked.input, signal: controller.signal }).then((result) => {`,
    '      if (controller.signal.aborted) return;',
    `      setState(result.status === 'submitted' ? { status: 'submitted' } : { status: 'error', values, message: result.message });`,
    '    });', '  };', '',
    `  const reset = () => setState({ status: 'editing', values: EMPTY, errors: {} });`, '',
    '  return { state, change, submit, reset };', '}',
  );
}

/** @returns {string} `components/<Name>Field.component.tsx`: a label, the input it is given, and a live region for the message of a failed check. */
function fieldFile(ctx) {
  const { names } = ctx;
  return lines(
    `import type { ReactNode } from 'react';`, importLine('defineComponent'), '',
    `export interface ${names.fieldProps} {`, '  id: string;', '  label: string;', '  error?: string;', '  children?: ReactNode;', '}', '',
    `/** One field of the form: its label, its input and a live region that holds the message of a failed check (empty when the field is fine). */`,
    `export const ${names.field} = defineComponent<${names.fieldProps}>('${names.field}', ({ id, label, error, children }) => (`,
    '  <div>', '    <label htmlFor={id}>{label}</label>', '    {children}', '    <span id={`${id}-error`} aria-live="polite">{error}</span>', '  </div>', '));',
  );
}

/** The JSX of the input of one field: text, number or checkbox, controlled from `values`, its message from `errors`. */
function inputLines(ctx, f) {
  const id = idOf(ctx, f);
  const label = labelOf(f.name);
  if (f.type === 'boolean') {
    return [
      `    <${ctx.names.field} id="${id}" label="${label}">`,
      `      <input id="${id}" name="${f.name}" type="checkbox" checked={values.${f.name}} disabled={disabled} onChange={(event) => onChange('${f.name}', event.target.checked)} />`,
      `    </${ctx.names.field}>`,
    ];
  }
  return [
    `    <${ctx.names.field} id="${id}" label="${label}" error={errors.${f.name}}>`,
    `      <input id="${id}" name="${f.name}" type="${f.type === 'number' ? 'number' : 'text'}"${f.type === 'number' ? ' step="any"' : ''} value={values.${f.name}} disabled={disabled} aria-invalid={errors.${f.name} !== undefined} onChange={(event) => onChange('${f.name}', event.target.value)} />`,
    `    </${ctx.names.field}>`,
  ];
}

/** @returns {string} `components/<Name>Form.component.tsx`: the form with an input for every field and a submit button. */
function formFile(ctx) {
  const { names } = ctx;
  const inputs = inputFieldsOf(ctx.fields);
  return lines(
    importLine('defineComponent'), `import { ${names.field} } from './${names.field}.component';`, `import type { ${names.errors}, ${names.values} } from '../types';`, '',
    `export interface ${names.formProps} {`, `  values: ${names.values};`, `  errors: ${names.errors};`, '  disabled: boolean;', `  onChange: (field: keyof ${names.values}, value: string | boolean) => void;`, '  onSubmit: () => void;', '}', '',
    `/** The ${ctx.singular} form: an input for each field, and a button that submits it. */`,
    `export const ${names.form} = defineComponent<${names.formProps}>('${names.form}', ({ values, errors, disabled, onChange, onSubmit }) => {`,
    '  const submit = (event: { preventDefault: () => void }) => {', '    event.preventDefault();', '    onSubmit();', '  };',
    '  return (', '    <form noValidate onSubmit={submit}>', inputs.flatMap((f) => inputLines(ctx, f).map((l) => `  ${l}`)),
    `      <button type="submit" disabled={disabled}>${labelOf(names.Name)}</button>`, '    </form>', '  );', '});',
  );
}

/** @returns {string} `components/<Name>Notice.component.tsx`: a short message. */
function noticeFile(ctx) {
  const { names, singular } = ctx;
  return lines(
    importLine('defineComponent'), '',
    `export interface ${names.noticeProps} {`, `  role: 'status' | 'alert';`, '  text: string;', '}', '',
    `/** A short message about the ${singular} form: saving, saved or an error. */`,
    `export const ${names.notice} = defineComponent<${names.noticeProps}>('${names.notice}', ({ role, text }) => <p role={role}>{text}</p>);`,
  );
}

/** @returns {string} `components/<Name>Again.component.tsx`: the button that starts another entry after a submit. */
function againFile(ctx) {
  const { names, singular } = ctx;
  return lines(
    importLine('defineComponent'), '',
    `export interface ${names.againProps} {`, '  onClick: () => void;', '}', '',
    `/** The button that starts another ${singular} once one was submitted. */`,
    `export const ${names.again} = defineComponent<${names.againProps}>('${names.again}', ({ onClick }) => <button type="button" onClick={onClick}>Add another</button>);`,
  );
}

const handlers = (names) => [`  onChange: (field: keyof ${names.values}, value: string | boolean) => void;`, '  onSubmit: () => void;'];

/** @returns {string} `expressions/<Name>ByStatus.expression.tsx`: the branches (submitted, submitting, error, editing with its messages). */
function expressionFile(ctx) {
  const { names, singular } = ctx;
  return lines(
    importLine('defineExpression'),
    `import { ${names.form} } from '../components/${names.form}.component';`, `import { ${names.notice} } from '../components/${names.notice}.component';`,
    `import type { ${names.errors}, ${names.state}, ${names.values} } from '../types';`, '',
    `const NO_ERRORS: ${names.errors} = {};`, '',
    `export interface ${names.expressionProps} {`, `  state: ${names.state};`, handlers(names), '}', '',
    `/** Decides what the ${singular} form screen shows: its children (the saved notice) once submitted, else the form (disabled and with a saving notice while it submits, with an error notice when it failed, with its messages after a failed check). */`,
    `export const ${names.expression} = defineExpression<${names.expressionProps}>('${names.expression}', ({ state, onChange, onSubmit, children }) => {`,
    `  if (state.status === 'submitted') return <>{children}</>;`,
    `  const errors = state.status === 'editing' ? state.errors : NO_ERRORS;`,
    '  return (', '    <>',
    `      {state.status === 'error' ? <${names.notice} role="alert" text={state.message} /> : null}`,
    `      {state.status === 'submitting' ? <${names.notice} role="status" text="Saving..." /> : null}`,
    `      <${names.form} values={state.values} errors={errors} disabled={state.status === 'submitting'} onChange={onChange} onSubmit={onSubmit} />`,
    '    </>', '  );', '});',
  );
}

/** @returns {string} `pages/<Name>Page.page.tsx`: the heading and the states, from props. */
function pageFile(ctx) {
  const { names, singular } = ctx;
  return lines(
    importLine('definePage'),
    `import { ${names.again} } from '../components/${names.again}.component';`, `import { ${names.notice} } from '../components/${names.notice}.component';`, `import { ${names.expression} } from '../expressions/${names.expression}.expression';`, `import type { ${names.state}, ${names.values} } from '../types';`, '',
    `export interface ${names.pageProps} {`, `  state: ${names.state};`, handlers(names), '  onReset: () => void;', '}', '',
    `/** The ${singular} form screen, from props: a heading, and the form with its editing, submitting, submitted and error states. */`,
    `export const ${names.page} = definePage<${names.pageProps}>('${names.page}', ({ state, onChange, onSubmit, onReset }) => (`,
    '  <main>', `    <h1>${labelOf(names.Name)}</h1>`, `    <${names.expression} state={state} onChange={onChange} onSubmit={onSubmit}>`, `      <${names.notice} role="status" text="${cap(singular)} added." />`, `      <${names.again} onClick={onReset} />`, `    </${names.expression}>`, '  </main>', '));',
  );
}

/** @returns {string} `controllers/<Name>Controller.controller.tsx`: the hook wired to the page, no logic of its own. */
function controllerFile(ctx) {
  const { names, singular } = ctx;
  return lines(
    ctx.useClient ? ["'use client';", ''] : [],
    importLine('defineController'), `import { ${names.hook} } from '../hooks/${names.hook}.state';`, `import { ${names.page} } from '../pages/${names.page}.page';`, '',
    `/** Wires the ${singular} form hook to the ${singular} form page: no logic of its own. */`,
    `export const ${names.controller} = defineController<Record<string, never>>('${names.controller}', () => {`,
    `  const { state, change, submit, reset } = ${names.hook}();`, `  return <${names.page} state={state} onChange={change} onSubmit={submit} onReset={reset} />;`, '});',
  );
}

/**
 * The form shape's definition: the layers it writes, what each imports, and the files of each layer (`{ folder, base, content }`).
 * Registered as `SHAPES.form` in shapes.mjs.
 */
export const FORM_SHAPE = Object.freeze({
  summary: 'A form with a typed input per field, validation in a pure domain unit and a submit service: editing, submitting, submitted and error states.',
  layers: Object.freeze(['domain', 'service', 'hook', 'component', 'page', 'controller']),
  requires: Object.freeze({ service: ['domain'], hook: ['service', 'domain'], component: ['domain'], page: ['component', 'domain'], controller: ['hook', 'page'] }),
  names: formNames,
  types: formTypes,
  files: (ctx) => ({
    domain: [{ folder: 'domain', base: `${ctx.names.Name}.domain.ts`, content: domainFile(ctx) }, ...(ctx.source === 'local' ? [{ folder: 'domain', base: `${ctx.store.file}.domain.ts`, content: storeFile(ctx) }] : [])],
    service: [{ folder: 'services', base: `${ctx.names.Name}.service.ts`, content: ctx.source === 'local' ? localServiceFile(ctx) : serviceFile(ctx) }],
    hook: [{ folder: 'hooks', base: `${ctx.names.hook}.state.ts`, content: hookFile(ctx) }],
    component: [
      { folder: 'components', base: `${ctx.names.field}.component.tsx`, content: fieldFile(ctx) },
      { folder: 'components', base: `${ctx.names.form}.component.tsx`, content: formFile(ctx) },
      { folder: 'components', base: `${ctx.names.notice}.component.tsx`, content: noticeFile(ctx) },
      { folder: 'components', base: `${ctx.names.again}.component.tsx`, content: againFile(ctx) },
    ],
    page: [
      { folder: 'pages', base: `${ctx.names.page}.page.tsx`, content: pageFile(ctx) },
      { folder: 'expressions', base: `${ctx.names.expression}.expression.tsx`, content: expressionFile(ctx) },
    ],
    controller: [{ folder: 'controllers', base: `${ctx.names.controller}.controller.tsx`, content: controllerFile(ctx) }],
  }),
});
