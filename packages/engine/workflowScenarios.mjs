// Epic #185 / #187 -- scenarios and health findings for an XState machine.
//
// Pure and deterministic, like workflowNarrator.mjs: works only on the
// machine description the extractor already produced. Scenarios are every
// distinct route from the start state to an end state (guard branches count
// as different routes); health findings are the structural problems a
// reviewer would want flagged (unreachable states, dead ends, ...).
import { humanize, stateLabel, guardText, delayText } from './workflowNarrator.mjs';

export const DEFAULT_MAX_SCENARIOS = 25;
const STEP_BUDGET = 50000; // hard stop on DFS work so a pathological machine can't hang a request

const code = (n) => `\`${n}\``;
const list = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);
const plain = (path) => path.split('.').map(humanize).join(' › ');

/** Graph helpers over one extracted machine. */
export function graphOf(machine) {
  const byPath = new Map(machine.states.map((s) => [s.path, s]));
  const parentOf = (p) => byPath.get(p)?.parent ?? null;
  /** Enter a state: a compound state starts in its initial child (recursively). */
  const enter = (p) => {
    let cur = p;
    for (let guard = 0; guard < 50; guard += 1) {
      const s = byPath.get(cur);
      if (!s?.initialChild) return cur;
      cur = s.initialChild;
    }
    return cur;
  };
  /** Transitions that can fire while the flow sits in leaf `p`, nearest state first, source order. */
  const outgoing = (p) => {
    const edges = [];
    const s = byPath.get(p);
    for (let cur = p; cur; cur = parentOf(cur)) {
      for (const t of machine.transitions) {
        if (t.from !== cur || t.targetless || t.target === null || t.kind === 'onDone') continue;
        edges.push(t);
      }
    }
    if (s?.final && s.parent) {
      for (const t of machine.transitions) if (t.from === s.parent && t.kind === 'onDone' && t.target !== null && !t.targetless) edges.push(t);
    }
    return edges;
  };
  const ancestorsOrSelf = (p) => {
    const out = [];
    for (let cur = p; cur; cur = parentOf(cur)) out.push(cur);
    return out;
  };
  return { byPath, enter, outgoing, ancestorsOrSelf };
}

function eventKey(t) {
  if (t.kind === 'after') return `after:${t.event}`;
  return t.event;
}

/** For each transition, the guards of earlier branches in its same-event group (for "otherwise" wording). */
function priorGuards(machine, t) {
  const group = machine.transitions.filter((x) => x.from === t.from && x.kind === t.kind && x.event === t.event);
  const i = group.indexOf(t);
  return group.slice(0, i).filter((x) => x.guard);
}

function baseWhen(machine, t) {
  let base;
  switch (t.kind) {
    case 'after': base = /^\d+$/.test(t.event) ? `${delayText(Number(t.event))} ${Number(t.event) === 1000 ? 'passes' : 'pass'}` : `the "${humanize(t.event)}" delay passes`; break;
    case 'always': base = 'the flow moves on by itself'; break;
    case 'onDone': base = 'its sub-flow finishes'; break;
    case 'invoke': {
      const svc = machine.states.find((s) => s.path === t.from)?.invokes ?? [];
      const name = svc.length ? svc.map(code).join(' and ') : 'the service';
      base = t.event === 'invoke.onError' ? `${name} fails` : `${name} finishes successfully`;
      break;
    }
    default: base = `"${humanize(t.event)}" happens`;
  }
  return base;
}

function whenLine(machine, t) {
  const base = baseWhen(machine, t);
  const prior = priorGuards(machine, t);
  const earlier = prior.length ? ' (the earlier conditions did not apply)' : '';
  if (t.kind === 'always') {
    if (t.guard) return `${guardText(t.guard)}${earlier}`;
    return prior.length ? 'none of the conditions above apply' : 'there is nothing to wait for';
  }
  if (t.guard) return `${base} — only if ${guardText(t.guard)}${earlier}`;
  if (prior.length) return `${base}, when none of the conditions above apply`;
  return base;
}

function thenLine(t, leaf) {
  const actions = t.actions?.length ? ` and then runs ${list(t.actions.map(code))}` : '';
  return `the flow moves to ${stateLabel(leaf)}${actions}`;
}

// ---- scenario naming (#307) -------------------------------------------------------------------
// A scenario is named after what distinguishes it from its siblings: the DECISION steps it takes (steps that
// leave a state with more than one way out) and where it ends. Pure wording over the extracted machine.

/** Does this step leave a state where a sibling transition of the same event is guarded (so "no guard" means "otherwise")? */
export const guardedSiblings = (machine, step) => machine.transitions.some((t) => t.from === step.from && t.kind === step.kind && t.guard && (step.kind === 'always' || t.event === step.event.replace(/^after:/, '')));

/** "172800000" -> "2 d"; a delay that is not a plain number of ms is left as its name. */
function duration(raw) {
  const ms = Number(raw);
  if (!Number.isFinite(ms) || ms <= 0) return humanize(raw);
  for (const [unit, size] of [['d', 86_400_000], ['h', 3_600_000], ['min', 60_000], ['s', 1_000]]) if (ms % size === 0) return `${ms / size} ${unit}`;
  return `${ms} ms`;
}

/** The decision steps of a scenario in words, joined with ' · ' (what distinguishes it from its siblings). */
export function branchOf(machine, scenario) {
  const g = graphOf(machine);
  const words = scenario.steps.filter((s) => g.outgoing(s.from).length > 1).map((step) => {
    switch (step.kind) {
      case 'on': return step.guard ? `${humanize(step.event)} ${humanize(step.guard)}` : guardedSiblings(machine, step) ? 'otherwise' : humanize(step.event);
      case 'always': return step.guard ? humanize(step.guard) : 'otherwise';
      case 'after': return `after ${duration(step.event.replace(/^after:/, ''))}`;
      case 'invoke': return step.event === 'invoke.onError' ? 'the service fails' : 'the service succeeds';
      default: return humanize(step.event);
    }
  });
  return words.length ? words.join(' · ') : 'the only path';
}

/** A readable, distinguishing title: the branch in words, then where the flow ends. "Happy path" is decided by the caller. */
function titleOf(branch, scenario) {
  const said = branch.split(' · ').join(', then ');
  const where = plain(scenario.end.state).toLowerCase();
  return `${said[0].toUpperCase()}${said.slice(1)} (${scenario.end.outcome === 'final' ? 'ends in' : 'gets stuck in'} ${where})`;
}

/**
 * Enumerate scenarios. Returns { scenarios, loops, truncated, total }.
 * Deterministic: depth-first, nearest state's transitions first, source order.
 */
export function enumerateScenarios(machine, { max = DEFAULT_MAX_SCENARIOS } = {}) {
  if (machine.error || !machine.initial) return { scenarios: [], loops: [], truncated: false, total: 0 };
  const g = graphOf(machine);
  const start = g.enter(machine.initial);
  const found = [];
  const loops = [];
  const loopKeys = new Set();
  let budget = STEP_BUDGET;
  let truncated = false;

  const visit = (leaf, onPath, steps) => {
    if (found.length >= max || budget <= 0) { truncated = true; return; }
    budget -= 1;
    const edges = g.outgoing(leaf);
    if (!edges.length) {
      const s = g.byPath.get(leaf);
      found.push({ steps: [...steps], end: leaf, outcome: s?.final ? 'final' : 'stuck', nodes: [...onPath] });
      return;
    }
    for (const t of edges) {
      const next = g.enter(t.target);
      if (onPath.includes(next)) {
        const key = `${leaf}|${eventKey(t)}|${t.guard ?? ''}|${next}`;
        if (!loopKeys.has(key)) { loopKeys.add(key); loops.push({ from: leaf, to: next, transition: t }); }
        continue;
      }
      steps.push({ t, from: leaf, to: next });
      onPath.push(next);
      visit(next, onPath, steps);
      onPath.pop();
      steps.pop();
    }
  };
  visit(start, [start], []);

  // Happy path = the shortest route to the first end state (in source order) that any route reaches.
  const endsReached = new Set(found.filter((sc) => sc.outcome === 'final').map((sc) => sc.end));
  const firstFinal = machine.states.find((st) => endsReached.has(st.path))?.path;
  let happyIdx = -1;
  found.forEach((sc, i) => { if (sc.outcome === 'final' && sc.end === firstFinal && (happyIdx < 0 || sc.steps.length < found[happyIdx].steps.length)) happyIdx = i; });
  const ordered = happyIdx < 0 ? found : [found[happyIdx], ...found.filter((_, i) => i !== happyIdx)];

  const scenarios = ordered.map((sc, i) => {
    const happy = i === 0 && happyIdx >= 0;
    const title = happy ? 'Happy path' : `Path ${i + 1}`; // provisional: renamed below once every scenario exists
    const text = [`Given the flow starts in ${stateLabel(start)}`];
    sc.steps.forEach((st, n) => {
      text.push(`${n === 0 ? 'When' : 'And when'} ${whenLine(machine, st.t)}`);
      text.push(`Then ${thenLine(st.t, st.to)}`);
    });
    const last = sc.end;
    text.push(sc.outcome === 'final' ? `And the flow ends — ${stateLabel(last)} is an end state` : `And the flow gets stuck in ${stateLabel(last)}, with no way out`);
    const repeats = loops.filter((l) => sc.nodes.includes(l.from) && sc.nodes.includes(l.to));
    const notes = repeats.map((l) => {
      const via = l.transition;
      const where = l.from === l.to ? `in ${stateLabel(l.from)} the flow can start that step over` : `from ${stateLabel(l.from)} the flow can go back to ${stateLabel(l.to)}`;
      return `Note: ${where} when ${baseWhen(machine, via)}${via.guard ? ` (only if ${guardText(via.guard)})` : ''}, so this part can repeat.`;
    });
    return {
      id: i + 1,
      title,
      branch: null,
      happy,
      route: [start, ...sc.steps.map((s) => s.to)].map(plain).join(' → '),
      events: sc.steps.map((s) => eventKey(s.t)),
      steps: sc.steps.map((s) => ({ from: s.from, event: eventKey(s.t), kind: s.t.kind, guard: s.t.guard ?? null, actions: s.t.actions ?? [], to: s.to })),
      end: { state: sc.end, outcome: sc.outcome },
      text: [...text, ...notes],
    };
  });
  // #307: name each scenario after what distinguishes it. `branch` comes from the block, so no consumer has to
  // re-derive it; titles are kept unique so two rows can never read the same.
  const seenTitles = new Map();
  for (const sc of scenarios) {
    sc.branch = branchOf(machine, sc);
    if (sc.happy) continue;
    const base = titleOf(sc.branch, sc);
    const n = (seenTitles.get(base) ?? 0) + 1;
    seenTitles.set(base, n);
    sc.title = n === 1 ? base : `${base} [route ${n}]`;
  }
  const loopsOut = loops.map((l) => ({ from: l.from, to: l.to, event: eventKey(l.transition), guard: l.transition.guard ?? null }));
  return { scenarios, loops: loopsOut, truncated, total: scenarios.length };
}

function phrase(t) {
  switch (t.kind) {
    case 'after': return /^\d+$/.test(t.event) ? `the ${delayText(Number(t.event))} timeout` : `the "${humanize(t.event)}" timeout`;
    case 'always': return 'the automatic move';
    case 'onDone': return 'completion of its sub-flow';
    case 'invoke': return t.event === 'invoke.onError' ? 'a failure of its service' : 'completion of its service';
    default: return `"${humanize(t.event)}"`;
  }
}

/** Structural problems, in English. Each: { kind, severity: 'warning'|'info', state, message }. */
export function findHealthIssues(machine) {
  if (machine.error) return [];
  const out = [];
  const add = (kind, severity, state, message) => out.push({ kind, severity, state, message });
  const g = graphOf(machine);
  const label = (p) => stateLabel(p);

  if (!machine.initial) add('no-initial', 'warning', null, 'The flow does not say which state to start in.');
  if (!machine.states.some((s) => s.final)) add('no-end-state', 'info', null, 'The flow has no end state, so it never finishes. That is fine for a long-running process, but worth confirming.');

  if (machine.initial) {
    const reached = new Set();
    const queue = [g.enter(machine.initial)];
    while (queue.length) {
      const leaf = queue.shift();
      if (reached.has(leaf)) continue;
      reached.add(leaf);
      for (const t of g.outgoing(leaf)) queue.push(g.enter(t.target));
    }
    const reachedAll = new Set();
    for (const p of reached) for (const a of g.ancestorsOrSelf(p)) reachedAll.add(a);
    for (const s of machine.states) {
      if (!reachedAll.has(s.path)) add('unreachable', 'warning', s.path, `${label(s.path)} can never be reached — no path from the start leads to it.`);
    }
  }

  for (const s of machine.states) {
    if (s.final || s.type === 'compound') continue;
    if (!g.outgoing(s.path).length) add('dead-end', 'warning', s.path, `${label(s.path)} is a dead end: it is not an end state, yet nothing can move the flow out of it.`);
  }

  for (const t of machine.transitions) {
    if (t.unresolved) add('unresolved-target', 'warning', t.from, `In ${label(t.from)}, ${phrase(t)} points to "${t.rawTarget}", but no such state exists.`);
  }

  const seen = new Set();
  for (const t of machine.transitions) {
    const key = `${t.from}|${t.kind}|${t.event}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const group = machine.transitions.filter((x) => x.from === t.from && x.kind === t.kind && x.event === t.event);
    const unguarded = group.filter((x) => !x.guard);
    if (unguarded.length > 1) add('ambiguous', 'warning', t.from, `In ${label(t.from)}, ${phrase(t)} has ${unguarded.length} unguarded transitions, so only the first one ever runs.`);
    if (unguarded.length === 0 && group.length > 0 && t.kind !== 'onDone') {
      const conds = list(group.map((x) => guardText(x.guard)));
      const sev = t.kind === 'always' ? 'warning' : 'info';
      add('no-fallback', sev, t.from, `In ${label(t.from)}, ${phrase(t)} only applies under a condition (${conds}) and there is no fallback, so if none holds, nothing happens.`);
    }
  }
  return out;
}
