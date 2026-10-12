// Two modes, live stage: which parts are active at a place, as small visual blocks beside the chat (chat mode only).
// Pure and static: the place (the breadcrumb's levels), what the screen knows about each level, and the plan's open
// steps; how a step shows comes from the offline-generated tool presentations (lib/toolPresentations.ts). Read-only:
// any action still goes through the chat's options or the Plan.
import type { Place } from './lineModes.ts';
import { presentationOf, type StageKind, type UiState } from './toolPresentations.ts';

/** fit: all fine; gap: something is missing or wrong; problem: refused or failed; wait: waits for the person; open: no
 * status known (shown, not judged). */
export type StageStatus = 'fit' | 'gap' | 'problem' | 'wait' | 'open';

/** One level of the place as the screen knows it (all optional but the level itself). */
export type StagePart = { param: string; id: string; name?: string; kind?: StageKind; status?: StageStatus; statusLabel?: string; base?: string | null; findings?: string[] };

/** One plan step as the stage needs it (from the Plan panel's rows). */
export type StageStep = { id: string; n: number; tool: string; state: string; stateLabel: string; sentence: string; fixes: string[]; call?: string };

/** One block on the stage. `focus`: the part the chat is on (outlined). `states`: the UI states its tool shows (step). */
export type StageBlock = {
  id: string;
  kind: StageKind;
  icon: string;
  name: string;
  status: StageStatus;
  statusLabel: string;
  base: string | null;
  focus: boolean;
  sentence: string | null;
  fix: string | null;
  states: UiState[];
};

const ICONS: Record<StageKind, string> = { feature: 'folder', page: 'page', component: 'block', workflow: 'flow', step: 'step', finding: 'flag' };
const PARAM_KIND: Record<string, StageKind> = { feature: 'feature', page: 'page', item: 'component', component: 'component', file: 'workflow', workflow: 'workflow', part: 'component', step: 'step' };
const STATUS_LABEL: Record<StageStatus, string> = { fit: 'All fine', gap: 'Needs attention', problem: 'Refused', wait: 'Waiting for you', open: 'Open' };

/** The step states that are active on the stage: waiting for the person, running, or stopped with a problem. */
const ACTIVE_STEP = new Set(['waiting', 'ready', 'running', 'needs-you', 'needs-fix', 'failed']);
const STEP_STATUS: Record<string, StageStatus> = { waiting: 'wait', ready: 'wait', 'needs-you': 'wait', running: 'open', 'needs-fix': 'problem', failed: 'problem', done: 'fit' };

/** The tool a plan row's call names ("line.baseOn({...})" -> "line.baseOn"). */
export function toolOfCall(call: string): string {
  return /^([A-Za-z][\w.]*)\(/.exec(call)?.[1] ?? '';
}

function partBlock(place: Place, part: StagePart, i: number): StageBlock {
  const kind = part.kind ?? PARAM_KIND[part.param] ?? 'component';
  const status = part.status ?? 'open';
  const finding = part.findings?.[0] ?? null;
  return {
    id: `${part.param}:${part.id}`,
    kind,
    icon: ICONS[kind],
    name: part.name ?? part.id,
    status,
    statusLabel: part.statusLabel ?? STATUS_LABEL[status],
    base: part.base ?? null,
    focus: i === place.steps.length - 1,
    sentence: finding,
    fix: null,
    states: [],
  };
}

/** The kind of the item a step acts on, read from its call ("billing/pages/InvoicesPage", "features/x/components/Y.tsx"),
 * or null when the call names no page or component. */
export function itemKindOfCall(call: string | undefined): 'page' | 'component' | null {
  if (!call) return null;
  if (/[/"]pages\//.test(call)) return 'page';
  if (/[/"]components\//.test(call)) return 'component';
  return null;
}

function stepBlock(step: StageStep): StageBlock {
  const p = presentationOf(step.tool);
  const status = STEP_STATUS[step.state] ?? 'open';
  // A tool that acts on a page or a component (setBase, moveFile, baseOn, amend) shows the kind of the step's own item;
  // the saved presentation is only the default when the call does not say.
  const saved = p?.kind.value;
  const real = saved === 'page' || saved === 'component' ? itemKindOfCall(step.call) : null;
  return {
    id: `step:${step.id}`,
    kind: 'step',
    icon: real ? ICONS[real] : (p?.icon.value ?? ICONS.step),
    name: `Step ${step.n}`,
    status,
    statusLabel: step.stateLabel,
    base: null,
    focus: false,
    sentence: step.sentence,
    fix: status === 'problem' ? (step.fixes[0] ?? null) : null,
    states: p?.states.value ?? [],
  };
}

/** The active parts at a place: each level of the breadcrumb (the last one in focus), then the plan's steps that wait,
 * run or were refused, then the step that ran last (its "after"). Parts the screen does not describe still show, as
 * "Open". Nothing else is on the stage: an inactive part fades out because it is no longer in this list. */
export function stageBlocks(place: Place, parts: StagePart[], steps: StageStep[]): StageBlock[] {
  const known = new Map(parts.map((p) => [`${p.param}:${p.id}`, p]));
  const levels = place.steps.map((s, i) => partBlock(place, known.get(`${s.param}:${s.id}`) ?? { param: s.param, id: s.id, name: s.label }, i));
  const open = steps.filter((s) => ACTIVE_STEP.has(s.state));
  const last = [...steps].reverse().find((s) => s.state === 'done');
  const shown = last ? [...open, last] : open;
  return [...levels, ...shown.map(stepBlock)];
}

/** Plan panel rows as stage steps (the tool from the row's call). */
export function stepsFromRows(rows: { id: string; n: number; state: string; stateLabel: string; sentence: string; fixes: string[]; call: string }[]): StageStep[] {
  return rows.map((r) => ({ id: r.id, n: r.n, tool: toolOfCall(r.call), state: r.state, stateLabel: r.stateLabel, sentence: r.sentence, fixes: r.fixes, call: r.call }));
}
