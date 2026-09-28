import type { WorkflowMachine } from '@/features/workflows';

type Props = { machine: WorkflowMachine; current: string | null; onChange: (path: string) => void };

/** #380 "State switcher": every state of the component's machine, so a person can preview each one in
 * the Flow inset without editing the workflow file. */
export function StateSwitcher({ machine, current, onChange }: Props) {
  if (machine.states.length === 0) return <p className="hint">This machine has no states.</p>;
  return (
    <div className="cd-state-switcher" role="tablist" aria-label="State" data-testid="cd-state-switcher">
      {machine.states.map((s) => (
        <button
          key={s.path}
          type="button"
          role="tab"
          aria-selected={s.path === current}
          className={`cd-state-btn${s.path === current ? ' active' : ''}`}
          data-testid={`cd-state-btn-${s.path}`}
          onClick={() => onChange(s.path)}
        >
          {s.name}
        </button>
      ))}
    </div>
  );
}
