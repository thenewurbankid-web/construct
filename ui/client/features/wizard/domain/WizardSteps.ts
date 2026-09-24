// Pure (DOMAIN-001): the Import Wizard's framework blocks, in the order they run, and how each
// server `step` event moves them (#599). These are the deterministic Construct phases; the
// model's own streamed output is a separate `thought` event and never touches this list.
export type WizardPhase = 'tracing' | 'analyzing' | 'plan-ready' | 'scaffolding' | 'filling' | 'validating' | 'auto-fixing';
export type StepStatus = 'pending' | 'active' | 'done' | 'skipped' | 'cancelled' | 'stopped';
export type WizardStep = { phase: WizardPhase; label: string; status: StepStatus; note: string };
export type StepEvent = { phase: string; detail?: Record<string, unknown> };

export const PHASE_ORDER: readonly WizardPhase[] = ['tracing', 'analyzing', 'plan-ready', 'scaffolding', 'filling', 'validating', 'auto-fixing'];

const PHASE_LABELS: Record<WizardPhase, string> = {
  tracing: 'Trace route files',
  analyzing: 'Model proposes a plan',
  'plan-ready': 'You approve the plan',
  scaffolding: 'Scaffold layers',
  filling: 'Model fills each file',
  validating: 'Validate the feature',
  'auto-fixing': 'Auto-fix violations',
};

export const initialSteps = (): WizardStep[] => PHASE_ORDER.map((phase) => ({ phase, label: PHASE_LABELS[phase], status: 'pending', note: '' }));

const isPhase = (p: string): p is WizardPhase => (PHASE_ORDER as readonly string[]).includes(p);
const text = (v: unknown): string => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');
const count = (v: unknown): number => (Array.isArray(v) ? v.length : Number(v) || 0);

/** A short human line for one step event: what the framework is doing right now. */
export function stepNote(event: StepEvent): string {
  const d = event.detail ?? {};
  switch (event.phase) {
    case 'tracing': return `Tracing ${Array.isArray(d.routes) ? d.routes.join(', ') : 'the route'}`;
    case 'analyzing': return `Analyzing ${count(d.files)} file(s) via ${text(d.provider) || 'the model'}`;
    case 'plan-ready': return `Plan ready: ${count(d.units)} unit(s)`;
    case 'scaffolding': return `Scaffolding ${text(d.unit)}`;
    case 'filling': return `Filling ${text(d.file)} (${text(d.index)}/${text(d.total)})`;
    case 'validating': return `Validating ${text(d.feature)}`;
    case 'auto-fixing': return `Auto-fixing ${count(d.files)} file(s)`;
    case 'cancelled': return `Cancelled while ${text(d.during) || 'running'}`;
    case 'done': return 'Import finished';
    default: return event.phase;
  }
}

/** Apply one server step event. A block that is passed while still pending was not needed this run
 * (`skipped`); the active one is `done` once the next begins; `done`/`cancelled` close the run. */
export function applyStepEvent(steps: WizardStep[], event: StepEvent): WizardStep[] {
  if (event.phase === 'done') return steps.map((s) => (s.status === 'active' ? { ...s, status: 'done' } : s.status === 'pending' ? { ...s, status: 'skipped' } : s));
  if (event.phase === 'cancelled') return steps.map((s) => (s.status === 'active' ? { ...s, status: 'cancelled' } : s.status === 'pending' ? { ...s, status: 'skipped' } : s));
  if (!isPhase(event.phase)) return steps;
  const at = PHASE_ORDER.indexOf(event.phase);
  const note = stepNote(event);
  return steps.map((s, i) => {
    if (i < at) return s.status === 'active' ? { ...s, status: 'done' } : s.status === 'pending' ? { ...s, status: 'skipped' } : s;
    if (i === at) return { ...s, status: 'active', note };
    return s;
  });
}

/** The session ended: anything still running stopped without finishing, anything not reached was skipped. */
export function endRun(steps: WizardStep[]): WizardStep[] {
  return steps.map((s) => (s.status === 'active' ? { ...s, status: 'stopped' } : s.status === 'pending' ? { ...s, status: 'skipped' } : s));
}
