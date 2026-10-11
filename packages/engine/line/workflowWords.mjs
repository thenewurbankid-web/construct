// cw1 -- the words of a Line workflow (contract.mjs LineWorkflow): one pure function from what was read (a machine's
// states and transitions, its roles, the pages that fill them, the library workflow it is based on) to what Cockpit
// shows: state labels, When -> Do sentences and a short summary. Static rules only, no model; shared by the real
// reader (workflows.mjs) and the contract's mock (mockWorkflows.mjs), so both say exactly the same thing.

const upper = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
const stop = (s) => (/[.?!]$/.test(s) ? s : `${s}.`);
const plural = (n, one, many = `${one}s`) => `${n === 1 ? 'one' : n} ${n === 1 ? one : many}`;
const list = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/**
 * The key that says whether a feature's transition is the library's: from, event and target.
 * @param {{from: string, event: string, target: string|null}} t A transition.
 * @returns {string} "<from>|<event>|<target>".
 */
export const transitionKey = (t) => `${t.from}|${t.event}|${t.target ?? ''}`;

/**
 * One action in words, e.g. "call the cancelOrder service", "set OrderCard to loading".
 * @param {import('./contract.mjs').LineWorkflowAction} a The action.
 * @returns {string} Lower-case words, no full stop.
 */
export function actionWords(a) {
  if (a.kind === 'callService') return `call the ${a.service} service`;
  if (a.kind === 'setPartState') return `set ${a.part} to ${a.state}`;
  return `run ${a.name}`;
}

/**
 * @typedef {object} RawWorkflow  What a reader found in one workflow file.
 * @property {'library'|'feature'} kind
 * @property {string} name
 * @property {string} file
 * @property {string|null} feature
 * @property {{value: string|null, libraryId: string|null}|null} base
 * @property {{id: string, initial: string|null, states: {path: string, final: boolean}[],
 *   transitions: {from: string, event: string, target: string|null, actions: import('./contract.mjs').LineWorkflowAction[]}[]}} machine
 * @property {Record<string, string>} roles     role (a state's name) -> what the page is for
 * @property {Record<string, string|null>|null} pages  feature workflows: role -> page name (null: not chosen)
 * @property {string[]} featurePages           the feature's page names (to check a chosen page exists)
 * @property {{from: string, event: string, target: string|null}[]|null} baseTransitions  the library machine's, for a feature workflow
 * @property {{feature: string, file: string}[]} usedBy
 */

/**
 * The LineWorkflow Cockpit shows.
 * @param {RawWorkflow} raw
 * @returns {import('./contract.mjs').LineWorkflow}
 */
export function describeWorkflow(raw) {
  const { kind, name, file, feature, machine } = raw;
  const pages = raw.pages ?? {};
  const roleIds = Object.keys(raw.roles).filter((r) => machine.states.some((s) => s.path === r));
  for (const r of Object.keys(pages)) if (!roleIds.includes(r) && machine.states.some((s) => s.path === r)) roleIds.push(r);
  const pageOf = (role) => (kind === 'feature' && typeof pages[role] === 'string' && pages[role] ? pages[role] : null);
  const roles = roleIds.map((id) => {
    const page = pageOf(id);
    return { id, says: raw.roles[id] || `The ${id} page`, page, pageOk: page === null || raw.featurePages.includes(page) };
  });
  const roleSet = new Set(roleIds);
  const label = (path) => {
    if (roleSet.has(path)) return pageOf(path) ?? `the ${path} page`;
    return path;
  };
  const states = machine.states.map((s) => ({
    id: s.path, label: label(s.path), role: roleSet.has(s.path) ? s.path : null, page: roleSet.has(s.path) ? pageOf(s.path) : null,
    initial: s.path === machine.initial, final: !!s.final,
  }));
  const baseKeys = raw.baseTransitions ? new Set(raw.baseTransitions.map(transitionKey)) : null;
  const seen = new Set();
  /** @type {import('./contract.mjs').LineWorkflowTransition[]} */
  const transitions = [];
  for (const t of machine.transitions) {
    const id = `${t.from}|${t.event}`;
    if (seen.has(id)) continue; // a guarded multi-branch transition: Cockpit shows its first branch
    seen.add(id);
    const origin = kind === 'library' || !baseKeys || baseKeys.has(transitionKey(t)) ? 'library' : 'feature';
    const who = roleSet.has(t.from) ? `${label(t.from)} sends ${t.event}` : `the ${t.from} step gets ${t.event}`;
    const place = (sid) => (roleSet.has(sid) ? label(sid) : `the ${sid} step`);
    const doing = t.actions.map(actionWords);
    if (t.target && t.target !== t.from) doing.push(`go to ${place(t.target)}`);
    transitions.push({
      id, from: t.from, event: t.event, to: t.target ?? null, actions: t.actions, origin: /** @type {'library'|'feature'} */ (origin), removable: origin === 'feature' && kind === 'feature',
      when: stop(`When ${who}`), do: doing.length ? stop(upper(doing.join(', then '))) : 'Stay where it is.',
    });
  }
  const summary = [];
  if (kind === 'library') {
    summary.push(roles.length
      ? `${name} has ${plural(roles.length, 'page')} for a feature to fill (${list(roles.map((r) => r.id))}) and ${plural(transitions.length, 'transition')}.`
      : `${name} has no pages to fill and ${plural(transitions.length, 'transition')}.`);
    summary.push(raw.usedBy.length ? `${list([...new Set(raw.usedBy.map((u) => u.feature))])} ${raw.usedBy.length === 1 ? 'uses' : 'use'} it.` : 'No feature uses it yet.');
  } else {
    const libName = raw.base?.libraryId ? raw.base.libraryId.split('/').pop() : null;
    summary.push(libName ? `${name} is based on the library workflow ${libName}.` : `${name} is not based on a library workflow yet; give it a base link to one.`);
    const filled = roles.filter((r) => r.page);
    const open = roles.filter((r) => !r.page);
    if (roles.length) {
      summary.push(open.length
        ? `${filled.length} of ${roles.length} pages are chosen; still to choose: ${list(open.map((r) => r.id))}.`
        : `All ${plural(roles.length, 'page')} are chosen: ${list(filled.map((r) => `${r.id} is ${r.page}`))}.`);
    }
    for (const r of roles.filter((x) => !x.pageOk)) summary.push(`${r.page} is not a page of ${feature}, so the ${r.id} role points at nothing; choose one of its pages.`);
    const own = transitions.filter((t) => t.origin === 'feature').length;
    summary.push(own ? `${feature} adds ${plural(own, 'transition')} of its own.` : `${feature} adds no transitions of its own yet.`);
    if (raw.baseTransitions) {
      const mine = new Set(machine.transitions.map(transitionKey));
      const lost = raw.baseTransitions.filter((t) => !mine.has(transitionKey(t)));
      if (lost.length) summary.push(`It no longer has ${plural(lost.length, 'transition')} of the library workflow: ${list(lost.map((t) => `${t.event} from ${t.from}`))}.`);
    }
  }
  return {
    id: kind === 'library' ? `workflows/${name}` : `${feature}/workflows/${name}`,
    kind, name, file, feature: kind === 'library' ? null : feature, base: kind === 'library' ? null : raw.base ?? { value: null, libraryId: null },
    machineId: machine.id, initial: machine.initial, roles, states, transitions, summary, usedBy: raw.usedBy,
  };
}

/**
 * One sentence for a change step adding a transition: "Adds to orderBrowse: when OrdersPage sends CANCEL, ...".
 * @param {string} name The workflow's name.
 * @param {{when: string, do: string}} card The new transition's When -> Do card.
 * @returns {string} The sentence.
 */
export function addTransitionSummary(name, card) {
  return `Adds to ${name}: ${card.when.replace(/\.$/, '').replace(/^When/, 'when')}, ${card.do.charAt(0).toLowerCase()}${card.do.slice(1)}`;
}
