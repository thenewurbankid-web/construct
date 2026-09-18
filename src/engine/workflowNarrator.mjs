// Epic #185 / #186 -- explain an XState machine in plain English.
//
// Pure, deterministic, offline, non-LLM: takes the machine descriptions that
// workflowExtractor.mjs already produced (states, transitions, guards,
// actions, invokes) and turns them into sentences a business analyst could
// read aloud. Nothing here parses source, executes anything, touches the
// filesystem or stores anything -- the English is re-derived from the real
// source every time, so it can never drift from the diagram.
//
// Output for a machine:
//   { machine, summary, states: [{ name, path, label, kind, sentences[] }], text }
// where kind is 'initial' | 'final' | 'compound' | 'normal'. Order is source
// order (the extractor's order), so the same input always gives the same text.

/** camelCase / PascalCase / snake_case / kebab-case / UPPER_SNAKE -> "lower case words". */
export function humanize(identifier) {
  return String(identifier)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .replace(/[_\-.\s]+/g, ' ')
    .trim()
    .toLowerCase();
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const list = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);
const listOr = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`);

/** "*payment › card*" for nested states, "*idle*" for top-level ones. */
export function stateLabel(path) {
  return `*${path.split('.').map(humanize).join(' › ')}*`;
}

const code = (name) => `\`${name}\``;

/** A guard in words: `isLowValue` -> "it is low value"; unknown ones -> "a custom condition holds". */
export function guardText(guard) {
  if (!guard || guard.startsWith('(')) return 'a custom condition holds';
  const words = humanize(guard.replace(/\(.*\)$/, ''));
  if (/^(is|has|can|should|was|were|are|does|did|will|needs|must) /.test(words)) return `it ${words}`;
  return `the "${words}" condition holds`;
}

/** Milliseconds in words: 5000 -> "5 seconds", 90000 -> "90 seconds", 3600000 -> "1 hour". */
export function delayText(ms) {
  const units = [[3600000, 'hour'], [60000, 'minute'], [1000, 'second']];
  for (const [size, unit] of units) {
    if (ms >= size && ms % size === 0) return plural(ms / size, unit);
  }
  if (ms > 1000) return `${Number((ms / 1000).toFixed(2))} seconds`;
  return plural(ms, 'millisecond');
}

function eventHead(t, machine, servicesOf) {
  switch (t.kind) {
    case 'after':
      return /^\d+$/.test(t.event) ? `After ${delayText(Number(t.event))}` : `After the "${humanize(t.event)}" delay`;
    case 'always':
      return 'Immediately';
    case 'onDone':
      return 'When its sub-flow finishes';
    case 'invoke': {
      const svc = servicesOf(t.from);
      const name = svc.length ? svc.map(code).join(' and ') : 'the service';
      return t.event === 'invoke.onError' ? `If ${name} fails` : `When ${name} finishes successfully`;
    }
    default:
      return `When "${humanize(t.event)}" happens`;
  }
}

/** One sentence for the branch `i` of a same-event group. `prev` = earlier branches of the group. */
export function transitionSentence(t, i, prev, ctx) {
  const anywhere = ctx.compound && t.kind === 'on';
  const guarded = !!t.guard;
  const afterGuarded = prev.some((p) => p.guard);
  let body;
  if (t.unresolved) body = `the flow is supposed to move to "${t.rawTarget}", but no such state exists`;
  else if (t.targetless || t.target === null) body = `the flow stays in ${stateLabel(t.from)}`;
  else if (t.target === t.from) body = `the flow loops back to ${stateLabel(t.target)}`;
  else body = `the flow moves to ${stateLabel(t.target)}`;
  const stays = !t.unresolved && (t.targetless || t.target === null);
  if (t.actions?.length) body += `${stays ? ' and' : ' and then'} runs ${list(t.actions.map(code))}`;

  let head;
  if (i > 0 && afterGuarded && !guarded) head = 'Otherwise';
  else if (i > 0 && afterGuarded && guarded) head = `Otherwise, if ${guardText(t.guard)}`;
  else head = eventHead(t, ctx.machine, ctx.servicesOf);
  if (anywhere && head !== 'Otherwise' && !head.startsWith('Otherwise, if')) head = `Anywhere inside it, ${head[0].toLowerCase()}${head.slice(1)}`;
  if (i > 0 && afterGuarded && t.kind === 'always' && !guarded) head = 'Otherwise, immediately';
  let s = `${head}, ${body}`;
  if (guarded && !(i > 0 && afterGuarded)) s += ` — only if ${guardText(t.guard)}`;
  return `${s}.`;
}

function groupBy(items, keyOf) {
  const groups = new Map();
  for (const it of items) {
    const k = keyOf(it);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(it);
  }
  return [...groups.values()];
}

function kindOf(machine, s) {
  if (s.final) return 'final';
  if (machine.initial === s.path) return 'initial';
  if (s.type === 'compound') return 'compound';
  return 'normal';
}

export function machineTitle(machine) {
  return machine.id || machine.exportName || 'machine';
}

/** Narrate a single extracted machine. Never throws. */
export function narrateMachine(machine) {
  const title = machineTitle(machine);
  if (machine.error) {
    const summary = `The "${humanize(title)}" flow cannot be explained in plain English: ${machine.error}.`;
    return { machine: title, summary, states: [], text: `${summary}\n` };
  }
  const states = machine.states;
  const finals = states.filter((s) => s.final);
  const servicesOf = (path) => states.find((s) => s.path === path)?.invokes ?? [];
  const topLevel = states.filter((s) => !s.parent);

  const summaryParts = [`The "${humanize(title)}" flow has ${plural(states.filter((s) => s.type !== 'compound').length || states.length, 'step')}.`];
  if (machine.initial) summaryParts.push(`It starts in ${stateLabel(machine.initial)}`);
  if (machine.initial && finals.length) summaryParts[summaryParts.length - 1] += ` and can end in ${listOr(finals.map((s) => stateLabel(s.path)))}.`;
  else if (machine.initial) summaryParts[summaryParts.length - 1] += ' and has no end state, so it keeps running.';
  else if (topLevel.length) summaryParts.push('It does not say which state to start in.');
  const summary = summaryParts.join(' ');

  const out = states.map((s) => {
    const sentences = [];
    const kind = kindOf(machine, s);
    if (machine.initial === s.path) sentences.push(`This flow starts in ${stateLabel(s.path)}.`);
    if (s.type === 'compound') {
      const kids = states.filter((k) => k.parent === s.path);
      const start = s.initialChild ? ` and begins with ${stateLabel(s.initialChild)}` : '';
      sentences.push(`${stateLabel(s.path)} is made up of ${plural(kids.length, 'smaller step')} (${list(kids.map((k) => stateLabel(k.path)))})${start}.`);
    }
    if (s.final) sentences.push(`${stateLabel(s.path)} is an end state — the flow stops there.`);
    if (s.entry?.length) sentences.push(`On entering, it runs ${list(s.entry.map(code))}.`);
    if (s.invokes?.length) sentences.push(`While here, it starts ${list(s.invokes.map(code))}.`);
    const own = machine.transitions.filter((t) => t.from === s.path);
    for (const group of groupBy(own, (t) => `${t.kind}|${t.event}`)) {
      group.forEach((t, i) => sentences.push(transitionSentence(t, i, group.slice(0, i), { machine, servicesOf, compound: s.type === 'compound' })));
    }
    if (s.exit?.length) sentences.push(`On leaving, it runs ${list(s.exit.map(code))}.`);
    if (!s.final && s.type !== 'compound' && !own.length && !hasAncestorRules(machine, s)) {
      sentences.push(`There is no way out of ${stateLabel(s.path)} — the flow gets stuck there.`);
    }
    return { name: s.name, path: s.path, label: s.path.split('.').map(humanize).join(' › '), kind, sentences };
  });

  const lines = [`${cap(humanize(title))}`, summary, ''];
  for (const st of out) {
    lines.push(cap(st.path.split('.').map(humanize).join(' › ')));
    for (const sentence of st.sentences) lines.push(`  - ${sentence}`);
    lines.push('');
  }
  return { machine: title, summary, states: out, text: `${lines.join('\n').trimEnd()}\n` };
}

function hasAncestorRules(machine, s) {
  let p = s.parent;
  while (p) {
    if (machine.transitions.some((t) => t.from === p && t.kind !== 'onDone')) return true;
    p = p.includes('.') ? p.slice(0, p.lastIndexOf('.')) : null;
  }
  return false;
}
