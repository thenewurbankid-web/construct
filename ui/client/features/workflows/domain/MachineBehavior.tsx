import type { WorkflowContextField, WorkflowMachine } from '../types';

// Pure (DOMAIN-001) -- epic #223: what a machine remembers (context) and the
// named actions/guards it uses, shaped for the Context/Actions panel. The
// server's extractor is the source of truth; this only regroups it.

export type NamedUsage = { name: string; declared: boolean; usedBy: string[] };

export type TransitionChoice = { key: string; from: string; event: string; kind: NonNullable<WorkflowMachine['transitions'][number]['kind']>; label: string };

export type MachineBehavior = {
  context: WorkflowContextField[];
  actions: NamedUsage[];
  guards: NamedUsage[];
  transitions: TransitionChoice[];
};

function usage(names: string[], declared: string[], usedBy: Map<string, string[]>): NamedUsage[] {
  const all = [...declared, ...names.filter((n) => !declared.includes(n))];
  return all.map((name) => ({ name, declared: declared.includes(name), usedBy: usedBy.get(name) ?? [] }));
}

function push(map: Map<string, string[]>, name: string, where: string) {
  map.set(name, [...(map.get(name) ?? []), where]);
}

/** Group a machine's actions and guards by name, with everywhere each is used. */
export function describeBehavior(machine: WorkflowMachine): MachineBehavior {
  const actionUse = new Map<string, string[]>();
  const guardUse = new Map<string, string[]>();
  for (const s of machine.states) {
    for (const a of s.entry) push(actionUse, a, `entry of ${s.path}`);
    for (const a of s.exit) push(actionUse, a, `exit of ${s.path}`);
  }
  for (const t of machine.transitions) {
    const at = `${t.from} --${t.event}-->`;
    for (const a of t.actions) push(actionUse, a, at);
    if (t.guard) push(guardUse, t.guard, at);
  }
  const counts = new Map<string, number>();
  for (const t of machine.transitions) counts.set(`${t.from}|${t.kind}|${t.event}`, (counts.get(`${t.from}|${t.kind}|${t.event}`) ?? 0) + 1);
  const transitions = machine.transitions
    .filter((t) => counts.get(`${t.from}|${t.kind}|${t.event}`) === 1 && !t.targetless)
    .map((t) => ({ key: `${t.from}|${t.kind}|${t.event}`, from: t.from, event: t.event, kind: t.kind, label: `${t.from} --${t.event}--> ${t.target ?? t.rawTarget ?? '?'}` }));
  return {
    context: machine.context,
    actions: usage([...actionUse.keys()], machine.declared.actions, actionUse),
    guards: usage([...guardUse.keys()], machine.declared.guards, guardUse),
    transitions,
  };
}
