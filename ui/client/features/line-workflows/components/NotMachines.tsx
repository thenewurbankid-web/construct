import type { LineWorkflowList } from '../types';

type NotMachine = LineWorkflowList['notMachines'][number];

const row = (n: NotMachine) => (
  <li key={n.id}>
    {n.id.split('/').pop()}: {n.sentence}
  </li>
);

/** Workflow files Cockpit cannot draw (not an xstate machine), each with the reason, collapsed. Nothing when none. */
export function NotMachines({ items }: { items: NotMachine[] }) {
  if (!items.length) return null;
  return (
    <details className="lw-details" data-testid="lw-not-machines">
      <summary>Workflows Cockpit cannot draw yet ({items.length})</summary>
      <ul className="lw-lines">{items.map(row)}</ul>
    </details>
  );
}
