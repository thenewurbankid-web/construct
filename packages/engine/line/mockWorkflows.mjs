// cw1 -- the contract's mock of Line workflows (contract.mjs LineWorkflowList and the four workflow plans), for
// mock.mjs. It keeps each workflow as plain data next to the mock's files and renders its source with a template, so
// it needs no parser (the mock also runs in the browser in Line mock mode). The words come from workflowWords.mjs,
// the same module the real reader (workflows.mjs) uses.
import { LineOpError } from './contract.mjs';
import { describeWorkflow, addTransitionSummary } from './workflowWords.mjs';

const NAME = /^[A-Za-z][A-Za-z0-9]*$/;
const EVENT = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
const LIB = 'library/workflows';

/** @typedef {{from: string, event: string, target: string|null, actions: import('./contract.mjs').LineWorkflowAction[]}} MockTransition */
/** @typedef {{name: string, base: string|null, machine: {id: string, initial: string, states: {path: string, final: boolean}[], transitions: MockTransition[]}, roles: Record<string, string>, pages: Record<string, string|null>|null}} MockWorkflow */

const tr = (from, event, target, actions = []) => ({ from, event, target, actions });

/** The mock library's workflows (the same machines as examples/line-sample's listDetail and wizard). */
export const MOCK_WORKFLOWS = Object.freeze({
  [`${LIB}/listDetail.ts`]: {
    name: 'listDetail', base: null, pages: null,
    roles: { list: 'The page that lists the items', detail: 'The page that shows one item' },
    machine: { id: 'listDetail', initial: 'list', states: [{ path: 'list', final: false }, { path: 'detail', final: false }], transitions: [tr('list', 'OPEN', 'detail'), tr('detail', 'BACK', 'list')] },
  },
  [`${LIB}/wizard.ts`]: {
    name: 'wizard', base: null, pages: null,
    roles: { first: 'The first step of the wizard', second: 'The second step of the wizard', review: 'The page where the person checks everything before finishing' },
    machine: {
      id: 'wizard', initial: 'first',
      states: ['first', 'second', 'review'].map((path) => ({ path, final: false })).concat([{ path: 'done', final: true }, { path: 'cancelled', final: true }]),
      transitions: [tr('first', 'NEXT', 'second'), tr('first', 'CANCEL', 'cancelled'), tr('second', 'NEXT', 'review'), tr('second', 'BACK', 'first'), tr('second', 'CANCEL', 'cancelled'), tr('review', 'FINISH', 'done'), tr('review', 'BACK', 'second')],
    },
  },
});

const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const actionSrc = (a) => (a.kind === 'callService' ? `{ type: 'callService', params: { service: ${q(a.service)} } }`
  : a.kind === 'setPartState' ? `{ type: 'setPartState', params: { part: ${q(a.part)}, state: ${q(a.state)} } }` : q(a.name));

/**
 * A workflow's source, as a real file would hold it.
 * @param {MockWorkflow} w The workflow as data.
 * @returns {string} The source text.
 */
export function renderWorkflow(w) {
  const head = w.base ? `// @line-base ${w.base}\n` : '';
  const obj = (o) => `{\n${Object.entries(o).map(([k, v]) => `  ${k}: ${v === null ? 'null' : q(v)},`).join('\n')}\n}`;
  const consts = w.pages ? `export const pages: Record<string, string | null> = ${obj(w.pages)};\n` : `export const roles = ${obj(w.roles)};\n`;
  const states = w.machine.states.map((s) => {
    const on = w.machine.transitions.filter((t) => t.from === s.path).map((t) => `${t.event}: ${t.actions.length ? `{ target: ${q(t.target)}, actions: [${t.actions.map(actionSrc).join(', ')}] }` : q(t.target)}`);
    const parts = [...(s.final ? ["type: 'final'"] : []), ...(on.length ? [`on: { ${on.join(', ')} }`] : [])];
    return `    ${s.path}: { ${parts.join(', ')} },`.replace('{  }', '{}');
  }).join('\n');
  return `${head}import { setup } from 'xstate';\n\n${consts}\nexport const ${w.name} = setup({}).createMachine({\n  id: ${q(w.machine.id)},\n  initial: ${q(w.machine.initial)},\n  states: {\n${states}\n  },\n});\n`;
}

/**
 * The workflow operations over the mock's `files` (shared with mock.mjs, which calls `landed` after every change).
 * @param {{files: Record<string, string>, project: () => import('./contract.mjs').LineProject}} o The mock's files and its project view.
 * @returns {any} `landed(change)` plus readLineWorkflows and the four workflow plans.
 */
export function createMockWorkflows({ files, project }) {
  /** @type {Map<string, MockWorkflow>} file -> workflow */
  const models = new Map(Object.entries(MOCK_WORKFLOWS).map(([f, w]) => [f, structuredClone(w)]));
  for (const [f, w] of models) files[f] = renderWorkflow(w);
  /** @type {Map<string, MockWorkflow>} planned content -> the workflow it renders */
  const planned = new Map();
  const stage = (path, w, summary) => { const content = renderWorkflow(w); planned.set(content, w); return { summary, files: [{ path, content }] }; };

  const featurePages = (feature) => project().features.find((f) => f.name === feature)?.items.filter((i) => i.kind === 'pages').map((i) => i.name) ?? [];
  const libraryOf = (w) => [...models.entries()].find(([f, m]) => f.startsWith(`${LIB}/`) && `workflows/${m.name}` === w.base)?.[1] ?? null;
  const describe = (file, w, feature) => {
    const lib = feature ? libraryOf(w) : null;
    return describeWorkflow({
      kind: feature ? 'feature' : 'library', name: w.name, file, feature, base: feature ? { value: w.base, libraryId: lib ? w.base : null } : null,
      machine: w.machine, roles: feature ? lib?.roles ?? {} : w.roles, pages: feature ? w.pages : null, featurePages: feature ? featurePages(feature) : [],
      baseTransitions: lib ? lib.machine.transitions : null,
      usedBy: feature ? [] : [...models.entries()].filter(([, m]) => m.base === `workflows/${w.name}`).map(([f]) => ({ feature: f.split('/')[1], file: f })),
    });
  };
  const featureWorkflow = (file) => {
    const w = models.get(String(file ?? ''));
    if (!w || !w.base) {
      if (w) throw new LineOpError(`The workflow ${w.name} is in the library, which Cockpit does not change here; base a feature workflow on it and change that.`, 'LIBRARY_ITEM');
      throw new LineOpError(`There is no feature workflow "${file}"; pick one from the feature's workflows.`, 'UNKNOWN_ITEM');
    }
    return { w, feature: String(file).split('/')[1] };
  };

  return {
    /** After applyChange landed: every written workflow file takes the workflow it was planned from. */
    landed(change) {
      for (const f of change.files) {
        if (f.content === null) models.delete(f.path);
        else if (planned.has(f.content)) models.set(f.path, planned.get(f.content));
      }
    },
    /** @returns {import('./contract.mjs').LineWorkflowList} */
    readLineWorkflows(_root, feature) {
      if (!project().features.some((f) => f.name === feature)) throw new LineOpError(`There is no feature "${feature}"; pick one from the list.`, 'UNKNOWN_ITEM');
      const entries = [...models.entries()];
      return {
        feature,
        workflows: entries.filter(([f]) => f.startsWith(`features/${feature}/workflows/`)).map(([f, w]) => describe(f, w, feature)),
        library: entries.filter(([f]) => f.startsWith(`${LIB}/`)).map(([f, w]) => describe(f, w, null)),
        pages: featurePages(feature),
        notMachines: [],
      };
    },
    planBaseWorkflowOn(_root, { libraryId, feature, name } = /** @type {any} */ ({})) {
      const lib = [...models.values()].find((m) => !m.base && `workflows/${m.name}` === libraryId);
      if (!lib) throw new LineOpError(`"${libraryId}" is not a library workflow; pick one from the library's workflows.`, 'UNKNOWN_ITEM');
      if (!project().features.some((f) => f.name === feature)) throw new LineOpError(`There is no feature "${feature}"; pick an existing feature or create its folder under features/ first.`, 'UNKNOWN_FEATURE');
      if (!NAME.test(String(name ?? ''))) throw new LineOpError(`"${name}" is not a workflow name; use letters and digits starting with a letter, such as orderBrowse.`, 'BAD_NAME');
      const path = `features/${feature}/workflows/${name}.ts`;
      if (files[path] !== undefined) throw new LineOpError(`Feature "${feature}" already has a workflow named ${name}; pick another name.`, 'NAME_TAKEN');
      const w = { name, base: libraryId, roles: {}, pages: Object.fromEntries(Object.keys(lib.roles).map((r) => [r, null])), machine: { ...structuredClone(lib.machine), id: name } };
      return stage(path, w, `Creates the workflow ${name} in feature ${feature}, based on the library workflow ${lib.name}.`);
    },
    planSetWorkflowRole(_root, { file, role, page } = /** @type {any} */ ({})) {
      const { w, feature } = featureWorkflow(file);
      if (!w.pages || !(role in w.pages)) throw new LineOpError(`The workflow ${w.name} has no role "${role}"; its roles are ${Object.keys(w.pages ?? {}).join(', ') || 'none'}.`, 'UNKNOWN_ROLE');
      const next = String(page ?? '');
      const pages = featurePages(feature);
      if (next && !pages.includes(next)) throw new LineOpError(`There is no page ${next} in ${feature}; pick one of its pages${pages.length ? ` (${pages.join(', ')})` : ''}.`, 'UNKNOWN_PAGE');
      if ((w.pages[role] ?? '') === next) throw new LineOpError(next ? `The page ${next} already fills the ${role} role of ${w.name}.` : `The ${role} role of ${w.name} is already empty.`, 'NO_CHANGE');
      return stage(file, { ...structuredClone(w), pages: { ...w.pages, [role]: next || null } },
        next ? `Chooses ${next} for the ${role} page of the workflow ${w.name}.` : `Clears the page chosen for the ${role} role of the workflow ${w.name}.`);
    },
    planAddWorkflowTransition(_root, req = /** @type {any} */ ({})) {
      const { file, from, event, to, service, part, partState } = req;
      const { w, feature } = featureWorkflow(file);
      if (!EVENT.test(String(event ?? ''))) throw new LineOpError(`"${event ?? ''}" is not an event name; use a word such as CANCEL.`, 'BAD_EVENT');
      const states = w.machine.states.map((s) => s.path);
      for (const s of [from, to]) if (!states.includes(s)) throw new LineOpError(`The workflow ${w.name} has no step "${s}"; pick one of ${states.join(', ')}.`, 'UNKNOWN_STATE');
      if (w.machine.transitions.some((t) => t.from === from && t.event === event)) throw new LineOpError(`"${from}" already handles "${event}"; retarget or remove that transition instead.`, 'BAD_TRANSITION');
      const actions = [];
      if (service) { if (!NAME.test(service)) throw new LineOpError(`"${service}" is not a service name; use letters and digits, such as cancelOrder.`, 'BAD_NAME'); actions.push({ kind: 'callService', service }); }
      if (part || partState) {
        if (!NAME.test(String(part ?? '')) || !NAME.test(String(partState ?? ''))) throw new LineOpError('Name both the part and the state to set it to, such as OrderCard and loading.', 'BAD_NAME');
        actions.push({ kind: 'setPartState', part, state: partState });
      }
      const next = structuredClone(w);
      next.machine.transitions.push(tr(from, event, to, actions));
      const card = describe(file, next, feature).transitions.find((t) => t.id === `${from}|${event}`);
      return stage(file, next, `${addTransitionSummary(w.name, card).replace(/[.?!]?$/, '')}.`);
    },
    planRemoveWorkflowTransition(_root, { file, from, event } = /** @type {any} */ ({})) {
      const { w, feature } = featureWorkflow(file);
      const t = describe(file, w, feature).transitions.find((x) => x.id === `${from}|${event}`);
      if (!t) throw new LineOpError(`The workflow ${w.name} has no transition ${event} from ${from}.`, 'UNKNOWN_TRANSITION');
      if (!t.removable) throw new LineOpError(`The transition ${event} from ${from} comes from the library workflow, so it stays; a feature only removes what it added.`, 'LIBRARY_TRANSITION');
      const next = structuredClone(w);
      next.machine.transitions = next.machine.transitions.filter((x) => !(x.from === from && x.event === event));
      return stage(file, next, `Removes from ${w.name}: ${t.when.replace(/\.$/, '').replace(/^When/, 'when')}.`);
    },
  };
}
